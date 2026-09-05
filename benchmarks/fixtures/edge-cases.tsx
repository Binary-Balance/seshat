// Unicode offsets: café 日本 🎸. Operators in comments: >= !==.
type Conditional<T> = T extends string ? true : false;
declare function absent(x: number): boolean;
export function basic(a: number, b: number) {
  if (a /* >= ignored */ >= b) return a !== b;
  const inner = (n: number) => n < 5 ? n > 0 : n == 0;
  for (let i = 0; i <= 3; i++) { if (inner(i) && a != b) break; }
  return a === b || a > b;
}
export class Example {
  constructor(public n: number) {}
  get positive() { return this.n > 0; }
  method(x: number = 1) {
    try {
      while (x < 4) x++;
      do { x--; } while (x > 2);
      for (const a of [1,2]) x += a;
      for (const k in {a: 1}) x += k.length;
      switch (x) { case 1: return true; case 2: return false; default: return x >= 0; }
    } catch { return false; }
  }
}
export const view = (n: number) => (<div>{n >= 3 ? 'yes' : 'no'}</div>);
export const defaults = (v?: number) => { v ??= 2; return v ?? 0; };
