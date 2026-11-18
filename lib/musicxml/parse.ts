import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { sanitizeLyrics } from "../lyrics";
import { repairOverfullMeasure, type RhythmSlot, type RhythmVoice } from "../rhythm";
import type { KeyPoint, MeasureSpan, MeterPoint, TempoPoint } from "../types";
import { measureLengthBeats } from "../timing";

export interface RawNote {
  partId: string;
  staff: number;
  voice: number;
  midi: number;
  startBeat: number;
  durationBeats: number;
  stem?: "up" | "down" | "none";
  lyric?: string;
  velocity?: number;
  measureIndex: number;
  tieStart?: boolean;
  tieStop?: boolean;
  /** A beam was printed on this note, so its duration is less likely to be a doubled eighth. */
  beamed?: boolean;
}

interface RawRest {
  voice: number;
  staff: number;
  startBeat: number;
  durationBeats: number;
}

export interface RawPart {
  id: string;
  name: string;
  abbr: string;
  staves: number;
  clefs: { staff: number; sign: string; octaveChange?: number }[];
  midiProgram?: number;
  notes: RawNote[];
}

export interface RawScore {
  title: string;
  parts: RawPart[];
  tempos: TempoPoint[];
  meters: MeterPoint[];
  keys: KeyPoint[];
  measures: MeasureSpan[];
  warnings: string[];
}

interface LocalMeasure {
  number: string;
  implicit: boolean;
  startBeat: number;
  lengthBeats: number;
  beats: number;
  beatType: number;
  notes: RawNote[];
  rests: RawRest[];
  fifths?: number;
  mode?: "major" | "minor";
}

interface LocalPart {
  id: string;
  name: string;
  abbr: string;
  staves: number;
  clefs: { staff: number; sign: string; octaveChange?: number }[];
  midiProgram?: number;
  measures: LocalMeasure[];
  tempos: TempoPoint[];
  keys: KeyPoint[];
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 1 / 16,
};

function children(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i);
    if (n && n.nodeType === 1) out.push(n as XmlElement);
  }
  return out;
}

function tag(el: XmlElement): string {
  const raw = el.localName || el.tagName || "";
  const i = raw.indexOf(":");
  return (i >= 0 ? raw.slice(i + 1) : raw).toLowerCase();
}

function child(el: XmlElement, name: string): XmlElement | null {
  for (const c of children(el)) if (tag(c) === name) return c;
  return null;
}

function kids(el: XmlElement, name: string): XmlElement[] {
  return children(el).filter((c) => tag(c) === name);
}

function text(el: XmlElement | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function num(el: XmlElement | null | undefined, fallback: number): number {
  const n = Number(text(el));
  return Number.isFinite(n) ? n : fallback;
}

function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const c of children(node)) {
      if (tag(c) === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

export interface ParseOptions {
  /**
   * Keep the bar grid fixed to the time signature. If a measure runs long
   * (a common OMR error), trim it back to the barline instead of pushing
   * every later bar to the right.
   */
  lockToMeter?: boolean;
  /** Meter in force at the start of this page, when the page itself reprints none. */
  initialMeter?: { beats: number; beatType: number };
  /** Key in force at the start of this page, when the page itself reprints none. */
  initialKey?: { fifths: number; mode: "major" | "minor" };
}

export function parseMusicXml(xml: string, options: ParseOptions = {}): RawScore {
  const clean = xml.replace(/^\uFEFF/, "").trim();
  if (!clean) throw new Error("文件是空的。");
  let root: XmlElement;
  try {
    const doc = new DOMParser({
      onError(level, message) {
        if (level === "fatalError") throw new Error(String(message));
      },
    }).parseFromString(clean, "text/xml");
    if (!doc.documentElement) throw new Error("没有根元素");
    root = doc.documentElement;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析 MusicXML：${message}`);
  }

  const rootTag = tag(root);
  if (rootTag === "score-timewise") return finalize(parseTimewise(root, options), options);
  if (rootTag !== "score-partwise") {
    throw new Error("需要 partwise 或 timewise MusicXML（.musicxml / .xml / .mxl）。");
  }
  return finalize(parsePartwise(root, options), options);
}

function readPartList(root: XmlElement): Map<string, { name: string; abbr: string; midiProgram?: number }> {
  const list = child(root, "part-list");
  const map = new Map<string, { name: string; abbr: string; midiProgram?: number }>();
  if (!list) return map;
  for (const part of descendants(list, "score-part")) {
    const id = part.getAttribute("id") || "";
    const name =
      text(child(part, "part-name")) ||
      text(child(part, "part-name-display")) ||
      text(child(child(part, "score-instrument") ?? part, "instrument-name"));
    const abbr = text(child(part, "part-abbreviation"));
    const programText = text(child(child(part, "midi-instrument") ?? part, "midi-program"));
    const program = programText ? Number(programText) : undefined;
    map.set(id, {
      name,
      abbr,
      midiProgram: program && Number.isFinite(program) ? program : undefined,
    });
  }
  return map;
}

function titleOf(root: XmlElement): string {
  return (
    text(child(child(root, "work") ?? root, "work-title")) ||
    text(child(root, "movement-title")) ||
    "未命名"
  );
}

function parsePartwise(root: XmlElement, options: ParseOptions): { title: string; parts: LocalPart[]; warnings: string[] } {
  const meta = readPartList(root);
  const warnings: string[] = [];
  const parts: LocalPart[] = [];
  let index = 0;
  for (const partEl of children(root).filter((c) => tag(c) === "part")) {
    index++;
    const id = partEl.getAttribute("id") || `P${index}`;
    const info = meta.get(id);
    const measures = children(partEl).filter((c) => tag(c) === "measure");
    parts.push(parsePart(id, info?.name || "", info?.abbr || "", info?.midiProgram, measures, warnings, options));
  }
  return { title: titleOf(root), parts, warnings };
}

function parseTimewise(root: XmlElement, options: ParseOptions): { title: string; parts: LocalPart[]; warnings: string[] } {
  const meta = readPartList(root);
  const warnings: string[] = ["已从 timewise MusicXML 转成按声部的时间轴。"];
  const buckets = new Map<string, XmlElement[]>();
  for (const measure of children(root).filter((c) => tag(c) === "measure")) {
    const number = measure.getAttribute("number") ?? "";
    const implicit = measure.getAttribute("implicit") === "yes";
    for (const part of children(measure).filter((c) => tag(c) === "part")) {
      const id = part.getAttribute("id") || "";
      const shell = measure.ownerDocument!.createElement("measure");
      shell.setAttribute("number", number);
      if (implicit) shell.setAttribute("implicit", "yes");
      for (const c of children(part)) shell.appendChild(c.cloneNode(true));
      const arr = buckets.get(id) ?? [];
      arr.push(shell);
      buckets.set(id, arr);
    }
  }
  const parts: LocalPart[] = [];
  let index = 0;
  const ids = buckets.size ? [...buckets.keys()] : [...meta.keys()];
  for (const id of ids) {
    index++;
    const info = meta.get(id);
    parts.push(
      parsePart(id || `P${index}`, info?.name || "", info?.abbr || "", info?.midiProgram, buckets.get(id) ?? [], warnings, options),
    );
  }
  return { title: titleOf(root), parts, warnings };
}

function parsePart(
  id: string,
  name: string,
  abbr: string,
  midiProgram: number | undefined,
  measureEls: XmlElement[],
  warnings: string[],
  options: ParseOptions,
): LocalPart {
  const part: LocalPart = {
    id,
    name,
    abbr,
    staves: 1,
    clefs: [],
    midiProgram,
    measures: [],
    tempos: [],
    keys: [],
  };
  let divisions = 1;
  let beats = options.initialMeter?.beats && options.initialMeter.beats > 0 ? options.initialMeter.beats : 4;
  let beatType = options.initialMeter?.beatType && options.initialMeter.beatType > 0 ? options.initialMeter.beatType : 4;
  let transpose = { chromatic: 0, octave: 0 };
  let globalBeat = 0;
  let warnedDivisions = false;

  measureEls.forEach((measureEl, measureIndex) => {
    const measureStart = globalBeat;
    let cursor = measureStart;
    let lastStart = measureStart;
    let maxEnd = measureStart;
    let meterForLength = { beats, beatType };
    const implicit = measureEl.getAttribute("implicit") === "yes";
    const notes: RawNote[] = [];
    const rests: RawRest[] = [];
    let fifths: number | undefined;
    let mode: "major" | "minor" | undefined;

    const bump = (end: number) => {
      if (end > maxEnd) maxEnd = end;
    };

    for (const el of children(measureEl)) {
      const kind = tag(el);
      if (kind === "attributes") {
        const divText = text(child(el, "divisions"));
        if (divText) {
          const d = Number(divText);
          if (d > 0) divisions = d;
        } else if (!warnedDivisions && measureIndex === 0) {
          warnings.push(`${name || id} 缺少 divisions，已按每四分音符 1 处理。`);
          warnedDivisions = true;
        }
        const staves = num(child(el, "staves"), 0);
        if (staves > part.staves) part.staves = staves;
        const time = child(el, "time");
        if (time && !child(time, "senza-misura")) {
          const nextBeats = num(child(time, "beats"), beats);
          const nextType = num(child(time, "beat-type"), beatType);
          if (nextBeats > 0 && nextType > 0) {
            beats = nextBeats;
            beatType = nextType;
            if (cursor <= measureStart + 1e-6) meterForLength = { beats, beatType };
          }
        }
        const key = child(el, "key");
        if (key) {
          fifths = num(child(key, "fifths"), 0);
          const modeText = text(child(key, "mode")).toLowerCase();
          mode = modeText === "minor" ? "minor" : "major";
          part.keys.push({ beat: cursor, fifths, mode });
        }
        const tr = child(el, "transpose");
        if (tr) {
          transpose = {
            chromatic: num(child(tr, "chromatic"), 0),
            octave: num(child(tr, "octave-change"), 0),
          };
        }
        for (const clef of kids(el, "clef")) {
          const staff = Number(clef.getAttribute("number") || "1");
          const sign = text(child(clef, "sign")) || "G";
          const octText = text(child(clef, "clef-octave-change"));
          const octaveChange = octText ? Number(octText) : undefined;
          const next = {
            staff: Number.isFinite(staff) ? staff : 1,
            sign,
            octaveChange: octaveChange && Number.isFinite(octaveChange) ? octaveChange : undefined,
          };
          const prev = part.clefs.findIndex((c) => c.staff === next.staff);
          if (prev >= 0) part.clefs[prev] = next;
          else part.clefs.push(next);
        }
        continue;
      }

      if (kind === "direction" || kind === "sound") {
        const bpm = readTempo(el);
        if (bpm && bpm > 0) part.tempos.push({ beat: cursor, bpm });
        continue;
      }

      if (kind === "backup" || kind === "forward") {
        const beatsDelta = num(child(el, "duration"), 0) / divisions;
        cursor += kind === "backup" ? -beatsDelta : beatsDelta;
        bump(cursor);
        continue;
      }

      if (kind !== "note") continue;
      if (child(el, "grace") || child(el, "cue")) continue;

      const dur = num(child(el, "duration"), 0) / divisions;
      const isChord = !!child(el, "chord");
      const isRest = !!child(el, "rest");
      let start: number;
      if (isChord) {
        start = lastStart;
      } else {
        start = cursor;
        cursor += dur;
        lastStart = start;
        bump(cursor);
      }
      if (isRest) {
        rests.push({
          voice: Math.max(1, num(child(el, "voice"), 1)),
          staff: Math.max(1, num(child(el, "staff"), 1)),
          startBeat: start,
          durationBeats: Math.max(0, dur),
        });
        continue;
      }
      const midi = readPitch(el, transpose);
      if (midi == null) continue;
      bump(start + dur);
      const stemText = text(child(el, "stem"));
      const stem = stemText === "up" || stemText === "down" || stemText === "none" ? stemText : undefined;
      const { tieStart, tieStop } = readTies(el);
      notes.push({
        partId: id,
        staff: Math.max(1, num(child(el, "staff"), 1)),
        voice: Math.max(1, num(child(el, "voice"), 1)),
        midi,
        startBeat: start,
        durationBeats: Math.max(0, dur),
        stem,
        lyric: readLyric(el),
        measureIndex,
        tieStart,
        tieStop,
        beamed: kids(el, "beam").length > 0,
      });
      const staffN = notes[notes.length - 1].staff;
      if (staffN > part.staves) part.staves = staffN;
    }

    const signature = measureLengthBeats(meterForLength);
    const content = Math.max(0, maxEnd - measureStart);
    let length = signature;
    let measureNotes = notes;
    const measureLabel = measureEl.getAttribute("number") || String(measureIndex + 1);
    if (implicit) length = content > 0.01 ? content : signature;
    else if (options.lockToMeter && content > signature + 0.05) {
      // Keep every note. finalize() tries to make the bar add up, and if it
      // cannot, squeezes the notes into the bar instead of deleting them.
      measureNotes = notes;
      length = signature;
    } else if (content > signature + 0.05) {
      length = content;
      warnings.push(`${name || id} 第 ${measureLabel} 小节超出拍号，已拉长该小节以免叠到下一小节。`);
    }
    if (!(length > 0.01)) length = signature > 0.01 ? signature : 4;

    part.measures.push({
      number: measureLabel,
      implicit,
      startBeat: measureStart,
      lengthBeats: length,
      beats: meterForLength.beats,
      beatType: meterForLength.beatType,
      notes: options.lockToMeter ? measureNotes : mergeTies(measureNotes),
      rests,
      fifths,
      mode,
    });
    globalBeat += length;
  });

  return part;
}

function readPitch(note: XmlElement, transpose: { chromatic: number; octave: number }): number | null {
  const pitch = child(note, "pitch");
  if (!pitch) return null;
  const step = STEP[text(child(pitch, "step")).toUpperCase()];
  if (step == null) return null;
  const alter = num(child(pitch, "alter"), 0);
  const octave = num(child(pitch, "octave"), 4);
  const midi = Math.round((octave + 1) * 12 + step + alter + transpose.chromatic + transpose.octave * 12);
  if (midi < 0 || midi > 127) return null;
  return midi;
}

function readLyric(note: XmlElement): string | undefined {
  const lyric = child(note, "lyric");
  if (!lyric) return undefined;
  const texts = kids(lyric, "text")
    .map((el) => text(el))
    .filter(Boolean);
  const joined = texts.join("");
  return joined || undefined;
}

function readTies(note: XmlElement): { tieStart: boolean; tieStop: boolean } {
  let tieStart = false;
  let tieStop = false;
  const mark = (el: XmlElement) => {
    const type = el.getAttribute("type");
    if (type === "start") tieStart = true;
    if (type === "stop") tieStop = true;
  };
  for (const tie of kids(note, "tie")) mark(tie);
  const notations = child(note, "notations");
  if (notations) for (const tied of kids(notations, "tied")) mark(tied);
  return { tieStart, tieStop };
}

function readTempo(el: XmlElement): number | null {
  let soundTempo: number | null = null;
  let metro: number | null = null;
  const visit = (node: XmlElement) => {
    if (tag(node) === "sound") {
      const tempo = node.getAttribute("tempo");
      if (tempo && Number(tempo) > 0) soundTempo = Number(tempo);
    }
    if (tag(node) === "metronome") {
      const unit = text(child(node, "beat-unit"));
      const per = num(child(node, "per-minute"), 0);
      const dots = kids(node, "beat-unit-dot").length;
      const quarters = UNIT_QUARTERS[unit] ?? 1;
      const dot = dots >= 2 ? 1.75 : dots === 1 ? 1.5 : 1;
      if (per > 0) metro = per * quarters * dot;
    }
    for (const c of children(node)) visit(c);
  };
  visit(el);
  if (soundTempo && soundTempo > 0) return soundTempo;
  return metro;
}

function mergeTies(notes: RawNote[], bars?: { start: number; length: number }[]): RawNote[] {
  const sorted = notes
    .filter((n) => n.durationBeats > 0)
    .slice()
    .sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi);
  const open = new Map<string, RawNote>();
  const out: RawNote[] = [];
  for (const note of sorted) {
    const key = `${note.staff}|${note.voice}|${note.midi}`;
    if (note.tieStop) {
      const prev = open.get(key);
      if (prev && tieCanJoin(prev, note, bars)) {
        prev.durationBeats += note.durationBeats;
        if (!prev.lyric && note.lyric) prev.lyric = note.lyric;
        if (note.tieStart) open.set(key, prev);
        else open.delete(key);
        continue;
      }
    }
    const copy = { ...note };
    out.push(copy);
    if (note.tieStart) open.set(key, copy);
    else open.delete(key);
  }
  return out;
}

function tieCanJoin(prev: RawNote, note: RawNote, bars?: { start: number; length: number }[]): boolean {
  if (prev.midi !== note.midi || prev.staff !== note.staff || prev.voice !== note.voice) return false;
  if (Math.abs(prev.startBeat + prev.durationBeats - note.startBeat) >= 0.03) return false;
  if (prev.lyric && note.lyric && prev.lyric !== note.lyric) return false;
  if (!bars) return true;
  const bar = bars.find((item) => prev.startBeat >= item.start - 0.02 && prev.startBeat < item.start + item.length - 0.02);
  const barLength = bar?.length ?? 4;
  if (prev.durationBeats + note.durationBeats > barLength * 2 + 0.05) return false;
  // A note that already fills its bar, tied to a long note in the next bar, is usually a slur.
  if (prev.durationBeats >= barLength - 0.05 && note.durationBeats > barLength / 2 + 0.05) return false;
  return true;
}

function repairMeasures(parts: LocalPart[], warnings: string[]) {
  const count = Math.max(0, ...parts.map((part) => part.measures.length));
  for (let index = 0; index < count; index++) {
    const present = parts.map((part) => part.measures[index]).filter((measure): measure is LocalMeasure => !!measure);
    if (!present.length || present.some((measure) => measure.implicit)) continue;
    const signature = present[0].lengthBeats;
    const built: {
      part: LocalPart;
      voice: number;
      voiceId: string;
      slots: RhythmSlot[];
      sources: (RawNote[] | null)[];
      entry: number;
    }[] = [];
    for (const part of parts) {
      const measure = part.measures[index];
      if (!measure) continue;
      const voices = new Set<number>([
        ...measure.notes.map((note) => note.voice),
        ...measure.rests.map((rest) => rest.voice),
      ]);
      for (const voice of voices) {
        const notes = measure.notes.filter((note) => note.voice === voice);
        const rests = measure.rests.filter((rest) => rest.voice === voice);
        const builtVoice = slotsOf(notes, rests, measure.startBeat);
        built.push({ part, voice, voiceId: `${part.id}|v${voice}`, ...builtVoice });
      }
    }
    if (!built.length) continue;
    const repaired = repairOverfullMeasure(
      built.map((item): RhythmVoice => ({ id: item.voiceId, slots: item.slots, entry: item.entry })),
      signature,
      present[0].number,
    );
    if (repaired.warning) warnings.push(repaired.warning);
    repaired.voices.forEach((voice, voiceIndex) => {
      if (voice.kind === "ok") return;
      const source = built[voiceIndex];
      const measure = source.part.measures[index];
      const kept = new Set<RawNote>();
      let cursor = measure.startBeat + source.entry;
      voice.slots.forEach((slot) => {
        const originals = slot.key ? source.sources[Number(slot.key)] : null;
        if (originals) {
          for (const note of originals) {
            note.startBeat = cursor;
            note.durationBeats = slot.duration;
            kept.add(note);
          }
        }
        cursor += slot.duration;
      });
      measure.notes = measure.notes.filter((note) => note.voice !== source.voice || kept.has(note));
    });
  }
}

function slotsOf(
  notes: RawNote[],
  rests: RawRest[],
  measureStart: number,
): { slots: RhythmSlot[]; sources: (RawNote[] | null)[]; entry: number } {
  interface Event {
    start: number;
    duration: number;
    rest: boolean;
    notes: RawNote[];
  }
  const events: Event[] = [];
  const groups = new Map<number, RawNote[]>();
  for (const note of notes) {
    const key = Math.round((note.startBeat - measureStart) * 1000);
    const group = groups.get(key);
    if (group) group.push(note);
    else groups.set(key, [note]);
  }
  for (const group of groups.values()) {
    events.push({
      start: group[0].startBeat - measureStart,
      duration: group[0].durationBeats,
      rest: false,
      notes: group,
    });
  }
  for (const rest of rests) {
    events.push({ start: rest.startBeat - measureStart, duration: rest.durationBeats, rest: true, notes: [] });
  }
  events.sort((a, b) => a.start - b.start || Number(a.rest) - Number(b.rest));
  const slots: RhythmSlot[] = [];
  const sources: (RawNote[] | null)[] = [];
  if (!events.length) return { slots, sources, entry: 0 };
  const entry = Math.max(0, events[0].start);
  let cursor = entry;
  for (const event of events) {
    if (event.start > cursor + 0.04) {
      slots.push({ duration: event.start - cursor, rest: true, pitches: [] });
      sources.push(null);
      cursor = event.start;
    }
    slots.push({
      duration: event.duration,
      rest: event.rest,
      pitches: event.notes.map((note) => note.midi),
      tieStart: event.notes.some((note) => note.tieStart),
      tieStop: event.notes.some((note) => note.tieStop),
      beamed: event.notes.some((note) => note.beamed),
      key: String(slots.length),
    });
    sources.push(event.rest ? null : event.notes);
    cursor = Math.max(cursor, event.start + event.duration);
  }
  return { slots, sources, entry };
}

function finalize(parsed: { title: string; parts: LocalPart[]; warnings: string[] }, options: ParseOptions): RawScore {
  const warnings = parsed.warnings.slice();
  if (options.lockToMeter) repairMeasures(parsed.parts, warnings);
  if (options.lockToMeter) {
    sanitizeLyrics(parsed.parts.flatMap((part) => part.measures.flatMap((measure) => measure.notes)));
  }
  if (!parsed.parts.length) warnings.push("谱面里没有声部。");
  const ref = parsed.parts.reduce<LocalPart | null>((best, part) => {
    if (!best || part.measures.length > best.measures.length) return part;
    return best;
  }, null);
  const canonicalStarts = ref ? ref.measures.map((m) => m.startBeat) : [];

  const parts: RawPart[] = parsed.parts.map((part) => {
    const notes: RawNote[] = [];
    let warnedAlign = false;
    part.measures.forEach((measure, i) => {
      const target = canonicalStarts[i];
      const delta = target == null ? 0 : target - measure.startBeat;
      if (!warnedAlign && target != null && Math.abs(delta) > 0.02) {
        warnedAlign = true;
        warnings.push(`${part.name || part.id} 的小节长度与主时间轴不一致，已按小节号重新对齐。`);
      }
      for (const note of measure.notes) {
        notes.push({ ...note, startBeat: note.startBeat + (target == null ? 0 : delta) });
      }
    });
    const merged = mergeTies(notes, options.lockToMeter ? part.measures.map((measure) => ({ start: measure.startBeat, length: measure.lengthBeats })) : undefined);
    return {
      id: part.id,
      name: part.name,
      abbr: part.abbr,
      staves: Math.max(part.staves, 1),
      clefs: part.clefs,
      midiProgram: part.midiProgram,
      notes: merged,
    };
  });

  const measures: MeasureSpan[] = ref
    ? ref.measures.map((m, i) => ({
        index: i + 1,
        startBeat: m.startBeat,
        lengthBeats: m.lengthBeats,
        beats: m.beats,
        beatType: m.beatType,
      }))
    : [];

  const meters: MeterPoint[] = [];
  for (const m of measures) {
    const last = meters[meters.length - 1];
    if (!last || last.beats !== m.beats || last.beatType !== m.beatType) {
      meters.push({ beat: m.startBeat, beats: m.beats, beatType: m.beatType });
    }
  }

  const tempos: TempoPoint[] = [];
  for (const part of parsed.parts) {
    part.measures.forEach((measure, i) => {
      const delta = canonicalStarts[i] == null ? 0 : canonicalStarts[i] - measure.startBeat;
      for (const tempo of part.tempos) {
        if (tempo.beat >= measure.startBeat - 1e-6 && tempo.beat < measure.startBeat + measure.lengthBeats - 1e-4) {
          tempos.push({ beat: tempo.beat + delta, bpm: tempo.bpm });
        }
      }
    });
    // Tempos that fell past the last measure still belong at the end.
    const last = part.measures[part.measures.length - 1];
    if (last) {
      const delta = canonicalStarts[part.measures.length - 1] == null ? 0 : canonicalStarts[part.measures.length - 1] - last.startBeat;
      for (const tempo of part.tempos) {
        if (tempo.beat >= last.startBeat + last.lengthBeats - 1e-4) {
          tempos.push({ beat: tempo.beat + delta, bpm: tempo.bpm });
        }
      }
    }
  }

  const keys: KeyPoint[] = [];
  const refKeys = ref?.keys ?? [];
  for (const key of refKeys) keys.push(key);
  if (!keys.length && options.initialKey) {
    keys.push({ beat: 0, fifths: options.initialKey.fifths, mode: options.initialKey.mode });
  }

  return {
    title: parsed.title,
    parts,
    tempos: dedupeTempos(tempos),
    meters: meters.length ? meters : [{ beat: 0, beats: 4, beatType: 4 }],
    keys: keys.length ? dedupeKeys(keys) : [{ beat: 0, fifths: 0, mode: "major" }],
    measures,
    warnings: unique(warnings),
  };
}

function dedupeTempos(tempos: TempoPoint[]): TempoPoint[] {
  const sorted = tempos.filter((t) => t.bpm > 0).sort((a, b) => a.beat - b.beat);
  const out: TempoPoint[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - t.beat) < 1e-3) {
      if (Math.abs(last.bpm - t.bpm) > 0.5) last.bpm = t.bpm;
      continue;
    }
    out.push({ ...t });
  }
  return out;
}

function dedupeKeys(keys: KeyPoint[]): KeyPoint[] {
  const sorted = keys.slice().sort((a, b) => a.beat - b.beat);
  const out: KeyPoint[] = [];
  for (const key of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - key.beat) < 1e-3) out[out.length - 1] = key;
    else if (!last || last.fifths !== key.fifths || last.mode !== key.mode) out.push(key);
  }
  return out;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
