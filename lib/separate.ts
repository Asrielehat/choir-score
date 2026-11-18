import type { RawNote, RawPart, RawScore } from "./musicxml/parse";
import { correctRoleOctaves } from "./sanity";
import {
  OPTIONAL_ROLES,
  ROLE_ORDER,
  makeTrack,
  type Layer,
  type NoteEvent,
  type Role,
  type ScoreProject,
  type StreamInfo,
} from "./types";

type NameKind = Role | "piano" | "choir" | null;

const PIANO_RE = /piano|键盘|钢\s*琴|伴奏|accomp|keyboard|klavier|\bpno\b|管风琴|\borgan\b/i;
const CHOIR_RE = /choir|chorus|voices|vocal|satb|合唱|声部|人声|混声|singers/i;

export function roleFromName(name: string): NameKind {
  const n = name.trim();
  if (!n) return null;
  if (PIANO_RE.test(n)) return "piano";
  if (/cello|violoncello|大提琴|^vc\.?$/i.test(n)) return "cello";
  if (/女高|sopran/i.test(n)) return "soprano";
  if (/女中|女低|contralto|\balto\b/i.test(n)) return "alto";
  if (/男高|\btenor\b/i.test(n)) return "tenor";
  if (/男中|男低|baritone|\bbass\b|\bbasso\b/i.test(n)) return "bass";
  if (CHOIR_RE.test(n)) return "choir";
  if (/^s\.?$/i.test(n)) return "soprano";
  if (/^a\.?$/i.test(n)) return "alto";
  if (/^t\.?$/i.test(n)) return "tenor";
  if (/^b\.?$/i.test(n)) return "bass";
  return null;
}

function pianoHand(name: string): Role | null {
  if (/右手|right hand|\bRH\b/i.test(name)) return "piano-rh";
  if (/左手|left hand|\bLH\b/i.test(name)) return "piano-lh";
  return null;
}

function isSpecificVoice(kind: NameKind): kind is "soprano" | "alto" | "tenor" | "bass" {
  return kind === "soprano" || kind === "alto" || kind === "tenor" || kind === "bass";
}

interface StaffPlan {
  partId: string;
  partName: string;
  staff: number;
  mode: "piano" | "single" | "shared";
  upper: Role;
  lower?: Role;
  reasonZh: string;
  reasonEn: string;
}

function median(notes: RawNote[]): number {
  if (!notes.length) return 60;
  const values = notes.map((n) => n.midi).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function average(notes: RawNote[]): number {
  if (!notes.length) return 60;
  return notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
}

function hasLyrics(part: RawPart): boolean {
  return part.notes.some((n) => n.lyric);
}

function onsetGroups(notes: RawNote[]): RawNote[][] {
  const map = new Map<number, RawNote[]>();
  for (const note of notes) {
    const key = Math.round(note.startBeat * 1000);
    const arr = map.get(key);
    if (arr) arr.push(note);
    else map.set(key, [note]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, notes]) => notes);
}

function hasChords(notes: RawNote[]): boolean {
  return onsetGroups(notes).some((group) => new Set(group.map((n) => n.midi)).size >= 2);
}

function voiceNumbers(notes: RawNote[]): number[] {
  return [...new Set(notes.map((n) => n.voice))].sort((a, b) => a - b);
}

function stemMajority(notes: RawNote[]): "up" | "down" | "none" {
  let up = 0;
  let down = 0;
  for (const note of notes) {
    if (note.stem === "up") up++;
    if (note.stem === "down") down++;
  }
  if (up > down) return "up";
  if (down > up) return "down";
  return "none";
}

function splitEvidence(notes: RawNote[]): boolean {
  if (!notes.length) return false;
  if (voiceNumbers(notes).length >= 2) return true;
  return hasChords(notes);
}

function looksLikeClosedSatb(part: RawPart): boolean {
  const upper = part.notes.filter((n) => n.staff === 1);
  const lower = part.notes.filter((n) => n.staff === 2);
  return splitEvidence(upper) && splitEvidence(lower);
}

function staffCount(part: RawPart): number {
  return Math.max(part.staves, ...part.notes.map((n) => n.staff), 1);
}

export interface SeparateOptions {
  /** Choir scan: top-to-bottom voices, piano grand staff kept at the bottom. */
  choirLayout?: boolean;
}

interface StaffFeat {
  staff: number;
  lyrics: number;
  clef?: string;
  median: number;
  split: boolean;
}

function staffFeatures(part: RawPart): StaffFeat[] {
  const count = staffCount(part);
  const features: StaffFeat[] = [];
  for (let staff = 1; staff <= count; staff++) {
    const notes = part.notes.filter((note) => note.staff === staff);
    features.push({
      staff,
      lyrics: notes.filter((note) => note.lyric).length,
      clef: part.clefs.find((clef) => clef.staff === staff)?.sign,
      median: median(notes),
      split: splitEvidence(notes),
    });
  }
  return features;
}

function bottomIsPiano(features: StaffFeat[]): boolean {
  if (features.length < 3) return false;
  const right = features[features.length - 2];
  const left = features[features.length - 1];
  const vocal = features.slice(0, -2);
  const vocalLyrics = vocal.reduce((sum, feature) => sum + feature.lyrics, 0);
  const pianoLyrics = right.lyrics + left.lyrics;
  const leftIsBass = left.clef === "F" || (!left.clef && left.median + 3 < right.median) || left.median < 57;
  const quieterLyrics = pianoLyrics <= Math.max(1, vocalLyrics * 0.35);
  return leftIsBass && quieterLyrics && right.median + 1 >= left.median;
}

function systemPlans(part: RawPart): StaffPlan[] | null {
  const features = staffFeatures(part);
  if (features.length < 3) return null;
  const piano = bottomIsPiano(features);
  const vocal = piano ? features.slice(0, -2) : features;
  const partName = part.name || part.abbr || part.id;
  const plans: StaffPlan[] = [];
  const single = (staff: number, role: Role, zh: string, en: string): StaffPlan => ({
    partId: part.id,
    partName,
    staff,
    mode: role.startsWith("piano") ? "piano" : "single",
    upper: role,
    reasonZh: zh,
    reasonEn: en,
  });
  const shared = (staff: number, upper: Role, lower: Role, zh: string, en: string): StaffPlan => ({
    partId: part.id,
    partName,
    staff,
    mode: "shared",
    upper,
    lower,
    reasonZh: zh,
    reasonEn: en,
  });

  if (vocal.length === 2 && (vocal[0].split || vocal[1].split)) {
    plans.push(shared(vocal[0].staff, "soprano", "alto", "缩谱高音谱表，符干分开女高和女低", "Closed treble staff, stems split SA"));
    plans.push(shared(vocal[1].staff, "tenor", "bass", "缩谱低音谱表，符干分开男高和男低", "Closed bass staff, stems split TB"));
  } else if (vocal.length === 2) {
    plans.push(single(vocal[0].staff, "soprano", "上方声部谱表", "Upper vocal staff"));
    plans.push(single(vocal[1].staff, "alto", "下一行声部谱表", "Next vocal staff"));
  } else {
    const roles: Role[] = ["soprano", "alto", "tenor", "bass"];
    vocal.forEach((feature, index) => {
      let role = roles[index] ?? "bass";
      // A bass-clef staff under the four voices, with no lyrics, is an instrument.
      if (index >= 4 && feature.lyrics === 0 && (feature.clef === "F" || !feature.clef)) role = "cello";
      plans.push(single(feature.staff, role, `开大谱第 ${index + 1} 行`, `Open score staff ${index + 1}`));
    });
  }
  if (piano) {
    const right = features[features.length - 2];
    const left = features[features.length - 1];
    plans.push(single(right.staff, "piano-rh", "系统最下面的高音谱表，当作钢琴右手", "Bottom treble staff, piano right hand"));
    plans.push(single(left.staff, "piano-lh", "系统最下面的低音谱表，当作钢琴左手", "Bottom bass staff, piano left hand"));
  }
  return plans;
}

function applyChoirPartOrder(parts: RawPart[], labels: NameKind[], counts: number[]) {
  const singles = parts
    .map((_, index) => index)
    .filter((index) => {
      const label = labels[index];
      return counts[index] === 1 && !isSpecificVoice(label) && label !== "piano" && label !== "choir" && label !== "cello";
    });
  if (singles.length < 2) return;
  const feats = singles.map((index) => {
    const clef = parts[index].clefs.find((item) => item.staff === 1) ?? parts[index].clefs[0];
    return {
      index,
      clef: clef?.sign,
      octave: clef?.octaveChange ?? 0,
      lyrics: hasLyrics(parts[index]),
      lyricCount: parts[index].notes.filter((note) => note.lyric).length,
      median: median(parts[index].notes),
    };
  });
  const anyClef = feats.some((feature) => feature.clef);
  if (!anyClef) {
    const roles: NameKind[] =
      feats.length >= 6
        ? ["soprano", "alto", "tenor", "bass", "piano-rh", "piano-lh"]
        : feats.length === 5
          ? ["soprano", "alto", "tenor", "bass", "piano-rh"]
          : feats.length === 4
            ? ["soprano", "alto", "tenor", "bass"]
            : [];
    feats.slice(0, roles.length).forEach((feature, order) => {
      labels[feature.index] = roles[order];
    });
    return;
  }

  const taken = new Set<number>();
  // Grand staff at the bottom: treble over bass, not another singing part.
  if (feats.length >= 5) {
    const right = feats[feats.length - 2];
    const left = feats[feats.length - 1];
    const vocal = feats.slice(0, -2);
    const vocalLyrics = vocal.reduce((sum, feature) => sum + feature.lyricCount, 0);
    const pianoLyrics = right.lyricCount + left.lyricCount;
    const leftIsBass = left.clef === "F" || (!left.clef && left.median + 3 < right.median);
    if (leftIsBass && right.clef !== "F" && pianoLyrics <= Math.max(1, vocalLyrics * 0.35)) {
      labels[right.index] = "piano-rh";
      labels[left.index] = "piano-lh";
      taken.add(right.index);
      taken.add(left.index);
    }
  }
  if (!taken.size && feats.length === 5) {
    const last = feats[feats.length - 1];
    if (last.clef !== "F" && !last.lyrics) {
      labels[last.index] = "piano-rh";
      taken.add(last.index);
    }
  }

  const vocal = feats.filter((feature) => !taken.has(feature.index));
  const bassClefs = vocal.filter((feature) => feature.clef === "F");
  // The upper bass-clef staff is the choir bass. A lower one without lyrics is an instrument.
  if (bassClefs.length >= 2) {
    for (const extra of bassClefs.slice(1)) {
      if (!extra.lyrics) {
        labels[extra.index] = "cello";
        taken.add(extra.index);
      }
    }
  }

  const voices = vocal.filter((feature) => !taken.has(feature.index));
  const assigned = new Map<number, Role>();
  const tenor = voices.find((feature) => feature.octave < 0 && feature.clef !== "F");
  if (tenor) assigned.set(tenor.index, "tenor");
  const bass = voices.find((feature) => !assigned.has(feature.index) && feature.clef === "F");
  if (bass) assigned.set(bass.index, "bass");
  const rest = voices.filter((feature) => !assigned.has(feature.index));
  const open: Role[] = (["soprano", "alto", "tenor", "bass"] as Role[]).filter(
    (role) => ![...assigned.values()].includes(role),
  );
  rest.forEach((feature, index) => {
    assigned.set(feature.index, open[index] ?? "bass");
  });
  for (const [index, role] of assigned) labels[index] = role;
}

function planStaves(parts: RawPart[], options: SeparateOptions = {}): StaffPlan[] {
  const counts = parts.map(staffCount);
  const labels = parts.map((part) => roleFromName(part.name) ?? roleFromName(part.abbr));
  const lyrics = parts.map(hasLyrics);

  parts.forEach((part, i) => {
    if (labels[i]) return;
    if (!lyrics[i] && part.midiProgram && part.midiProgram >= 1 && part.midiProgram <= 8) {
      labels[i] = "piano";
    }
  });

  parts.forEach((part, i) => {
    if (labels[i]) return;
    if (counts[i] >= 2 && !lyrics[i] && !looksLikeClosedSatb(part)) labels[i] = "piano";
    else if (counts[i] === 2 && (lyrics[i] || looksLikeClosedSatb(part))) labels[i] = "choir";
    else if (counts[i] >= 4) labels[i] = "choir";
  });

  if (options.choirLayout) applyChoirPartOrder(parts, labels, counts);

  const unknownSingles = labels
    .map((label, i) => ({ label, i }))
    .filter((item) => item.label == null && counts[item.i] === 1);
  const namedVoices = labels.filter((label) => isSpecificVoice(label)).length;
  if (!options.choirLayout && namedVoices === 0 && unknownSingles.length === 4) {
    const ranked = unknownSingles
      .slice()
      .sort((a, b) => median(parts[b.i].notes) - median(parts[a.i].notes));
    const roles: Role[] = ["soprano", "alto", "tenor", "bass"];
    ranked.forEach((item, index) => {
      labels[item.i] = roles[index];
    });
  }

  const forceShared = new Map<number, { upper: Role; lower: Role; reasonZh: string; reasonEn: string }>();
  const polyphonic = parts
    .map((part, i) => ({ part, i }))
    .filter(
      ({ part, i }) =>
        counts[i] === 1 &&
        !isSpecificVoice(labels[i]) &&
        labels[i] !== "piano" &&
        labels[i] !== "cello" &&
        splitEvidence(part.notes),
    );
  if (polyphonic.length === 2 && !labels.includes("choir")) {
    const ranked = polyphonic.slice().sort((a, b) => median(b.part.notes) - median(a.part.notes));
    forceShared.set(ranked[0].i, {
      upper: "soprano",
      lower: "alto",
      reasonZh: "两个复调声部中音区更高的一组",
      reasonEn: "Higher of two polyphonic vocal parts",
    });
    forceShared.set(ranked[1].i, {
      upper: "tenor",
      lower: "bass",
      reasonZh: "两个复调声部中音区更低的一组",
      reasonEn: "Lower of two polyphonic vocal parts",
    });
  }

  const plans: StaffPlan[] = [];
  parts.forEach((part, i) => {
    const label = labels[i];
    const staves = counts[i];
    const partName = part.name || part.abbr || part.id;
    if (options.choirLayout && staves >= 3) {
      const system = systemPlans(part);
      if (system?.length) {
        plans.push(...system);
        return;
      }
    }
    if (label === "piano-rh" || label === "piano-lh") {
      plans.push({
        partId: part.id,
        partName,
        staff: 1,
        mode: "piano",
        upper: label,
        reasonZh: label === "piano-lh" ? "系统底部，钢琴左手" : "系统底部，钢琴右手",
        reasonEn: label === "piano-lh" ? "Bottom of the system, piano left hand" : "Bottom of the system, piano right hand",
      });
      return;
    }
    const shared = forceShared.get(i);
    if (shared) {
      plans.push({
        partId: part.id,
        partName,
        staff: 1,
        mode: "shared",
        upper: shared.upper,
        lower: shared.lower,
        reasonZh: shared.reasonZh,
        reasonEn: shared.reasonEn,
      });
      return;
    }

    if (label === "cello") {
      for (let staff = 1; staff <= staves; staff++) {
        plans.push({
          partId: part.id,
          partName,
          staff,
          mode: "single",
          upper: "cello",
          reasonZh: "大提琴声部，不并进合唱",
          reasonEn: "Cello staff, kept off the choir",
        });
      }
      return;
    }

    if (label === "piano") {
      const hand = pianoHand(`${part.name} ${part.abbr}`);
      for (let staff = 1; staff <= staves; staff++) {
        const role = staves === 1 ? hand ?? "piano-rh" : staff === 1 ? "piano-rh" : "piano-lh";
        plans.push({
          partId: part.id,
          partName,
          staff,
          mode: "piano",
          upper: role,
          reasonZh: role === "piano-lh" ? "钢琴低音谱表" : "钢琴高音谱表",
          reasonEn: role === "piano-lh" ? "Piano bass staff" : "Piano treble staff",
        });
      }
      return;
    }

    if (isSpecificVoice(label) && staves === 1) {
      plans.push({
        partId: part.id,
        partName,
        staff: 1,
        mode: "single",
        upper: label,
        reasonZh: "声部名称",
        reasonEn: "Part name",
      });
      return;
    }

    if (label === "choir" || (label == null && staves >= 2 && (lyrics[i] || looksLikeClosedSatb(part)))) {
      if (staves >= 4) {
        const roles: Role[] = ["soprano", "alto", "tenor", "bass"];
        for (let staff = 1; staff <= Math.min(staves, 4); staff++) {
          plans.push({
            partId: part.id,
            partName,
            staff,
            mode: "single",
            upper: roles[staff - 1],
            reasonZh: "开大谱，按从上到下的谱表",
            reasonEn: "Open score, top-to-bottom staves",
          });
        }
        return;
      }
      if (staves === 2) {
        plans.push({
          partId: part.id,
          partName,
          staff: 1,
          mode: "shared",
          upper: "soprano",
          lower: "alto",
          reasonZh: "缩谱高音谱表（女高 / 女低）",
          reasonEn: "Closed score treble staff (SA)",
        });
        plans.push({
          partId: part.id,
          partName,
          staff: 2,
          mode: "shared",
          upper: "tenor",
          lower: "bass",
          reasonZh: "缩谱低音谱表（男高 / 男低）",
          reasonEn: "Closed score bass staff (TB)",
        });
        return;
      }
    }

    if (staves === 1) {
      const wide = hasChords(part.notes) && rangeOf(part.notes) >= 18 && !lyrics[i];
      const role: Role = isSpecificVoice(label) ? label : wide ? "piano-rh" : "soprano";
      plans.push({
        partId: part.id,
        partName,
        staff: 1,
        mode: role.startsWith("piano") ? "piano" : "single",
        upper: role,
        reasonZh: lyrics[i] ? "带歌词的单旋律" : wide ? "宽音域和弦，暂作钢琴" : "单谱表旋律",
        reasonEn: lyrics[i] ? "Single staff with lyrics" : wide ? "Wide chordal staff, treated as piano" : "Single-staff melody",
      });
      return;
    }

    for (let staff = 1; staff <= staves; staff++) {
      plans.push({
        partId: part.id,
        partName,
        staff,
        mode: "piano",
        upper: staff === 1 ? "piano-rh" : "piano-lh",
        reasonZh: "未能确认的多谱表，暂作钢琴",
        reasonEn: "Unclassified grand staff, treated as piano",
      });
    }
  });

  return plans;
}

function rangeOf(notes: RawNote[]): number {
  if (!notes.length) return 0;
  let lo = notes[0].midi;
  let hi = notes[0].midi;
  for (const note of notes) {
    lo = Math.min(lo, note.midi);
    hi = Math.max(hi, note.midi);
  }
  return hi - lo;
}

function reasonFor(
  kind: "stem" | "voice" | "chord" | "unison",
  layer: "upper" | "lower",
  plan: StaffPlan,
): { zh: string; en: string } {
  const head = `${plan.reasonZh}`;
  const headEn = `${plan.reasonEn}`;
  if (kind === "chord") {
    return layer === "upper"
      ? { zh: `${head} · 和弦高音`, en: `${headEn} · chord top` }
      : { zh: `${head} · 和弦低音`, en: `${headEn} · chord bottom` };
  }
  if (kind === "unison") {
    return { zh: `${head} · 同音分到两个声部`, en: `${headEn} · unison copied to both` };
  }
  if (kind === "stem") {
    return layer === "upper"
      ? { zh: `${head} · 符干向上`, en: `${headEn} · stem up` }
      : { zh: `${head} · 符干向下`, en: `${headEn} · stem down` };
  }
  return { zh: `${head} · 声部号较小的在上`, en: `${headEn} · lower voice number on top` };
}

function realizeShared(
  notes: RawNote[],
  plan: StaffPlan,
  idGen: () => string,
): { notes: NoteEvent[]; streams: StreamInfo[] } {
  const upper = plan.upper;
  const lower = plan.lower ?? plan.upper;
  const voices = voiceNumbers(notes);
  const voiceStem = new Map<number, "up" | "down" | "none">();
  for (const voice of voices) {
    voiceStem.set(voice, stemMajority(notes.filter((n) => n.voice === voice)));
  }
  const voiceRole = new Map<number, Role>();
  if (voices.length >= 2) {
    const ups = voices.filter((v) => voiceStem.get(v) === "up");
    const downs = voices.filter((v) => voiceStem.get(v) === "down");
    if (ups.length && downs.length) {
      const upVoice = ups.slice().sort((a, b) => average(notes.filter((n) => n.voice === b)) - average(notes.filter((n) => n.voice === a)))[0];
      const downVoice = downs.slice().sort((a, b) => average(notes.filter((n) => n.voice === a)) - average(notes.filter((n) => n.voice === b)))[0];
      voiceRole.set(upVoice, upper);
      voiceRole.set(downVoice, lower);
      for (const voice of voices) {
        if (voiceRole.has(voice)) continue;
        const avg = average(notes.filter((n) => n.voice === voice));
        voiceRole.set(voice, avg >= average(notes.filter((n) => n.voice === upVoice)) ? upper : lower);
      }
    } else {
      voiceRole.set(voices[0], upper);
      voiceRole.set(voices[1], lower);
      for (const voice of voices.slice(2)) {
        const avg = average(notes.filter((n) => n.voice === voice));
        voiceRole.set(voice, avg >= average(notes.filter((n) => n.voice === voices[0])) ? upper : lower);
      }
    }
  } else if (voices.length === 1) {
    voiceRole.set(voices[0], voiceStem.get(voices[0]) === "down" ? lower : upper);
  }

  const byMeasure = new Map<number, RawNote[]>();
  for (const note of notes) {
    const arr = byMeasure.get(note.measureIndex) ?? [];
    arr.push(note);
    byMeasure.set(note.measureIndex, arr);
  }

  type Placed = {
    raw: RawNote;
    role: Role;
    layer: "upper" | "lower";
    voice: number;
    kind: "stem" | "voice" | "chord" | "unison";
  };
  const placed: Placed[] = [];

  for (const measureNotes of byMeasure.values()) {
    const voicesHere = new Set(measureNotes.map((n) => n.voice));
    const otherVoiceInMeasure = voicesHere.size >= 2;
    const onsets = onsetGroups(measureNotes);
    const chordMeasure = onsets.some((group) => {
      const byVoice = new Map<number, RawNote[]>();
      for (const note of group) {
        const arr = byVoice.get(note.voice) ?? [];
        arr.push(note);
        byVoice.set(note.voice, arr);
      }
      for (const groupNotes of byVoice.values()) {
        if (new Set(groupNotes.map((n) => n.midi)).size >= 2) return true;
      }
      return false;
    });

    for (const onset of onsets) {
      const present = [...new Set(onset.map((n) => n.voice))];
      if (present.length >= 2) {
        for (const voice of present) {
          const role = voiceRole.get(voice) ?? upper;
          const kind = voiceStem.get(voice) && voiceStem.get(voice) !== "none" ? "stem" : "voice";
          for (const note of onset.filter((n) => n.voice === voice)) {
            placed.push({
              raw: note,
              role,
              layer: role === lower && role !== upper ? "lower" : "upper",
              voice,
              kind,
            });
          }
        }
        continue;
      }

      const voice = present[0];
      const role = voiceRole.get(voice) ?? upper;
      const pitches = onset.slice().sort((a, b) => b.midi - a.midi);
      const unique = new Set(pitches.map((n) => n.midi));
      if (!otherVoiceInMeasure && unique.size >= 2) {
        const top = pitches[0].midi;
        const bottom = pitches[pitches.length - 1].midi;
        const mid = (top + bottom) / 2;
        for (const note of pitches) {
          const toUpper = top === bottom ? note === pitches[0] : note.midi === top ? true : note.midi === bottom ? false : note.midi > mid;
          placed.push({
            raw: note,
            role: toUpper ? upper : lower,
            layer: toUpper ? "upper" : "lower",
            voice,
            kind: "chord",
          });
        }
        continue;
      }
      if (!otherVoiceInMeasure && unique.size === 1 && chordMeasure) {
        const note = pitches[0];
        placed.push({ raw: note, role: upper, layer: "upper", voice, kind: "unison" });
        placed.push({ raw: note, role: lower, layer: "lower", voice, kind: "unison" });
        continue;
      }
      const kind = voiceStem.get(voice) && voiceStem.get(voice) !== "none" ? "stem" : "voice";
      for (const note of pitches) {
        placed.push({
          raw: note,
          role,
          layer: role === lower && lower !== upper ? "lower" : "upper",
          voice,
          kind,
        });
      }
    }
  }

  const streams = new Map<string, StreamInfo>();
  const out: NoteEvent[] = [];
  for (const item of placed) {
    const streamId = `${plan.partId}|s${plan.staff}|v${item.voice}|${item.layer}`;
    if (!streams.has(streamId)) {
      const reason = reasonFor(item.kind, item.layer, plan);
      streams.set(streamId, {
        id: streamId,
        partId: plan.partId,
        partName: plan.partName,
        staff: plan.staff,
        voice: item.voice,
        layer: item.layer,
        role: item.role,
        reasonZh: reason.zh,
        reasonEn: reason.en,
      });
    } else {
      const stream = streams.get(streamId)!;
      if (item.kind === "chord" || item.kind === "unison") {
        const reason = reasonFor(item.kind, item.layer, plan);
        stream.reasonZh = reason.zh;
        stream.reasonEn = reason.en;
      }
    }
    out.push({
      id: idGen(),
      trackId: item.role,
      streamId,
      midi: item.raw.midi,
      startBeat: item.raw.startBeat,
      durationBeats: item.raw.durationBeats,
      velocity: item.raw.velocity ?? 92,
      lyric: item.raw.lyric,
    });
  }
  return { notes: out, streams: [...streams.values()] };
}

function realizePlain(
  notes: RawNote[],
  plan: StaffPlan,
  idGen: () => string,
): { notes: NoteEvent[]; streams: StreamInfo[] } {
  if (!notes.length) return { notes: [], streams: [] };
  const streamId = `${plan.partId}|s${plan.staff}|all`;
  const stream: StreamInfo = {
    id: streamId,
    partId: plan.partId,
    partName: plan.partName,
    staff: plan.staff,
    voice: 0,
    layer: "all",
    role: plan.upper,
    reasonZh: plan.reasonZh,
    reasonEn: plan.reasonEn,
  };
  return {
    streams: [stream],
    notes: notes.map((note) => ({
      id: idGen(),
      trackId: plan.upper,
      streamId,
      midi: note.midi,
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      velocity: note.velocity ?? (plan.mode === "piano" ? 78 : 92),
      lyric: note.lyric,
    })),
  };
}

export function separateScore(score: RawScore, options: SeparateOptions = {}): ScoreProject {
  const plans = planStaves(score.parts, options);
  const warnings = score.warnings.slice();
  if (options.choirLayout) {
    for (const part of score.parts) {
      const missing = [];
      for (let staff = 1; staff <= staffCount(part); staff++) {
        if (!part.clefs.some((clef) => clef.staff === staff) && part.notes.some((note) => note.staff === staff)) {
          missing.push(staff);
        }
      }
      if (missing.length) {
        warnings.push(`${part.name || part.id} 谱表 ${missing.join("、")} 没有谱号，音高可能差八度，可在卷帘里改。`);
      }
    }
  }
  let serial = 0;
  const idGen = () => `n${++serial}`;
  const notes: NoteEvent[] = [];
  const streams: StreamInfo[] = [];
  for (const plan of plans) {
    const part = score.parts.find((item) => item.id === plan.partId);
    if (!part) continue;
    const staffNotes = part.notes.filter((note) => note.staff === plan.staff);
    const realized =
      plan.mode === "shared" ? realizeShared(staffNotes, plan, idGen) : realizePlain(staffNotes, plan, idGen);
    notes.push(...realized.notes);
    streams.push(...realized.streams);
  }
  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

  let voiced = notes;
  if (options.choirLayout) {
    const corrected = correctRoleOctaves(notes);
    voiced = corrected.notes;
    warnings.push(...corrected.warnings);
  }

  const roles = [
    ...ROLE_ORDER,
    ...OPTIONAL_ROLES.filter((role) => voiced.some((note) => note.trackId === role)),
  ];
  const tracks = roles.map((role) => makeTrack(role));

  return {
    title: score.title || "未命名",
    tracks,
    notes: voiced,
    streams,
    tempos: score.tempos.length ? score.tempos : [{ beat: 0, bpm: 120 }],
    meters: score.meters.length ? score.meters : [{ beat: 0, beats: 4, beatType: 4 }],
    keys: score.keys.length ? score.keys : [{ beat: 0, fifths: 0, mode: "major" }],
    measures: score.measures,
    warnings,
  };
}

export function applyStreamRoles(project: ScoreProject, updates: Record<string, Role>): ScoreProject {
  const streams = project.streams.map((stream) =>
    updates[stream.id] ? { ...stream, role: updates[stream.id] } : stream,
  );
  const roles = new Map(streams.map((stream) => [stream.id, stream.role]));
  return {
    ...project,
    streams,
    notes: project.notes.map((note) => {
      const role = roles.get(note.streamId);
      return role ? { ...note, trackId: role } : note;
    }),
  };
}

export function moveNotesToRole(project: ScoreProject, ids: string[], role: Role): ScoreProject {
  const selected = new Set(ids);
  return {
    ...project,
    notes: project.notes.map((note) => (selected.has(note.id) ? { ...note, trackId: role } : note)),
  };
}

export function layerOf(stream: StreamInfo): Layer {
  return stream.layer;
}
