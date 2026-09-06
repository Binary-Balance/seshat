// Operators in comments are not candidates: >= !==. Unicode: 🎸.
export function inclusive(n: number) { return n >= 18; }
export function exclusive(n: number) { return n > 18; }
export function below(n: number) { return n < 18; }
export function atMost(n: number) { return n <= 18; }
export function equal(n: number) { return n === 18; }
export function different(n: number) { return n !== 18; }
export function loose(n: unknown) { return n == 18; }
export function notLoose(n: unknown) { return n != 18; }
export function missedBoundary(n: number) { return n >= 18; }
export const initialised = inclusive(18);
export function nested(n: number) { return (n < 18) === false; }
export function sideEffects(next: () => number) { return next() /* >= ignored */ <= next(); }
export function narrow(value: string | undefined) {
  if (value !== undefined) return value.length;
  return 0;
}
