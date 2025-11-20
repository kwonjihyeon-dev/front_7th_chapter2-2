import { context } from "./context";
import { VNode } from "./types";
import { removeInstance } from "./dom";
// import { cleanupUnusedHooks } from "./hooks";
import { enqueueRender } from "./render";

/**
 * Mini-React 애플리케이션의 루트를 설정하고 첫 렌더링을 시작합니다.
 *
 * @param rootNode - 렌더링할 최상위 VNode
 * @param container - VNode가 렌더링될 DOM 컨테이너
 */
export const setup = (rootNode: VNode | null, container: HTMLElement): void => {
  // 1. 컨테이너 유효성 검사
  if (!container) {
    throw new Error("컨테이너가 제공되지 않았습니다");
  }

  // 2. 이전 렌더링 정리
  if (context.root.instance) {
    removeInstance(container, context.root.instance);
  }
  container.innerHTML = "";

  // 3. 컨텍스트 리셋
  context.hooks.clear();
  context.root.reset({ container, node: rootNode });
  context.effects.queue = [];

  // 4. 첫 렌더링 실행
  enqueueRender();
};
