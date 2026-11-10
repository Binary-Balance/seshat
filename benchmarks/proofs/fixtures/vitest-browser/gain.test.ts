import {expect, test} from 'vitest';
import {describeLevel, renderPeak} from './gain.ts';
test('offline Web Audio rendering clamps gain', async () => {
  expect(await renderPeak(0.5)).toBe(0.5);
  expect(await renderPeak(2)).toBe(1);
});
test('level descriptions', () => {
  expect(describeLevel(1)).toBe('clipping');
  expect(describeLevel(0.5)).toBe('signal');
});
