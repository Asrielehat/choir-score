import { ensureMeasures, projectEndBeat } from "../timing";
import { ROLE_META, ROLE_ORDER, type KeyPoint, type Role, type ScoreProject } from "../types";

const DIVISIONS = 480;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pitchXml(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const alter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][pc];
  const step = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"][pc];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function clefXml(role: Role): string {
  if (role === "bass" || role === "piano-lh") return `<clef><sign>F</sign><line>4</line></clef>`;
  if (role === "tenor") return `<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`;
  return `<clef><sign>G</sign><line>2</line></clef>`;
}

interface Slice {
  midi: number;
  startTick: number;
  endTick: number;
  lyric?: string;
  tieStart: boolean;
  tieStop: boolean;
}

function tick(beat: number): number {
  return Math.round(beat * DIVISIONS);
}

export function exportMusicXml(project: ScoreProject): string {
  const endBeat = projectEndBeat(project);
  const measures = ensureMeasures(project, endBeat);
  const roles = ROLE_ORDER.filter((role) => project.notes.some((note) => note.trackId === role));
  const used = roles.length ? roles : (["soprano"] as Role[]);
  const partList = used
    .map((role, index) => {
      const meta = ROLE_META[role];
      const id = `P${index + 1}`;
      return `<score-part id="${id}"><part-name>${xmlEscape(`${meta.nameZh} ${meta.name}`)}</part-name><part-abbreviation>${meta.short}</part-abbreviation><score-instrument id="${id}-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="${id}-I1"><midi-channel>${index + 1}</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`;
    })
    .join("");
  const parts = used
    .map((role, index) => exportPart(project, role, `P${index + 1}`, measures))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${xmlEscape(project.title || "Choir Roll")}</work-title></work>
  <identification>
    <encoding>
      <software>Choir Roll</software>
      <encoding-description>Sounding pitches. Tenor uses a treble clef octave down; pitches are concert pitch.</encoding-description>
    </encoding>
  </identification>
  <part-list>${partList}</part-list>
  ${parts}
</score-partwise>
`;
}

function exportPart(
  project: ScoreProject,
  role: Role,
  id: string,
  measures: ReturnType<typeof ensureMeasures>,
): string {
  const slices: Slice[] = [];
  for (const note of project.notes.filter((item) => item.trackId === role)) {
    let startBeat = note.startBeat;
    let dur = note.durationBeats;
    if (startBeat < 0) {
      dur += startBeat;
      startBeat = 0;
    }
    if (!(dur > 0.01)) continue;
    const start = tick(startBeat);
    const end = Math.max(start + 1, tick(startBeat + dur));
    const pieces: Slice[] = [];
    for (const measure of measures) {
      const m0 = tick(measure.startBeat);
      const m1 = tick(measure.startBeat + measure.lengthBeats);
      const s = Math.max(start, m0);
      const e = Math.min(end, m1);
      if (e <= s) continue;
      pieces.push({
        midi: note.midi,
        startTick: s,
        endTick: e,
        lyric: s === start ? note.lyric : undefined,
        tieStart: e < end,
        tieStop: s > start,
      });
    }
    slices.push(...pieces);
  }

  let key: KeyPoint = project.keys[0] ?? { beat: 0, fifths: 0, mode: "major" };
  let meter = { beats: measures[0]?.beats ?? 4, beatType: measures[0]?.beatType ?? 4 };
  const body = measures
    .map((measure, index) => {
      const m0 = tick(measure.startBeat);
      const m1 = tick(measure.startBeat + measure.lengthBeats);
      const inBar = slices
        .filter((slice) => slice.startTick >= m0 && slice.startTick < m1)
        .sort((a, b) => a.startTick - b.startTick || b.endTick - a.endTick || b.midi - a.midi);
      const attrs: string[] = [];
      if (index === 0) attrs.push(`<divisions>${DIVISIONS}</divisions>`);
      const nextKey = keyAt(project, measure.startBeat);
      if (index === 0 || nextKey.fifths !== key.fifths || nextKey.mode !== key.mode) {
        attrs.push(`<key><fifths>${nextKey.fifths}</fifths><mode>${nextKey.mode}</mode></key>`);
        key = nextKey;
      }
      if (index === 0 || measure.beats !== meter.beats || measure.beatType !== meter.beatType) {
        attrs.push(`<time><beats>${measure.beats}</beats><beat-type>${measure.beatType}</beat-type></time>`);
        meter = { beats: measure.beats, beatType: measure.beatType };
      }
      if (index === 0) attrs.push(clefXml(role));
      const tempo = project.tempos.find((item) => Math.abs(item.beat - measure.startBeat) < 1e-3);
      const direction = tempo
        ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(tempo.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(tempo.bpm)}"/></direction>`
        : "";
      let cursor = m0;
      let lastStart = -1;
      let notesXml = "";
      for (const slice of inBar) {
        const dur = slice.endTick - slice.startTick;
        if (slice.startTick > cursor) {
          notesXml += restXml(slice.startTick - cursor);
          cursor = slice.startTick;
          lastStart = -1;
        }
        if (slice.startTick === lastStart) {
          notesXml += noteXml(slice, dur, true);
        } else if (slice.startTick < cursor) {
          notesXml += `<backup><duration>${cursor - slice.startTick}</duration></backup>`;
          notesXml += noteXml(slice, dur, false);
          cursor = slice.endTick;
          lastStart = slice.startTick;
        } else {
          notesXml += noteXml(slice, dur, false);
          cursor = slice.endTick;
          lastStart = slice.startTick;
        }
      }
      if (cursor < m1) notesXml += restXml(m1 - cursor);
      if (!notesXml) notesXml = restXml(Math.max(1, m1 - m0));
      const attrXml = attrs.length ? `<attributes>${attrs.join("")}</attributes>` : "";
      return `<measure number="${measure.index}">${attrXml}${direction}${notesXml}</measure>`;
    })
    .join("");
  return `<part id="${id}">${body}</part>`;
}

function keyAt(project: ScoreProject, beat: number): KeyPoint {
  let key = project.keys[0] ?? { beat: 0, fifths: 0, mode: "major" as const };
  for (const item of project.keys) if (item.beat <= beat + 1e-6) key = item;
  return key;
}

function restXml(duration: number): string {
  return `<note><rest/><duration>${Math.max(1, Math.round(duration))}</duration><voice>1</voice></note>`;
}

function noteXml(slice: Slice, duration: number, chord: boolean): string {
  const ties = [
    slice.tieStop ? `<tie type="stop"/>` : "",
    slice.tieStart ? `<tie type="start"/>` : "",
  ].join("");
  const tied = [
    slice.tieStop ? `<tied type="stop"/>` : "",
    slice.tieStart ? `<tied type="start"/>` : "",
  ].join("");
  const notations = tied ? `<notations>${tied}</notations>` : "";
  const lyric = slice.lyric
    ? `<lyric number="1"><syllabic>single</syllabic><text>${xmlEscape(slice.lyric)}</text></lyric>`
    : "";
  return `<note>${chord ? "<chord/>" : ""}${pitchXml(slice.midi)}<duration>${Math.max(1, Math.round(duration))}</duration>${ties}<voice>1</voice>${notations}${lyric}</note>`;
}
