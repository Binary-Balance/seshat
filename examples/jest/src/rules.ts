export function classify(age: number) {
  if (age >= 18) return 'adult';
  return 'minor';
}

export function isPositive(value: number) {
  return value > 0;
}
