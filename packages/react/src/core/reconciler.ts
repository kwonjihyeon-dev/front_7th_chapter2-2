import { context } from "./context";
import { Fragment, NodeTypes, TEXT_ELEMENT } from "./constants";
import { Instance, VNode } from "./types";
import {
  getFirstDom,
  getFirstDomFromChildren,
  insertInstance,
  removeInstance,
  setDomProps,
  updateDomProps,
} from "./dom";
import { createChildPath } from "./elements";

/**
 * HOST 노드(일반 DOM 요소)를 마운트합니다.
 */
const mountHost = (parentDom: HTMLElement, node: VNode, path: string): Instance => {
  const { type, props } = node;
  const dom = document.createElement(type as string);

  // 속성 설정
  setDomProps(dom, props);

  // 인스턴스 생성
  const instance: Instance = {
    kind: NodeTypes.HOST,
    dom,
    node,
    children: [],
    key: node.key,
    path,
  };

  // 자식 재조정
  const childNodes = props.children || [];
  instance.children = childNodes.map((child: VNode, index: number) => {
    if (!child) return null;
    const childPath = createChildPath(path, child.key, index);
    return reconcile(dom, null, child, childPath);
  });

  // DOM에 삽입
  insertInstance(parentDom, instance);

  return instance;
};

/**
 * TEXT 노드를 마운트합니다.
 */
const mountText = (parentDom: HTMLElement, node: VNode, path: string): Instance => {
  const textNode = document.createTextNode(node.props.nodeValue || "");

  const instance: Instance = {
    kind: NodeTypes.TEXT,
    dom: textNode,
    node,
    children: [],
    key: node.key,
    path,
  };

  // DOM에 삽입
  insertInstance(parentDom, instance);

  return instance;
};

/**
 * 컴포넌트를 마운트합니다.
 */
const mountComponent = (parentDom: HTMLElement, node: VNode, path: string): Instance => {
  const component = node.type as React.ComponentType;
  const { props } = node;

  // 컴포넌트 스택에 추가
  context.hooks.componentStack.push(path);
  context.hooks.cursor.set(path, 0);
  context.hooks.visited.add(path);

  let childVNode: VNode | null = null;
  try {
    // 컴포넌트 함수 실행
    childVNode = component(props);
  } finally {
    // 스택에서 제거 (하지만 path는 visited에 남아있음)
    context.hooks.componentStack.pop();
  }

  // 자식 재조정
  const instance: Instance = {
    kind: NodeTypes.COMPONENT,
    dom: null,
    node,
    children: [],
    key: node.key,
    path,
  };

  if (childVNode) {
    const childPath = createChildPath(path, childVNode.key, 0);
    const childInstance = reconcile(parentDom, null, childVNode, childPath);
    instance.children = [childInstance];
    // 컴포넌트의 dom은 자식의 첫 번째 dom
    instance.dom = getFirstDom(childInstance);
  }

  return instance;
};

/**
 * Fragment를 마운트합니다.
 */
const mountFragment = (parentDom: HTMLElement, node: VNode, path: string): Instance => {
  const { props } = node;
  const childNodes = props.children || [];

  const instance: Instance = {
    kind: NodeTypes.FRAGMENT,
    dom: null,
    node,
    children: [],
    key: node.key,
    path,
  };

  // 자식 재조정
  instance.children = childNodes.map((child: VNode, index: number) => {
    if (!child) return null;
    const childPath = createChildPath(path, child.key, index);
    return reconcile(parentDom, null, child, childPath);
  });

  // Fragment의 dom은 자식의 첫 번째 dom
  instance.dom = getFirstDomFromChildren(instance.children);

  return instance;
};

/**
 * HOST 노드를 업데이트합니다.
 */
const updateHost = (parentDom: HTMLElement, instance: Instance, newNode: VNode): Instance => {
  const { dom, node } = instance;

  if (!dom) {
    throw new Error("HOST 인스턴스에 DOM이 없습니다");
  }

  // HOST 인스턴스의 dom은 항상 HTMLElement
  if (!(dom instanceof HTMLElement)) {
    throw new Error("HOST 인스턴스의 DOM이 HTMLElement가 아닙니다");
  }

  // 속성 업데이트
  updateDomProps(dom, node.props, newNode.props);

  // 자식 재조정
  const oldChildren = instance.children;
  const newChildren = newNode.props.children || [];

  instance.children = reconcileChildren(parentDom, dom, oldChildren, newChildren, instance.path);

  // 노드 정보 업데이트
  instance.node = newNode;

  return instance;
};

/**
 * TEXT 노드를 업데이트합니다.
 */
const updateText = (instance: Instance, newNode: VNode): Instance => {
  const { dom } = instance;

  if (!dom || !(dom instanceof Text)) {
    throw new Error("TEXT 인스턴스에 Text DOM이 없습니다");
  }

  // 텍스트 내용 업데이트
  const newValue = newNode.props.nodeValue || "";
  if (dom.textContent !== newValue) {
    dom.textContent = newValue;
  }

  // 노드 정보 업데이트
  instance.node = newNode;

  return instance;
};

/**
 * 컴포넌트를 업데이트합니다.
 */
const updateComponent = (parentDom: HTMLElement, instance: Instance, newNode: VNode): Instance => {
  const component = newNode.type as React.ComponentType;
  const { path } = instance;

  // 컴포넌트 스택에 추가
  context.hooks.componentStack.push(path);
  context.hooks.cursor.set(path, 0);
  context.hooks.visited.add(path);

  let childVNode: VNode | null = null;
  try {
    // 컴포넌트 함수 재실행
    childVNode = component(newNode.props);
  } finally {
    // 스택에서 제거
    context.hooks.componentStack.pop();
  }

  // 자식 재조정
  const oldChildInstance = instance.children[0] || null;
  // childVNode가 null이면 oldChildInstance의 path를 사용, 없으면 새 path 생성
  const childPath = childVNode
    ? createChildPath(path, childVNode.key, 0)
    : oldChildInstance
      ? oldChildInstance.path
      : createChildPath(path, null, 0);
  const newChildInstance = reconcile(parentDom, oldChildInstance, childVNode, childPath);

  instance.children = [newChildInstance];
  instance.node = newNode;
  instance.dom = getFirstDom(newChildInstance);

  return instance;
};

/**
 * Fragment를 업데이트합니다.
 */
const updateFragment = (parentDom: HTMLElement, instance: Instance, newNode: VNode): Instance => {
  const oldChildren = instance.children;
  const newChildren = newNode.props.children || [];

  // 자식 재조정
  instance.children = reconcileChildren(parentDom, parentDom, oldChildren, newChildren, instance.path);

  // 노드 정보 업데이트
  instance.node = newNode;
  instance.dom = getFirstDomFromChildren(instance.children);

  return instance;
};

/**
 * 자식 노드들을 재조정합니다.
 * key 기반 매칭과 anchor를 사용하여 효율적으로 업데이트합니다.
 */
const reconcileChildren = (
  parentDom: HTMLElement,
  containerDom: HTMLElement,
  oldChildren: (Instance | null)[],
  newChildren: VNode[],
  parentPath: string,
): (Instance | null)[] => {
  // key가 있는 기존 자식들을 맵으로 저장
  const keyedOldChildren = new Map<string | number, Instance>();
  const keyedOldChildrenIndices = new Map<string | number, number>();

  oldChildren.forEach((oldChild, index) => {
    if (oldChild && oldChild.key != null) {
      keyedOldChildren.set(oldChild.key, oldChild);
      keyedOldChildrenIndices.set(oldChild.key, index);
    }
  });

  // 사용된 기존 자식 추적
  const usedOldChildren = new Set<number>();

  // 새로운 자식들을 처리 (뒤에서 앞으로 순회하여 anchor 계산)
  const result: (Instance | null)[] = [];
  const newInstances: (Instance | null)[] = [];

  for (let i = newChildren.length - 1; i >= 0; i--) {
    const newChild = newChildren[i];
    if (!newChild) {
      newInstances[i] = null;
      result[i] = null;
      continue;
    }

    let newInstance: Instance | null = null;

    // key가 있으면 keyed 맵에서 찾기
    if (newChild.key != null && keyedOldChildren.has(newChild.key)) {
      const oldInstance = keyedOldChildren.get(newChild.key)!;
      const oldIndex = keyedOldChildrenIndices.get(newChild.key)!;
      usedOldChildren.add(oldIndex);

      // 타입 비교
      if (oldInstance.node.type === newChild.type) {
        // 업데이트
        const childPath = createChildPath(parentPath, newChild.key, i);
        newInstance = reconcile(containerDom, oldInstance, newChild, childPath);
      } else {
        // 타입이 다르면 언마운트 후 새로 마운트
        removeInstance(containerDom, oldInstance);
        const childPath = createChildPath(parentPath, newChild.key, i);
        newInstance = reconcile(containerDom, null, newChild, childPath);
      }
    } else {
      // key가 없으면 타입과 위치로 찾기
      let matchedOldIndex = -1;
      for (let j = 0; j < oldChildren.length; j++) {
        if (!usedOldChildren.has(j) && oldChildren[j]) {
          const oldInstance = oldChildren[j]!;
          if (oldInstance.node.type === newChild.type && oldInstance.key === newChild.key) {
            matchedOldIndex = j;
            usedOldChildren.add(j);
            break;
          }
        }
      }

      if (matchedOldIndex >= 0) {
        // 매칭되는 기존 인스턴스 발견 - 업데이트
        const oldInstance = oldChildren[matchedOldIndex]!;
        const childPath = createChildPath(parentPath, newChild.key, i);
        newInstance = reconcile(containerDom, oldInstance, newChild, childPath);
      } else {
        // 새로 마운트
        const childPath = createChildPath(parentPath, newChild.key, i);
        newInstance = reconcile(containerDom, null, newChild, childPath);
      }
    }

    newInstances[i] = newInstance;
    result[i] = newInstance;
  }

  // 순서대로 DOM에 삽입/재배치
  let nextAnchor: HTMLElement | Text | null = null;
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const newInstance = newInstances[i];
    if (!newInstance) continue;

    const firstDom = getFirstDom(newInstance);
    if (!firstDom) continue;

    // 기존 DOM 위치 확인
    const currentParent = firstDom.parentNode;
    const needsMove = currentParent !== containerDom || (nextAnchor && firstDom.nextSibling !== nextAnchor);

    if (needsMove) {
      // 재배치 필요
      removeInstance(containerDom, newInstance);
      insertInstance(containerDom, newInstance, nextAnchor);
    }

    nextAnchor = firstDom;
  }

  // 사용되지 않은 기존 자식들 언마운트
  // cleanup은 render() 함수에서 state 초기화 전에 실행되므로 여기서는 DOM 제거만 수행
  for (let i = 0; i < oldChildren.length; i++) {
    if (!usedOldChildren.has(i) && oldChildren[i]) {
      const oldInstance = oldChildren[i]!;
      // DOM 제거 (cleanup은 render()에서 실행됨)
      removeInstance(containerDom, oldInstance);
    }
  }

  return result;
};

/**
 * 이전 인스턴스와 새로운 VNode를 비교하여 DOM을 업데이트하는 재조정 과정을 수행합니다.
 *
 * @param parentDom - 부모 DOM 요소
 * @param instance - 이전 렌더링의 인스턴스
 * @param node - 새로운 VNode
 * @param path - 현재 노드의 고유 경로
 * @returns 업데이트되거나 새로 생성된 인스턴스
 */

/**
 * 이전 인스턴스와 새로운 VNode를 비교하여 DOM을 업데이트하는 재조정 과정을 수행합니다.
 *
 * @param parentDom - 부모 DOM 요소
 * @param instance - 이전 렌더링의 인스턴스
 * @param node - 새로운 VNode
 * @param path - 현재 노드의 고유 경로
 * @returns 업데이트되거나 새로 생성된 인스턴스
 */
export const reconcile = (
  parentDom: HTMLElement,
  instance: Instance | null,
  node: VNode | null,
  path: string,
): Instance | null => {
  // 1. 새 노드가 null이면 기존 인스턴스를 제거합니다. (unmount)
  // cleanup은 render() 함수에서 state 초기화 전에 실행되므로 여기서는 DOM 제거만 수행
  if (!node) {
    if (instance) {
      // DOM 제거 (cleanup은 render()에서 실행됨)
      removeInstance(parentDom, instance);
    }
    return null;
  }

  // 2. 기존 인스턴스가 없으면 새 노드를 마운트합니다. (mount)
  if (!instance) {
    if (node.type === TEXT_ELEMENT) {
      return mountText(parentDom, node, path);
    } else if (node.type === Fragment) {
      return mountFragment(parentDom, node, path);
    } else if (typeof node.type === "function") {
      return mountComponent(parentDom, node, path);
    } else {
      return mountHost(parentDom, node, path);
    }
  }

  // 3. 타입이나 키가 다르면 기존 인스턴스를 제거하고 새로 마운트합니다.
  // cleanup은 render() 함수에서 state 초기화 전에 실행되므로 여기서는 DOM 제거만 수행
  if (instance.node.type !== node.type || instance.key !== node.key) {
    // DOM 제거 (cleanup은 render()에서 실행됨)
    removeInstance(parentDom, instance);
    // 재귀 호출로 새로 마운트
    return reconcile(parentDom, null, node, path);
  }

  // 4. 타입과 키가 같으면 인스턴스를 업데이트합니다. (update)
  if (instance.kind === NodeTypes.HOST) {
    return updateHost(parentDom, instance, node);
  } else if (instance.kind === NodeTypes.TEXT) {
    return updateText(instance, node);
  } else if (instance.kind === NodeTypes.COMPONENT) {
    return updateComponent(parentDom, instance, node);
  } else if (instance.kind === NodeTypes.FRAGMENT) {
    return updateFragment(parentDom, instance, node);
  }

  return null;
};
