import { ROLE_META, type NoteEvent, type Role } from "./types";

/**
 * Expected sounding range for the *median* of a part, not its highest note.
 * A median this far outside means the clef or octave was read wrong.
 */
const MEDIAN_RANGE: Record<Role, [number, number]> = {
  soprano: [60, 81],
  alto: [55, 76],
  tenor: [48, 69],
  bass: [40, 64],
  "piano-rh": [52, 91],
  "piano-lh": [33, 67],
  cello: [36, 72],
};

function distance(midi: number, low: number, high: number): number {
  if (midi < low) return low - midi;
  if (midi > high) return midi - high;
  return 0;
}

/** Whole-octave shift that brings a part's median into its voice, or 0. */
export function octaveShiftForRole(role: Role, midis: number[]): number {
  if (midis.length < 4) return 0;
  const sorted = midis.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const [low, high] = MEDIAN_RANGE[role];
  const current = distance(median, low, high);
  // A semitone or two outside the box is a high note, not a wrong clef.
  if (current < 6) return 0;
  let best = 0;
  let bestDistance = current;
  // Smaller octaves first, so a one-octave fix wins over a two-octave fix that also lands inside.
  for (const shift of [-12, 12, -24, 24]) {
    const next = distance(median + shift, low, high);
    if (next < bestDistance) {
      best = shift;
      bestDistance = next;
    }
  }
  return best;
}

export function correctRoleOctaves(notes: NoteEvent[]): { notes: NoteEvent[]; warnings: string[] } {
  const warnings: string[] = [];
  const byRole = new Map<string, number[]>();
  for (const note of notes) {
    const list = byRole.get(note.trackId);
    if (list) list.push(note.midi);
    else byRole.set(note.trackId, [note.midi]);
  }
  const shifts = new Map<string, number>();
  for (const [role, midis] of byRole) {
    if (!(role in MEDIAN_RANGE)) continue;
    const shift = octaveShiftForRole(role as Role, midis);
    if (!shift) continue;
    shifts.set(role, shift);
    const meta = ROLE_META[role as Role];
    const direction = shift < 0 ? "高了八度，已降下" : "低了八度，已升起";
    const octaves = Math.abs(shift) / 12;
    warnings.push(
      `${meta.nameZh}的音区${direction}${octaves === 1 ? "" : ` ${octaves} 个八度`}，按这个声部的常用音区改到实际音高。`,
    );
  }
  if (!shifts.size) return { notes, warnings };
  return {
    warnings,
    notes: notes.map((note) => {
      const shift = shifts.get(note.trackId);
      if (!shift) return note;
      const midi = Math.max(0, Math.min(127, note.midi + shift));
      return midi === note.midi ? note : { ...note, midi };
    }),
  };
}
