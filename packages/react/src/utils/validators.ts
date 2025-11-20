/**
 * VNode가 렌더링되지 않아야 하는 값인지 확인합니다.
 * (예: null, undefined, boolean)
 *
 * @param value - 확인할 값
 * @returns 렌더링되지 않아야 하면 true, 그렇지 않으면 false
 */
export const isEmptyValue = (value: unknown): boolean => {
  return value === null || value === undefined || typeof value === "boolean";
};
