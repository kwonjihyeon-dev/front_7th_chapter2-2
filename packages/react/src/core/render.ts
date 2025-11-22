import { context } from "./context";
import { reconcile } from "./reconciler";
import { cleanupUnusedHooks, flushEffects } from "./hooks";
import { withEnqueue } from "../utils";
import { HookTypes, NodeTypes } from "./constants";
import { EffectHook, Instance } from "./types";

/**
 * 인스턴스와 그 하위 컴포넌트들의 cleanup 함수를 재귀적으로 실행하고,
 * 이펙트 큐에서도 해당 path의 이펙트를 제거합니다.
 * state가 초기화되기 전에 호출되어야 합니다.
 */
const cleanupInstanceBeforeClear = (instance: Instance | null, pathsToCleanup: Set<string>): void => {
  if (!instance) {
    return;
  }

  // 컴포넌트 타입인 경우 훅 cleanup 실행
  if (instance.kind === NodeTypes.COMPONENT) {
    const path = instance.path;
    pathsToCleanup.add(path);

    const hooks = context.hooks.state.get(path);
    if (hooks) {
      hooks.forEach((hook) => {
        if (hook && typeof hook === "object" && "kind" in hook) {
          const effectHook = hook as EffectHook;
          if (effectHook.kind === HookTypes.EFFECT && effectHook.cleanup) {
            try {
              effectHook.cleanup();
            } catch (error) {
              // cleanup 오류는 무시
              console.error("Cleanup 함수 실행 중 오류:", error);
            }
          }
        }
      });
    }
  }

  // 자식 인스턴스들도 재귀적으로 cleanup
  instance.children.forEach((child) => {
    if (child) {
      cleanupInstanceBeforeClear(child, pathsToCleanup);
    }
  });
};

/**
 * 루트 컴포넌트의 렌더링을 수행하는 함수입니다.
 * `enqueueRender`에 의해 스케줄링되어 호출됩니다.
 */
export const render = (): void => {
  // 0. 이전 인스턴스의 cleanup 실행 (state 초기화 전에 실행)
  const oldInstance = context.root.instance;
  const pathsToCleanup = new Set<string>();
  if (oldInstance) {
    cleanupInstanceBeforeClear(oldInstance, pathsToCleanup);
    // cleanup된 path와 그 하위 path는 visited에 추가하여 cleanupUnusedHooks에서 다시 cleanup하지 않도록 함
    pathsToCleanup.forEach((path) => {
      context.hooks.visited.add(path);
      // 하위 path도 모두 visited에 추가
      context.hooks.state.forEach((_, statePath) => {
        if (statePath.startsWith(path + ".")) {
          context.hooks.visited.add(statePath);
        }
      });
    });
    // 이펙트 큐에서 cleanup된 path와 그 하위 path의 이펙트 제거
    context.effects.queue = context.effects.queue.filter(({ path }) => {
      // 정확히 일치하는 path
      if (pathsToCleanup.has(path)) {
        return false;
      }
      // 하위 path인지 확인
      for (const cleanupPath of pathsToCleanup) {
        if (path.startsWith(cleanupPath + ".")) {
          return false;
        }
      }
      return true;
    });
  }

  // 1. 훅 컨텍스트를 초기화합니다.
  // visited는 cleanupUnusedHooks에서 사용되므로 초기화하지 않습니다.
  // cleanup된 path는 전역 Set으로 추적하여 reconcile 이후에도 effect 큐에서 제거할 수 있도록 함
  const cleanupedPaths = new Set<string>(pathsToCleanup);

  // 이전 인스턴스에서 사용된 모든 path를 visited에 추가
  // 이렇게 하면 이전에 렌더링된 컴포넌트의 상태를 보존할 수 있습니다
  const collectPathsFromInstance = (instance: Instance | null): void => {
    if (!instance) return;
    if (instance.kind === NodeTypes.COMPONENT) {
      context.hooks.visited.add(instance.path);
    }
    instance.children.forEach((child) => {
      if (child) {
        collectPathsFromInstance(child);
      }
    });
  };

  if (oldInstance) {
    collectPathsFromInstance(oldInstance);
  }

  // visited된 path의 상태는 유지, 나머지는 제거
  const pathsToDelete: string[] = [];
  context.hooks.state.forEach((_, path) => {
    if (!context.hooks.visited.has(path)) {
      pathsToDelete.push(path);
    }
  });
  pathsToDelete.forEach((path) => {
    context.hooks.state.delete(path);
    context.hooks.cursor.delete(path);
  });

  context.hooks.componentStack = [];
  // visited는 cleanupUnusedHooks에서 사용되므로 reconcile 후에 정리

  // 2. reconcile 함수를 호출하여 루트 노드를 재조정합니다.
  const { container, node } = context.root;

  // 컨테이너가 없으면 렌더링할 수 없음
  if (!container) {
    return;
  }

  // reconcile 실행
  const newInstance = reconcile(container, oldInstance, node, "0");

  // 새 인스턴스를 루트에 저장
  context.root.instance = newInstance;

  // reconcile 과정에서 cleanup된 path의 effect가 다시 큐에 추가될 수 있으므로 다시 제거
  if (cleanupedPaths.size > 0) {
    context.effects.queue = context.effects.queue.filter(({ path }) => {
      // 정확히 일치하는 path
      if (cleanupedPaths.has(path)) {
        return false;
      }
      // 하위 path인지 확인
      for (const cleanupPath of cleanupedPaths) {
        if (path.startsWith(cleanupPath + ".")) {
          return false;
        }
      }
      return true;
    });
  }

  // 3. 사용되지 않은 훅들을 정리(cleanupUnusedHooks)합니다.
  // cleanupUnusedHooks는 이펙트 실행 전에 호출하여 사용되지 않는 컴포넌트의 cleanup을 실행합니다.
  // 이미 cleanupInstanceBeforeClear에서 cleanup된 path는 visited에 추가되어 다시 cleanup되지 않습니다.
  cleanupUnusedHooks();

  // visited 정리
  context.hooks.visited.clear();

  // 4. 이펙트 실행 스케줄링
  // Promise.resolve().then()을 사용하여 다음 마이크로태스크 사이클에서 실행
  // flushMicrotasks()에서 await Promise.resolve()를 호출하면 실행됩니다
  flushEffects();
};

/**
 * `render` 함수를 마이크로태스크 큐에 추가하여 중복 실행을 방지합니다.
 */
export const enqueueRender = withEnqueue(render);
