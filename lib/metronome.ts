/**
 * Pull a metronome mark out of a header OCR line.
 * Audiveris often misses "♩ = 80"; Tesseract then returns something like "2=80".
 * Require an equals sign so a page number or a year is not treated as a tempo.
 */
export function readMetronomeBpm(ocrText: string): number | null {
  const matches = ocrText.matchAll(/=\s*(\d{2,3})/g);
  for (const match of matches) {
    const bpm = Number(match[1]);
    if (bpm >= 36 && bpm <= 240) return bpm;
  }
  return null;
}
