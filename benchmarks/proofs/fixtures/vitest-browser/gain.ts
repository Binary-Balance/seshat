export async function renderPeak(gain: number): Promise<number> {
  const context = new OfflineAudioContext(1, 128, 44100);
  const source = new ConstantSourceNode(context, {offset: 1});
  const amplifier = new GainNode(context, {gain: gain > 1 ? 1 : gain});
  source.connect(amplifier).connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  let peak = 0;
  for (const sample of rendered.getChannelData(0)) if (Math.abs(sample) > peak) peak = Math.abs(sample);
  return peak;
}
export function describeLevel(peak: number) {
  return peak >= 1 ? 'clipping' : peak > 0 ? 'signal' : 'silent';
}
