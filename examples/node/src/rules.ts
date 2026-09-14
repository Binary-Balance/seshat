export function classify(age: number): 'adult' | 'minor' {
  if (age >= 18) return 'adult';
  return 'minor';
}

export const isPositive = (value: number) => value > 0;
