const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function midiName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${NAMES[pc]}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function pitchRangeLabel(midis: number[]): string {
  if (!midis.length) return "—";
  let lo = midis[0];
  let hi = midis[0];
  for (const m of midis) {
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return lo === hi ? midiName(lo) : `${midiName(lo)}–${midiName(hi)}`;
}
