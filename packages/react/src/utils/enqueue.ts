import type { AnyFunction } from "../types";

/**
 * 작업을 마이크로태스크 큐에 추가하여 비동기적으로 실행합니다.
 * 브라우저의 `queueMicrotask` 또는 `Promise.resolve().then()`을 사용합니다.
 */
export const enqueue = (callback: () => void) => {
  // queueMicrotask가 있으면 사용, 없으면 Promise.resolve().then() 사용
  if (typeof queueMicrotask !== "undefined") {
    queueMicrotask(callback);
  } else {
    Promise.resolve().then(callback);
  }
};

/**
 * 함수가 여러 번 호출되더라도 실제 실행은 한 번만 스케줄링되도록 보장하는 고차 함수입니다.
 * 렌더링이나 이펙트 실행과 같은 작업의 중복을 방지하는 데 사용됩니다.
 */
export const withEnqueue = (fn: AnyFunction) => {
  let scheduled = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) => {
    // 이미 스케줄링되어 있으면 스킵
    if (scheduled) {
      return;
    }

    // 스케줄링 플래그 설정
    scheduled = true;

    // 마이크로태스크 큐에 추가
    enqueue(() => {
      // 실행 후 플래그 리셋
      scheduled = false;
      // 함수 실행
      fn(...args);
    });
  };
};
