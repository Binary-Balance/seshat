import React from 'react';
import {tempoLabel} from './tempo.ts';
export function Tempo({bpm}: {bpm: number}) {
  return <output>{tempoLabel(bpm)}</output>;
}
