import type { NoteEvent } from "@/lib/types";

export const PITCH_MIN = 21;
export const PITCH_MAX = 108;
export const KEY_W = 58;
export const RULER_H = 32;

export function contentHeight(zoomY: number) {
  return (PITCH_MAX - PITCH_MIN + 1) * zoomY;
}

export function rowTop(midi: number, zoomY: number, scrollY: number) {
  return RULER_H + (PITCH_MAX - midi) * zoomY - scrollY;
}

export function yToMidiFloat(y: number, zoomY: number, scrollY: number) {
  return PITCH_MAX - (y - RULER_H + scrollY) / zoomY;
}

export function yToMidi(y: number, zoomY: number, scrollY: number) {
  return Math.round(yToMidiFloat(y, zoomY, scrollY));
}

export function beatToX(beat: number, zoomX: number, scrollX: number) {
  return KEY_W + beat * zoomX - scrollX;
}

export function xToBeat(x: number, zoomX: number, scrollX: number) {
  return (x - KEY_W + scrollX) / zoomX;
}

export interface NoteHit {
  id: string;
  edge: "left" | "right" | "body";
}

/**
 * `allowed` is the set of audible track ids. A note on a muted (or non-soloed) track is
 * drawn faded and must not be hit, otherwise two overlapping notes in different parts
 * fight over the click.
 */
export function hitTestNote(
  x: number,
  y: number,
  notes: NoteEvent[],
  selection: Set<string>,
  zoomX: number,
  zoomY: number,
  scrollX: number,
  scrollY: number,
  allowed?: Set<string>,
): NoteHit | null {
  const midi = yToMidi(y, zoomY, scrollY);
  const beat = xToBeat(x, zoomX, scrollX);
  const ordered = notes
    .filter((note) => !allowed || allowed.has(note.trackId))
    .map((note, index) => ({ note, index }))
    .sort((a, b) => {
      const as = selection.has(a.note.id) ? 1 : 0;
      const bs = selection.has(b.note.id) ? 1 : 0;
      return as - bs || a.index - b.index;
    });
  for (let i = ordered.length - 1; i >= 0; i--) {
    const note = ordered[i].note;
    if (note.midi !== midi) continue;
    const left = beatToX(note.startBeat, zoomX, scrollX);
    const width = Math.max(note.durationBeats * zoomX, 7);
    if (x < left || x > left + width) continue;
    if (beat < note.startBeat - 0.02 || beat > note.startBeat + note.durationBeats + 0.05) {
      if (x > left + width) continue;
    }
    const edge = width > 14 ? 6 : 4;
    if (x >= left + width - edge) return { id: note.id, edge: "right" };
    if (width > 16 && x <= left + edge) return { id: note.id, edge: "left" };
    return { id: note.id, edge: "body" };
  }
  return null;
}
