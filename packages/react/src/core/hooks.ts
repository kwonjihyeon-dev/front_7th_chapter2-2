import { shallowEquals, enqueue, withEnqueue } from "../utils";
import { context } from "./context";
import { EffectHook } from "./types";
import { enqueueRender } from "./render";
import { HookTypes } from "./constants";

/**
 * 사용되지 않는 컴포넌트의 훅 상태와 이펙트 클린업 함수를 정리합니다.
 */
export const cleanupUnusedHooks = (): void => {
  const { state, cursor, visited } = context.hooks;

  // visited에 없는 path의 훅 상태 정리
  // path가 visited에 있거나, visited의 어떤 path의 하위 path인지 확인
  const pathsToCleanup: string[] = [];

  state.forEach((hooks, path) => {
    // path 자체가 visited에 있으면 스킵
    if (visited.has(path)) {
      return;
    }

    // visited의 어떤 path의 하위 path인지 확인
    // 예: visited에 "0.i0"이 있고 path가 "0.i0.cChild_0"이면 스킵
    let isSubPath = false;
    for (const visitedPath of visited) {
      if (path.startsWith(visitedPath + ".")) {
        isSubPath = true;
        break;
      }
    }

    if (!isSubPath) {
      pathsToCleanup.push(path);
      // cleanup 함수 실행
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
  });

  // 정리된 path의 상태 제거
  pathsToCleanup.forEach((path) => {
    state.delete(path);
    cursor.delete(path);
  });

  // 이펙트 큐에서도 사용되지 않는 path의 이펙트 제거
  context.effects.queue = context.effects.queue.filter(({ path }) => {
    // visited에 있거나 visited의 하위 path인 경우만 유지
    if (visited.has(path)) {
      return true;
    }
    for (const visitedPath of visited) {
      if (path.startsWith(visitedPath + ".")) {
        return true;
      }
    }
    return false;
  });
};

/**
 * 컴포넌트의 상태를 관리하기 위한 훅입니다.
 * @param initialValue - 초기 상태 값 또는 초기 상태를 반환하는 함수
 * @returns [현재 상태, 상태를 업데이트하는 함수]
 */
export const useState = <T>(initialValue: T | (() => T)): [T, (nextValue: T | ((prev: T) => T)) => void] => {
  // 1. 현재 컴포넌트의 훅 커서와 상태 배열을 가져옵니다.
  const path = context.hooks.currentPath;
  const cursor = context.hooks.currentCursor;
  const hooks = context.hooks.currentHooks;

  // 2. 첫 렌더링이라면 초기값으로 상태를 설정합니다.
  if (cursor >= hooks.length || hooks[cursor] === undefined) {
    // 초기값 평가 (함수면 lazy initialization)
    const value = typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
    hooks[cursor] = value;
  }

  // 현재 상태 가져오기
  const state = hooks[cursor] as T;

  // 3. 상태 변경 함수(setter)를 생성합니다.
  const setState = (nextValue: T | ((prev: T) => T)) => {
    // 새 값 계산 (함수면 이전 값을 인자로 호출)
    const newValue = typeof nextValue === "function" ? (nextValue as (prev: T) => T)(state) : nextValue;

    // Object.is로 값 비교하여 변경 감지
    if (Object.is(state, newValue)) {
      // 값이 같으면 재렌더링 건너뛰기
      return;
    }

    // 상태 업데이트
    hooks[cursor] = newValue;

    // 재렌더링 예약
    enqueueRender();
  };

  // 4. 훅 커서를 증가시킵니다.
  const currentCursor = context.hooks.cursor.get(path) ?? 0;
  context.hooks.cursor.set(path, currentCursor + 1);

  return [state, setState];
};

/**
 * 컴포넌트의 사이드 이펙트를 처리하기 위한 훅입니다.
 * @param effect - 실행할 이펙트 함수. 클린업 함수를 반환할 수 있습니다.
 * @param deps - 의존성 배열. 이 값들이 변경될 때만 이펙트가 다시 실행됩니다.
 */
export const useEffect = (effect: () => (() => void) | void, deps?: unknown[]): void => {
  // 1. 현재 컴포넌트 정보 가져오기
  const path = context.hooks.currentPath;
  const cursor = context.hooks.currentCursor;

  // hooks 배열 가져오기 (없으면 생성)
  let hooks = context.hooks.state.get(path);
  if (!hooks) {
    hooks = [];
    context.hooks.state.set(path, hooks);
  }

  // 이전 EffectHook 가져오기
  let prevHook: EffectHook | undefined;
  if (cursor < hooks.length && hooks[cursor] && typeof hooks[cursor] === "object" && "kind" in hooks[cursor]) {
    prevHook = hooks[cursor] as EffectHook;
  }

  // 2. 의존성 배열 비교 (shallowEquals)
  const prevDeps = prevHook?.deps ?? null;
  // deps가 undefined이면 매 렌더링마다 실행 (의존성 배열이 없음)
  // prevHook이 없으면 첫 렌더링
  // 의존성이 변경되었으면 실행
  let shouldRun = false;
  if (!prevHook) {
    // 첫 렌더링 - 항상 실행
    shouldRun = true;
  } else if (deps === undefined || prevDeps === undefined || prevDeps === null) {
    // deps가 없으면 매 렌더링마다 실행
    // prevDeps가 undefined이거나 null이면 이전에도 deps가 없었던 것이므로 실행
    shouldRun = true;
  } else {
    // 의존성이 변경되었으면 실행
    shouldRun = !shallowEquals(prevDeps, deps);
  }

  // 3. 이펙트 실행 결정
  if (shouldRun) {
    // 이펙트 큐에 추가 (path, cursor)
    context.effects.queue.push({ path, cursor });
  }

  // 4. EffectHook 저장 (항상 최신 effect 함수로 업데이트)
  const effectHook: EffectHook = {
    kind: HookTypes.EFFECT,
    deps: deps ?? null,
    cleanup: prevHook?.cleanup ?? null,
    effect, // 항상 최신 effect 함수로 저장
  };

  // cursor 위치까지 배열 확장
  while (hooks.length <= cursor) {
    hooks.push(undefined);
  }
  hooks[cursor] = effectHook;

  // 5. 훅 커서 증가
  const currentCursor = context.hooks.cursor.get(path) ?? 0;
  context.hooks.cursor.set(path, currentCursor + 1);
};

/**
 * 큐에 등록된 이펙트들을 실행합니다.
 * 렌더링 완료 후 호출되어야 합니다.
 */
const executeEffects = (): void => {
  const queue = context.effects.queue;
  if (queue.length === 0) {
    return;
  }

  // 큐 복사 후 비우기
  const effectsToRun = [...queue];
  queue.length = 0;

  // 각 이펙트 실행
  effectsToRun.forEach(({ path, cursor }) => {
    // state에 path가 없으면 cleanup된 컴포넌트이므로 스킵
    const hooks = context.hooks.state.get(path);
    if (!hooks) {
      return;
    }
    if (cursor >= hooks.length) {
      return;
    }

    const hook = hooks[cursor];
    if (!hook || typeof hook !== "object" || !("kind" in hook)) {
      return;
    }

    const effectHook = hook as EffectHook;
    if (effectHook.kind !== HookTypes.EFFECT) {
      return;
    }

    // 이전 cleanup 함수 실행
    if (effectHook.cleanup) {
      try {
        effectHook.cleanup();
      } catch (error) {
        console.error("Cleanup 함수 실행 중 오류:", error);
      }
    }

    // 이펙트 실행
    try {
      const cleanup = effectHook.effect();
      // cleanup 함수 저장
      if (typeof cleanup === "function") {
        effectHook.cleanup = cleanup;
      } else {
        effectHook.cleanup = null;
      }
    } catch (error) {
      console.error("Effect 함수 실행 중 오류:", error);
      effectHook.cleanup = null;
    }
  });
};

/**
 * 렌더링 후 이펙트를 스케줄링합니다.
 * render 함수에서 호출해야 합니다.
 * setup에서 render()가 동기적으로 호출되거나, enqueueRender()가 마이크로태스크에서 실행될 수 있으므로,
 * 이펙트는 항상 Promise.resolve().then()을 사용하여 다음 마이크로태스크 사이클에서 실행되도록 합니다.
 * flushMicrotasks()에서 await Promise.resolve()를 호출하면 실행됩니다.
 */
const scheduleEffects = withEnqueue(executeEffects);

export const flushEffects = (): void => {
  if (context.effects.queue.length === 0) {
    return;
  }

  // Promise.resolve().then()을 사용하여 다음 마이크로태스크 사이클에서 실행
  // 이렇게 하면 render가 동기적으로 호출되든 마이크로태스크에서 호출되든 상관없이
  // 항상 render 완료 후에 이펙트가 실행됩니다
  // scheduleEffects를 사용하여 중복 실행 방지
  enqueue(() => {
    scheduleEffects();
  });
};
