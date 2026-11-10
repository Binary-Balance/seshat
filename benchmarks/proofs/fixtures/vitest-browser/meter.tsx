import React from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
export function Meter({level}: {level: number}) {
  const band = (value: number) => value >= 0.8 ? 'hot' : value > 0 ? 'live' : 'silent';
  return <meter className={band(level)} value={level} style={{width: `${Math.round(level * 100)}px`, display: 'block'}} />;
}
export function mountMeter(host: HTMLElement, level: number) {
  const root = createRoot(host);
  flushSync(() => root.render(<Meter level={level} />));
  const meter = host.firstElementChild;
  // Layout width needs a real rendering engine, not a DOM emulation.
  return {band: meter?.className ?? '', width: meter ? meter.getBoundingClientRect().width : 0, unmount: () => root.unmount()};
}
