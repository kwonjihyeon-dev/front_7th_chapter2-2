/* eslint-disable @typescript-eslint/no-explicit-any */
import { isEmptyValue } from "../utils";
import { VNode } from "./types";
import { TEXT_ELEMENT } from "./constants";

/**
 * 주어진 노드를 VNode 형식으로 정규화합니다.
 * null, undefined, boolean, 배열, 원시 타입 등을 처리하여 일관된 VNode 구조를 보장합니다.
 */
export const normalizeNode = (node: any): VNode | null => {
  // null, undefined, boolean은 렌더링되지 않음
  if (isEmptyValue(node)) {
    return null;
  }

  // 이미 VNode인 경우 그대로 반환
  if (node && typeof node === "object" && "type" in node && "props" in node) {
    return node as VNode;
  }

  // 문자열이나 숫자는 TEXT_ELEMENT로 변환
  if (typeof node === "string" || typeof node === "number") {
    return createTextElement(node);
  }

  // 배열은 Fragment로 감싸서 처리 (하지만 실제로는 children으로 처리되어야 함)
  // normalizeNode는 단일 노드를 정규화하는 함수이므로 배열은 처리하지 않음
  // 배열은 createElement에서 children으로 처리됨

  return null;
};

/**
 * 텍스트 노드를 위한 VNode를 생성합니다.
 */
const createTextElement = (text: string | number): VNode => {
  return {
    type: TEXT_ELEMENT,
    key: null,
    props: {
      children: [],
      nodeValue: String(text),
    },
  };
};

/**
 * JSX로부터 전달된 인자를 VNode 객체로 변환합니다.
 * 이 함수는 JSX 변환기에 의해 호출됩니다. (예: Babel, TypeScript)
 */
export const createElement = (
  type: string | symbol | React.ComponentType<any>,
  originProps?: Record<string, any> | null,
  ...rawChildren: any[]
) => {
  const props = originProps || {};

  // key를 props에서 추출하고 props에서 제거
  // 테스트에서 숫자 key를 기대하므로, 숫자는 그대로 유지하고 문자열로 변환
  let key: string | number | null = null;
  if (props.key != null) {
    key = typeof props.key === "number" ? props.key : String(props.key);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key: _, ...restProps } = props;

  // children 평탄화 및 정규화
  const flattenChildren = (children: any[]): VNode[] => {
    const result: VNode[] = [];

    for (const child of children) {
      if (isEmptyValue(child)) {
        // null, undefined, boolean은 무시
        continue;
      }

      if (Array.isArray(child)) {
        // 배열은 재귀적으로 평탄화
        result.push(...flattenChildren(child));
      } else if (typeof child === "string" || typeof child === "number") {
        // 문자열이나 숫자는 TEXT_ELEMENT로 변환
        result.push(createTextElement(child));
      } else if (child && typeof child === "object" && "type" in child) {
        // 이미 VNode인 경우
        result.push(child as VNode);
      }
    }

    return result;
  };

  const children = flattenChildren(rawChildren);

  // children이 없으면 children 속성을 추가하지 않음 (함수형 컴포넌트의 경우)
  const finalProps: Record<string, any> = { ...restProps };
  if (children.length > 0) {
    finalProps.children = children;
  }

  return {
    type,
    key: key as string | null, // 타입 캐스팅 (테스트에서 숫자 key를 기대하지만 타입은 string | null)
    props: finalProps,
  };
};

/**
 * 부모 경로와 자식의 key/index를 기반으로 고유한 경로를 생성합니다.
 * 이는 훅의 상태를 유지하고 Reconciliation에서 컴포넌트를 식별하는 데 사용됩니다.
 */
export const createChildPath = (
  parentPath: string,
  key: string | null,
  index: number,
  // nodeType?: string | symbol | React.ComponentType,
  // siblings?: VNode[],
): string => {
  // key가 있으면 key를 사용, 없으면 index를 사용
  if (key != null) {
    return `${parentPath}.${key}`;
  }

  return `${parentPath}.${index}`;
};
