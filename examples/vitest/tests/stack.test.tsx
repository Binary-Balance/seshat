import {renderToStaticMarkup} from 'react-dom/server';
import {expect, test} from 'vitest';
import {createApp} from '../src/server.ts';
import {tempoLabel} from '../src/tempo.ts';
import {Tempo} from '../src/view.tsx';

test('pure rule has inclusive boundaries', () => {
  expect([59, 60, 120, 121].map(tempoLabel)).toEqual([
    'slow',
    'steady',
    'steady',
    'fast',
  ]);
});

test('React TSX displays the rule result', () => {
  expect(renderToStaticMarkup(<Tempo bpm={60}/>)).toBe('<output>steady</output>');
});

test('Fastify validates transport without a listener', async () => {
  const app = createApp();
  try {
    for (const [bpm, label] of [[59, 'slow'], [60, 'steady'], [120, 'steady'], [121, 'fast']] as const) {
      const response = await app.inject({method: 'GET', url: '/tempo?bpm=' + bpm});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({label});
    }
    expect((await app.inject({method: 'GET', url: '/tempo?bpm=no'})).statusCode).toBe(400);
    expect((await app.inject({method: 'GET', url: '/tempo'})).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
