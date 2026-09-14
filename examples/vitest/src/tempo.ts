export function tempoLabel(bpm: number): string {
  if (bpm < 60) return 'slow';
  if (bpm > 120) return 'fast';
  return 'steady';
}
