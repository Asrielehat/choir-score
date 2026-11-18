/**
 * Generic repairs for a measure whose notes run past the time signature.
 * Audiveris often reads unbeamed eighths as quarters, adds a dot, or
 * invents a rest. We try those fixes, and only then squeeze every note
 * into the bar. Nothing is deleted just because it starts after the barline.
 */

const EPS = 0.04;

export interface RhythmSlot {
  duration: number;
  rest: boolean;
  /** Sounding pitches. Empty for a rest. */
  pitches: number[];
  tieStart?: boolean;
  tieStop?: boolean;
  beamed?: boolean;
  /** Index into the voice's original events, so a repair can find the notes again. */
  key?: string;
}

export interface RhythmVoice {
  id: string;
  slots: RhythmSlot[];
  /** Beats after the barline before this voice's first event. A voice can enter late. */
  entry?: number;
}

export type RepairKind = "sibling" | "halve" | "dot" | "rest" | "triplet" | "stray" | "compress";

export interface VoiceRepair {
  id: string;
  slots: RhythmSlot[];
  kind: RepairKind | "ok";
  /** How many beats the voice ran past the bar before the repair. */
  overflow: number;
}

function sum(slots: RhythmSlot[]): number {
  return slots.reduce((total, slot) => total + slot.duration, 0);
}

function clone(slots: RhythmSlot[], durations: number[]): RhythmSlot[] {
  return slots.map((slot, index) => ({ ...slot, duration: round(durations[index] ?? slot.duration) }));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fits(slots: RhythmSlot[], signature: number): boolean {
  return Math.abs(sum(slots) - signature) <= EPS;
}

function overflowOf(slots: RhythmSlot[], signature: number): number {
  return sum(slots) - signature;
}

function soundingCount(slots: RhythmSlot[]): number {
  return slots.filter((slot) => !slot.rest).length;
}

/** Melodic intervals, so a tenor line can match a soprano line an octave up. */
function contour(slots: RhythmSlot[]): number[] {
  const pitches = slots.filter((slot) => !slot.rest && slot.pitches.length).map((slot) => slot.pitches[0]);
  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i++) intervals.push(pitches[i] - pitches[i - 1]);
  return intervals;
}

function contourDistance(a: RhythmSlot[], b: RhythmSlot[]): number {
  const left = contour(a);
  const right = contour(b);
  const n = Math.min(left.length, right.length);
  if (!n) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(left[i] - right[i]);
  return total / n + Math.abs(left.length - right.length) * 4;
}

function withDurations(slots: RhythmSlot[], durations: number[]): RhythmSlot[] | null {
  if (durations.length !== slots.length) return null;
  if (durations.some((duration) => !(duration > 0.01))) return null;
  return clone(slots, durations);
}

/** Copy a fitting voice's durations when the two lines have the same number of events. */
function siblingCandidate(slots: RhythmSlot[], siblings: RhythmSlot[][]): RhythmSlot[] | null {
  const sameShape = siblings.filter((sibling) => sibling.length === slots.length && soundingCount(sibling) === soundingCount(slots));
  if (!sameShape.length) return null;
  const ranked = sameShape.slice().sort((a, b) => contourDistance(slots, a) - contourDistance(slots, b));
  return withDurations(
    slots,
    ranked[0].map((slot) => slot.duration),
  );
}

interface Run {
  start: number;
  length: number;
  duration: number;
}

function maximalRuns(slots: RhythmSlot[]): Run[] {
  const runs: Run[] = [];
  let index = 0;
  while (index < slots.length) {
    const slot = slots[index];
    if (slot.rest || slot.beamed || !(slot.duration === 1 || slot.duration === 2)) {
      index++;
      continue;
    }
    let end = index + 1;
    while (
      end < slots.length &&
      !slots[end].rest &&
      !slots[end].beamed &&
      Math.abs(slots[end].duration - slot.duration) < EPS
    ) {
      end++;
    }
    if (end - index >= 2) runs.push({ start: index, length: end - index, duration: slot.duration });
    index = end;
  }
  return runs;
}

/**
 * Halve a run of quarters or halves. Unbeamed eighths are the usual miss.
 * A run may land up to one beat short when the rest that should fill the bar was not read.
 */
function halveCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const runs = maximalRuns(slots);
  let best: { slots: RhythmSlot[]; shortfall: number; length: number } | null = null;
  for (const run of runs) {
    const durations = slots.map((slot, index) =>
      index >= run.start && index < run.start + run.length ? slot.duration / 2 : slot.duration,
    );
    const next = withDurations(slots, durations);
    if (!next) continue;
    const shortfall = signature - sum(next);
    const allowed = shortfall >= -EPS && shortfall <= (run.length >= 4 ? 1 : 0.5) + EPS;
    if (!allowed) continue;
    if (
      !best ||
      shortfall < best.shortfall - EPS ||
      (Math.abs(shortfall - best.shortfall) <= EPS && run.length > best.length)
    ) {
      best = { slots: next, shortfall: Math.max(0, shortfall), length: run.length };
    }
  }
  return best?.slots ?? null;
}

function dotDuration(duration: number): number | null {
  // Dotted values we actually see: eighth, quarter, half, and their doubles.
  const bare = duration * (2 / 3);
  const standard = [0.5, 1, 2, 4];
  if (standard.some((value) => Math.abs(bare - value) < EPS)) return bare;
  return null;
}

function dropDotCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const hits: number[] = [];
  slots.forEach((slot, index) => {
    const bare = dotDuration(slot.duration);
    if (bare == null) return;
    const durations = slots.map((item, itemIndex) => (itemIndex === index ? bare : item.duration));
    if (Math.abs(durations.reduce((total, value) => total + value, 0) - signature) <= EPS) hits.push(index);
  });
  if (hits.length !== 1) return null;
  const bare = dotDuration(slots[hits[0]].duration)!;
  return withDurations(
    slots,
    slots.map((slot, index) => (index === hits[0] ? bare : slot.duration)),
  );
}

function shortenRestCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const overflow = overflowOf(slots, signature);
  if (overflow <= EPS) return null;
  const hits = slots
    .map((slot, index) => ({ slot, index }))
    .filter((item) => item.slot.rest && item.slot.duration > overflow + EPS);
  if (hits.length !== 1) return null;
  return slots.map((slot, index) =>
    index === hits[0].index ? { ...slot, duration: round(slot.duration - overflow) } : { ...slot },
  );
}

function dropRestCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const overflow = overflowOf(slots, signature);
  if (overflow <= EPS) return null;
  const hits = slots
    .map((slot, index) => ({ slot, index }))
    .filter((item) => item.slot.rest && Math.abs(item.slot.duration - overflow) <= EPS);
  if (hits.length !== 1) return null;
  return slots.filter((_, index) => index !== hits[0].index).map((slot) => ({ ...slot }));
}

function tripletCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const hits: number[] = [];
  for (let index = 0; index <= slots.length - 3; index++) {
    const group = slots.slice(index, index + 3);
    if (group.some((slot) => slot.rest || slot.beamed)) continue;
    const duration = group[0].duration;
    if (group.some((slot) => Math.abs(slot.duration - duration) > EPS)) continue;
    if (!(duration === 0.5 || duration === 1 || duration === 2)) continue;
    const durations = slots.map((slot, slotIndex) =>
      slotIndex >= index && slotIndex < index + 3 ? (slot.duration * 2) / 3 : slot.duration,
    );
    if (Math.abs(durations.reduce((total, value) => total + value, 0) - signature) <= EPS) hits.push(index);
  }
  if (hits.length !== 1) return null;
  const index = hits[0];
  return withDurations(
    slots,
    slots.map((slot, slotIndex) => (slotIndex >= index && slotIndex < index + 3 ? (slot.duration * 2) / 3 : slot.duration)),
  );
}

function strayCandidate(slots: RhythmSlot[], signature: number): RhythmSlot[] | null {
  const hits: number[] = [];
  for (let index = 1; index < slots.length - 1; index++) {
    const slot = slots[index];
    if (slot.rest || slot.pitches.length !== 1) continue;
    const previous = slots[index - 1];
    const next = slots[index + 1];
    if (previous.rest || next.rest || !previous.pitches.length || !next.pitches.length) continue;
    const pitch = slot.pitches[0];
    if (Math.abs(pitch - previous.pitches[0]) < 12 || Math.abs(pitch - next.pitches[0]) < 12) continue;
    const kept = slots.filter((_, slotIndex) => slotIndex !== index);
    if (Math.abs(sum(kept) - signature) <= EPS) hits.push(index);
  }
  if (hits.length !== 1) return null;
  return slots.filter((_, index) => index !== hits[0]).map((slot) => ({ ...slot }));
}

function compress(slots: RhythmSlot[], signature: number): RhythmSlot[] {
  const total = sum(slots);
  const ratio = signature / total;
  const durations = slots.map((slot) => slot.duration * ratio);
  const drift = signature - durations.reduce((totalValue, value) => totalValue + value, 0);
  durations[durations.length - 1] += drift;
  return clone(slots, durations);
}

function repairVoice(slots: RhythmSlot[], signature: number, siblings: RhythmSlot[][]): { slots: RhythmSlot[]; kind: RepairKind } {
  const ordered: { kind: RepairKind; slots: RhythmSlot[] | null }[] = [
    { kind: "sibling", slots: siblingCandidate(slots, siblings) },
    { kind: "halve", slots: halveCandidate(slots, signature) },
    { kind: "dot", slots: dropDotCandidate(slots, signature) },
    { kind: "rest", slots: dropRestCandidate(slots, signature) ?? shortenRestCandidate(slots, signature) },
    { kind: "triplet", slots: tripletCandidate(slots, signature) },
    { kind: "stray", slots: strayCandidate(slots, signature) },
  ];
  for (const candidate of ordered) {
    if (candidate.slots && (fits(candidate.slots, signature) || sum(candidate.slots) <= signature + EPS)) {
      return { slots: candidate.slots, kind: candidate.kind };
    }
  }
  return { slots: compress(slots, signature), kind: "compress" };
}

const KIND_ZH: Record<RepairKind, string> = {
  sibling: "已按同一小节里其他声部的节奏把偏长的音符改短",
  halve: "一串等长的音符像是把较短的时值认长了一倍，已把这一串缩短",
  dot: "去掉了一个多出来的附点",
  rest: "把一个偏长的休止符缩短，后面的音符前移",
  triplet: "三个等长的音符按三连音缩短",
  stray: "拿掉了一个离前后音很远的音",
  compress: "没有可靠的改法，全部音符都保留，并按比例压进拍号",
};

export function repairOverfullMeasure(voices: RhythmVoice[], signature: number, measureLabel: string): {
  voices: VoiceRepair[];
  warning?: string;
} {
  const used = (voice: RhythmVoice) => (voice.entry ?? 0) + sum(voice.slots);
  const fitting = voices.filter((voice) => used(voice) <= signature + EPS).map((voice) => voice.slots);
  const repaired: VoiceRepair[] = voices.map((voice) => {
    const overflow = used(voice) - signature;
    if (overflow <= EPS || voice.slots.length === 0) {
      return { id: voice.id, slots: voice.slots, kind: "ok", overflow: 0 };
    }
    const target = Math.max(0.25, signature - (voice.entry ?? 0));
    const next = repairVoice(voice.slots, target, fitting);
    return { id: voice.id, slots: next.slots, kind: next.kind, overflow };
  });
  const changed = repaired.filter((voice) => voice.kind !== "ok");
  if (!changed.length) return { voices: repaired };
  const kind = changed.some((voice) => voice.kind === "compress")
    ? "compress"
    : (changed[0].kind as RepairKind);
  const worst = Math.max(...changed.map((voice) => voice.overflow));
  const beats = Math.round(worst * 100) / 100;
  return {
    voices: repaired,
    warning: `第 ${measureLabel} 小节多了 ${beats} 拍。${KIND_ZH[kind]}。请在卷帘里核对，后面的音乐不后移。`,
  };
}
