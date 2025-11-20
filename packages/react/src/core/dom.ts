/* eslint-disable @typescript-eslint/no-explicit-any */
import { NodeTypes } from "./constants";
import { Instance } from "./types";

/**
 * DOM 요소에 속성(props)을 설정합니다.
 * 이벤트 핸들러, 스타일, className 등 다양한 속성을 처리해야 합니다.
 */
export const setDomProps = (dom: HTMLElement, props: Record<string, any>): void => {
  Object.keys(props).forEach((key) => {
    // children은 DOM 속성이 아니므로 제외
    if (key === "children") {
      return;
    }

    const value = props[key];

    // 이벤트 핸들러 처리 (on으로 시작하는 속성)
    if (key.startsWith("on") && typeof value === "function") {
      const eventType = key.slice(2).toLowerCase(); // onClick -> click
      dom.addEventListener(eventType, value);
      return;
    }

    // style 객체 처리
    if (key === "style" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.keys(value).forEach((styleKey) => {
        (dom.style as any)[styleKey] = value[styleKey];
      });
      return;
    }

    // className 처리
    if (key === "className") {
      dom.className = value || "";
      return;
    }

    // boolean 속성 처리 (disabled, checked, readOnly 등)
    if (typeof value === "boolean") {
      if (value) {
        dom.setAttribute(key, "");
      } else {
        dom.removeAttribute(key);
      }
      // boolean 속성은 DOM 프로퍼티로도 설정
      (dom as any)[key] = value;
      return;
    }

    // 일반 속성 처리
    if (value == null || value === false) {
      dom.removeAttribute(key);
    } else {
      dom.setAttribute(key, value);
      // DOM 프로퍼티로도 설정 (예: id, name 등)
      try {
        (dom as any)[key] = value;
      } catch {
        // 읽기 전용 속성일 수 있으므로 무시
      }
    }
  });
};

/**
 * 이전 속성과 새로운 속성을 비교하여 DOM 요소의 속성을 업데이트합니다.
 * 변경된 속성만 효율적으로 DOM에 반영해야 합니다.
 */
export const updateDomProps = (
  dom: HTMLElement,
  prevProps: Record<string, any> = {},
  nextProps: Record<string, any> = {},
): void => {
  // 이전 props에 있던 키들 확인
  const allKeys = new Set([...Object.keys(prevProps), ...Object.keys(nextProps)]);

  allKeys.forEach((key) => {
    // children은 DOM 속성이 아니므로 제외
    if (key === "children") {
      return;
    }

    const prevValue = prevProps[key];
    const nextValue = nextProps[key];

    // 값이 변경되지 않았으면 스킵
    if (prevValue === nextValue) {
      return;
    }

    // 이벤트 핸들러 처리
    if (key.startsWith("on") && typeof (prevValue || nextValue) === "function") {
      const eventType = key.slice(2).toLowerCase();
      // 이전 핸들러 제거
      if (prevValue) {
        dom.removeEventListener(eventType, prevValue);
      }
      // 새 핸들러 추가
      if (nextValue) {
        dom.addEventListener(eventType, nextValue);
      }
      return;
    }

    // style 객체 처리
    if (key === "style") {
      // 이전 스타일 제거
      if (prevValue && typeof prevValue === "object") {
        Object.keys(prevValue).forEach((styleKey) => {
          (dom.style as any)[styleKey] = "";
        });
      }
      // 새 스타일 적용
      if (nextValue && typeof nextValue === "object" && nextValue !== null && !Array.isArray(nextValue)) {
        Object.keys(nextValue).forEach((styleKey) => {
          (dom.style as any)[styleKey] = nextValue[styleKey];
        });
      } else if (!nextValue) {
        dom.removeAttribute("style");
      }
      return;
    }

    // className 처리
    if (key === "className") {
      if (nextValue) {
        dom.className = nextValue;
      } else {
        dom.className = "";
      }
      return;
    }

    // boolean 속성 처리
    if (typeof prevValue === "boolean" || typeof nextValue === "boolean") {
      const boolValue = Boolean(nextValue);
      if (boolValue) {
        dom.setAttribute(key, "");
      } else {
        dom.removeAttribute(key);
      }
      (dom as any)[key] = boolValue;
      return;
    }

    // 일반 속성 처리
    if (nextValue == null || nextValue === false) {
      dom.removeAttribute(key);
      try {
        (dom as any)[key] = nextValue;
      } catch {
        // 무시
      }
    } else {
      dom.setAttribute(key, nextValue);
      try {
        (dom as any)[key] = nextValue;
      } catch {
        // 무시
      }
    }
  });
};

/**
 * 주어진 인스턴스에서 실제 DOM 노드(들)를 재귀적으로 찾아 배열로 반환합니다.
 * Fragment나 컴포넌트 인스턴스는 여러 개의 DOM 노드를 가질 수 있습니다.
 */
export const getDomNodes = (instance: Instance | null): (HTMLElement | Text)[] => {
  if (!instance) {
    return [];
  }

  const { kind, dom, children } = instance;

  // HOST 노드: 실제 DOM 요소
  if (kind === NodeTypes.HOST) {
    return dom ? [dom] : [];
  }

  // TEXT 노드: 텍스트 노드
  if (kind === NodeTypes.TEXT) {
    return dom ? [dom] : [];
  }

  // COMPONENT나 FRAGMENT: 자식들을 재귀적으로 탐색
  if (kind === NodeTypes.COMPONENT || kind === NodeTypes.FRAGMENT) {
    const nodes: (HTMLElement | Text)[] = [];
    children.forEach((child) => {
      if (child) {
        nodes.push(...getDomNodes(child));
      }
    });
    return nodes;
  }

  return [];
};

/**
 * 주어진 인스턴스에서 첫 번째 실제 DOM 노드를 찾습니다.
 */
export const getFirstDom = (instance: Instance | null): HTMLElement | Text | null => {
  if (!instance) {
    return null;
  }

  const { kind, dom, children } = instance;

  // HOST 노드: 실제 DOM 요소
  if (kind === NodeTypes.HOST) {
    return dom;
  }

  // TEXT 노드: 텍스트 노드
  if (kind === NodeTypes.TEXT) {
    return dom;
  }

  // COMPONENT나 FRAGMENT: 자식들에서 첫 번째 DOM 노드 찾기
  if (kind === NodeTypes.COMPONENT || kind === NodeTypes.FRAGMENT) {
    return getFirstDomFromChildren(children);
  }

  return null;
};

/**
 * 자식 인스턴스들로부터 첫 번째 실제 DOM 노드를 찾습니다.
 */
export const getFirstDomFromChildren = (children: (Instance | null)[]): HTMLElement | Text | null => {
  for (const child of children) {
    if (child) {
      const firstDom = getFirstDom(child);
      if (firstDom) {
        return firstDom;
      }
    }
  }
  return null;
};

/**
 * 인스턴스를 부모 DOM에 삽입합니다.
 * anchor 노드가 주어지면 그 앞에 삽입하여 순서를 보장합니다.
 */
export const insertInstance = (
  parentDom: HTMLElement,
  instance: Instance | null,
  anchor: HTMLElement | Text | null = null,
): void => {
  if (!instance) {
    return;
  }

  const nodes = getDomNodes(instance);

  if (nodes.length === 0) {
    return;
  }

  // anchor가 있으면 insertBefore, 없으면 appendChild
  if (anchor) {
    // anchor 앞에 모든 노드를 순서대로 삽입
    nodes.forEach((node) => {
      parentDom.insertBefore(node, anchor);
    });
  } else {
    // 마지막에 모든 노드를 순서대로 추가
    nodes.forEach((node) => {
      parentDom.appendChild(node);
    });
  }
};

/**
 * 부모 DOM에서 인스턴스에 해당하는 모든 DOM 노드를 제거합니다.
 */
export const removeInstance = (parentDom: HTMLElement, instance: Instance | null): void => {
  if (!instance) {
    return;
  }

  const nodes = getDomNodes(instance);

  // 각 노드를 부모에서 제거
  nodes.forEach((node) => {
    if (node.parentNode === parentDom) {
      parentDom.removeChild(node);
    }
  });
};
