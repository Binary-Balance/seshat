import {classify, isPositive} from '../src/rules';

test('covers both classification boundaries', () => {
  expect(classify(18)).toBe('adult');
  expect(classify(17)).toBe('minor');
});

test('leaves the positive boundary intentionally unchecked', () => {
  expect(isPositive(1)).toBe(true);
});
