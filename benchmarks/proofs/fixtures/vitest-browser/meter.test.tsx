import {afterEach, expect, test} from 'vitest';
import {mountMeter} from './meter.tsx';
let mounted: ReturnType<typeof mountMeter> | undefined;
afterEach(() => { mounted?.unmount(); document.body.replaceChildren(); });
test('meter bands and laid-out width', () => {
  const host = document.body.appendChild(document.createElement('div'));
  mounted = mountMeter(host, 0.8);
  expect(mounted).toMatchObject({band: 'hot', width: 80});
  mounted.unmount();
  mounted = mountMeter(host, 0.5);
  expect(mounted.band).toBe('live');
});
