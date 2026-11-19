import type { MeasureSpan, MeterPoint, ScoreProject, TempoPoint } from "./types";

export function measureLengthBeats(meter: { beats: number; beatType: number }): number {
  const beats = meter.beats > 0 ? meter.beats : 4;
  const beatType = meter.beatType > 0 ? meter.beatType : 4;
  return beats * (4 / beatType);
}

export function normalizeTempos(tempos: TempoPoint[]): TempoPoint[] {
  const sorted = (tempos.length ? tempos : [{ beat: 0, bpm: 120 }])
    .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0)
    .slice()
    .sort((a, b) => a.beat - b.beat);
  if (!sorted.length) return [{ beat: 0, bpm: 120 }];
  if (sorted[0].beat > 1e-6) sorted.unshift({ beat: 0, bpm: sorted[0].bpm });
  const out: TempoPoint[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - t.beat) < 1e-6) out[out.length - 1] = t;
    else out.push({ beat: t.beat, bpm: t.bpm });
  }
  return out;
}

/** Quarter-note beats → seconds. Tempo changes apply at their beat, with no gap. */
export function beatToSeconds(beat: number, tempos: TempoPoint[]): number {
  const points = normalizeTempos(tempos);
  if (beat <= points[0].beat) {
    return ((beat - points[0].beat) * 60) / points[0].bpm;
  }
  let seconds = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].beat;
    const end = i + 1 < points.length ? points[i + 1].beat : Number.POSITIVE_INFINITY;
    if (beat <= start) break;
    const segEnd = Math.min(beat, end);
    seconds += ((segEnd - start) * 60) / points[i].bpm;
    if (beat <= end + 1e-9) break;
  }
  return seconds;
}

export function secondsToBeat(seconds: number, tempos: TempoPoint[]): number {
  const points = normalizeTempos(tempos);
  if (seconds <= 0) return points[0].beat;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].beat;
    const end = i + 1 < points.length ? points[i + 1].beat : Number.POSITIVE_INFINITY;
    const segBeats = end - start;
    const segSeconds = (segBeats * 60) / points[i].bpm;
    if (!Number.isFinite(segSeconds) || seconds <= acc + segSeconds + 1e-9) {
      return start + ((seconds - acc) * points[i].bpm) / 60;
    }
    acc += segSeconds;
  }
  return points[points.length - 1].beat;
}

export function buildMeasures(meters: MeterPoint[], endBeat: number): MeasureSpan[] {
  const source = (meters.length ? meters : [{ beat: 0, beats: 4, beatType: 4 }])
    .slice()
    .sort((a, b) => a.beat - b.beat);
  if (source[0].beat > 1e-6) {
    source.unshift({ beat: 0, beats: source[0].beats, beatType: source[0].beatType });
  }
  const spans: MeasureSpan[] = [];
  let beat = 0;
  let meterIdx = 0;
  let meter = source[0];
  const limit = Math.max(endBeat, measureLengthBeats(meter));
  let guard = 0;
  while (beat < limit - 1e-6 && guard++ < 20000) {
    while (meterIdx + 1 < source.length && source[meterIdx + 1].beat <= beat + 1e-6) {
      meterIdx++;
      meter = source[meterIdx];
    }
    const len = measureLengthBeats(meter);
    if (!(len > 0.01)) break;
    spans.push({
      index: spans.length + 1,
      startBeat: beat,
      lengthBeats: len,
      beats: meter.beats,
      beatType: meter.beatType,
    });
    beat += len;
  }
  return spans;
}

export function projectEndBeat(project: Pick<ScoreProject, "notes" | "measures">): number {
  let end = 0;
  for (const n of project.notes) end = Math.max(end, n.startBeat + n.durationBeats);
  for (const m of project.measures) end = Math.max(end, m.startBeat + m.lengthBeats);
  return end > 0 ? end : 4;
}

/**
 * The last sounding beat. The roll and playback both use this so trailing empty bars
 * from an import never stretch the timeline or leave silence at the end.
 */
export function notesEndBeat(project: Pick<ScoreProject, "notes">): number {
  let end = 0;
  for (const n of project.notes) end = Math.max(end, n.startBeat + n.durationBeats);
  return end;
}

/** Timeline length for the roll: the last note plus a little room, never shorter than the view. */
export function rollLength(project: Pick<ScoreProject, "notes">): number {
  return Math.max(16, notesEndBeat(project) + 4);
}

/** Bars covering the score, extended if notes run past the last imported bar. */
export function ensureMeasures(project: ScoreProject, endBeat = projectEndBeat(project)): MeasureSpan[] {
  const base = project.measures.length
    ? project.measures.map((m) => ({ ...m }))
    : buildMeasures(project.meters, endBeat);
  if (!base.length) return buildMeasures([{ beat: 0, beats: 4, beatType: 4 }], endBeat);
  let beat = base[base.length - 1].startBeat + base[base.length - 1].lengthBeats;
  let guard = 0;
  while (beat < endBeat - 1e-6 && guard++ < 20000) {
    const prev = base[base.length - 1];
    const len = measureLengthBeats(prev);
    base.push({
      index: base.length + 1,
      startBeat: beat,
      lengthBeats: len,
      beats: prev.beats,
      beatType: prev.beatType,
    });
    beat += len;
  }
  return base;
}

export function locateBeat(
  beat: number,
  measures: MeasureSpan[],
): { measure: number; beatInBar: number; beats: number; beatType: number } {
  if (!measures.length) {
    return { measure: 1, beatInBar: Math.max(0, beat), beats: 4, beatType: 4 };
  }
  for (const m of measures) {
    if (beat < m.startBeat + m.lengthBeats - 1e-6) {
      return {
        measure: m.index,
        beatInBar: Math.max(0, beat - m.startBeat),
        beats: m.beats,
        beatType: m.beatType,
      };
    }
  }
  const last = measures[measures.length - 1];
  return {
    measure: last.index,
    beatInBar: Math.max(0, beat - last.startBeat),
    beats: last.beats,
    beatType: last.beatType,
  };
}

export function snapBeat(beat: number, grid: number, enabled: boolean): number {
  const safe = Math.max(0, beat);
  if (!enabled || !(grid > 0)) return safe;
  const snapped = Math.round(safe / grid) * grid;
  return Math.max(0, Math.round(snapped * 1e6) / 1e6);
}

export function scaleTempos(tempos: TempoPoint[], factor: number): TempoPoint[] {
  const f = factor > 0 ? factor : 1;
  return normalizeTempos(tempos).map((t) => ({ beat: t.beat, bpm: t.bpm * f }));
}
