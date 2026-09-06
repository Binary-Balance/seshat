/** @jsxRuntime classic */
/** @jsx React.createElement */
// UTF-8/UTF-16 check: café 日本 🎸.
export function covered(n: number) {
  if (n >= 18) return 'adult';
  return 'minor';
}
export function partial(n: number) {
  if (n > 0) return 'positive';
  return 'non-positive';
}
export function never() {
  return 42;
}
export function empty() {}
export function defaults(value: {n?: number} = {}) {
  return value?.n ?? 0;
}
export function outer(flag: boolean) {
  function inner(n: number) {
    if (n === 1) return 'one';
    return 'other';
  }
  if (flag) return inner(1);
  return 'off';
}
export const first = (n: number) => n < 2; export const second = (n: number) => n > 2;
export function makeElement(_tag: string, _props: unknown, text: string) { return text; }
const React = {createElement: makeElement};
export const view = (n: number) => <span>{n >= 18 ? 'adult' : 'minor'}</span>;
export function containingClass(flag: boolean) {
  class Example {
    value = flag ? 1 : 0;
    static { if (true) {} }
  }
  return new Example().value;
}
