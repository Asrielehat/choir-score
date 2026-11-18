import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIV = 4;

const q = (midi, lyric) => ({ beats: 1, notes: lyric ? [{ midi, lyric }] : [{ midi }] });
const h = (midi, lyric) => ({ beats: 2, notes: lyric ? [{ midi, lyric }] : [{ midi }] });
const rest = (beats) => ({ beats, rest: true, notes: [] });
const chord = (beats, midis, lyric) => ({
  beats,
  notes: midis.map((midi, index) => ({ midi, lyric: index === 0 ? lyric : undefined })),
});
const voice = (staff, number, stem, events) => ({ staff, voice: number, stem, events });

/**
 * 晨光 — original SATB exercise, public domain.
 * Closed score: SA share the treble staff, TB share the bass staff, plus piano.
 * Measures 1–6 use explicit MusicXML voices and stem directions.
 * Measures 7–8 are written as chords in one voice, including a unison.
 * Meter goes 4/4 → 3/4 → 4/4 and the tempo changes with the meter.
 */
const choir = [
  {
    beats: 4,
    time: [4, 4],
    tempo: 80,
    voices: [
      voice(1, 1, "up", [q(72, "晨"), q(76, "光"), q(79, "洒"), q(76, "落")]),
      voice(1, 2, "down", [h(67, "晨"), q(76, "洒"), q(72, "落")]),
      voice(2, 5, "up", [q(64, "晨"), q(67, "光"), q(72, "洒"), q(67, "落")]),
      voice(2, 6, "down", [q(48, "晨"), q(48, "光"), q(52, "洒"), q(48, "落")]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [q(77, "大"), q(76, "地"), q(74, "苏"), q(72, "醒")]),
      voice(1, 2, "down", [q(72, "大"), q(72, "地"), q(71, "苏"), q(67, "醒")]),
      voice(2, 5, "up", [q(69, "大"), q(67, "地"), q(65, "苏"), q(64, "醒")]),
      voice(2, 6, "down", [q(41, "大"), q(48, "地"), q(43, "苏"), q(48, "醒")]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [q(76, "我"), q(79, "们"), q(81, "歌"), q(79, "唱")]),
      voice(1, 2, "down", [q(72, "我"), q(76, "们"), q(77, "歌"), q(74, "唱")]),
      voice(2, 5, "up", [q(69, "我"), q(72, "们"), q(72, "歌"), q(71, "唱")]),
      voice(2, 6, "down", [q(45, "我"), q(48, "们"), q(41, "歌"), q(43, "唱")]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [q(79, "颂"), q(77, "赞"), h(76, "平")]),
      voice(1, 2, "down", [q(76, "颂"), q(74, "赞"), h(72, "平")]),
      voice(2, 5, "up", [q(72, "颂"), q(69, "赞"), h(67, "平")]),
      voice(2, 6, "down", [q(48, "颂"), q(50, "赞"), h(48, "平")]),
    ],
  },
  {
    beats: 3,
    time: [3, 4],
    tempo: 100,
    voices: [
      voice(1, 1, "up", [q(79, "心"), q(77, "相"), q(76, "连")]),
      voice(1, 2, "down", [q(76, "心"), q(74, "相"), q(72, "连")]),
      voice(2, 5, "up", [q(72, "心"), q(71, "相"), q(67, "连")]),
      voice(2, 6, "down", [q(48, "心"), q(43, "相"), q(48, "连")]),
    ],
  },
  {
    beats: 3,
    voices: [
      voice(1, 1, "up", [q(74, "声"), q(71, "相"), q(72, "和")]),
      voice(1, 2, "down", [q(69, "声"), q(67, "相"), q(67, "和")]),
      voice(2, 5, "up", [q(65, "声"), q(62, "相"), q(64, "和")]),
      voice(2, 6, "down", [q(50, "声"), q(43, "相"), q(48, "和")]),
    ],
  },
  {
    beats: 4,
    time: [4, 4],
    tempo: 80,
    voices: [
      voice(1, 1, "up", [chord(1, [76, 72], "同"), chord(1, [77, 72], "声"), chord(1, [79, 74], "赞"), q(76, "美")]),
      voice(2, 5, "up", [chord(1, [67, 48], "同"), chord(1, [69, 53], "声"), chord(1, [71, 55], "赞"), q(64, "美")]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [chord(2, [74, 71], "永"), chord(2, [72, 67], "远")]),
      voice(2, 5, "up", [chord(2, [67, 43], "永"), chord(2, [64, 48], "远")]),
    ],
  },
];

const piano = [
  {
    beats: 4,
    time: [4, 4],
    tempo: 80,
    voices: [
      voice(1, 1, "up", [chord(1, [67, 64]), chord(1, [67, 72]), chord(1, [76, 72]), chord(1, [67, 72])]),
      voice(2, 2, "down", [q(48), rest(1), q(43), q(48)]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [chord(1, [77, 72]), chord(1, [76, 72, 67]), chord(1, [74, 71, 65]), chord(1, [72, 67, 64])]),
      voice(2, 2, "down", [q(41), q(48), q(43), q(48)]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [chord(1, [76, 72]), chord(1, [79, 76]), chord(1, [81, 77, 72]), chord(1, [79, 74, 71])]),
      voice(2, 2, "down", [q(45), q(48), q(41), q(43)]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [chord(1, [79, 76]), chord(1, [77, 74]), chord(2, [76, 72, 67])]),
      voice(2, 2, "down", [q(48), q(50), h(48)]),
    ],
  },
  {
    beats: 3,
    time: [3, 4],
    tempo: 100,
    voices: [
      voice(1, 1, "up", [chord(1, [79, 76]), rest(1), chord(1, [76, 72])]),
      voice(2, 2, "down", [q(48), q(43), q(48)]),
    ],
  },
  {
    beats: 3,
    voices: [
      voice(1, 1, "up", [chord(1, [74, 69, 65]), chord(1, [71, 67, 62]), chord(1, [72, 67, 64])]),
      voice(2, 2, "down", [q(50), q(43), q(48)]),
    ],
  },
  {
    beats: 4,
    time: [4, 4],
    tempo: 80,
    voices: [
      voice(1, 1, "up", [chord(1, [76, 72, 67]), chord(1, [77, 72, 69]), chord(1, [79, 74, 71]), chord(1, [76, 72, 64])]),
      voice(2, 2, "down", [q(48), q(53), q(55), q(48)]),
    ],
  },
  {
    beats: 4,
    voices: [
      voice(1, 1, "up", [chord(2, [74, 71, 67]), chord(2, [72, 67, 64])]),
      voice(2, 2, "down", [h(43), h(48)]),
    ],
  },
];

function pitchXml(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const alter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][pc];
  const step = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"][pc];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function emitVoices(voices, measureBeats) {
  const target = measureBeats * DIV;
  return voices
    .map((v, index) => {
      let sum = 0;
      const body = v.events
        .map((event) => {
          const dur = event.beats * DIV;
          sum += dur;
          if (event.rest) {
            return `<note><rest/><duration>${dur}</duration><voice>${v.voice}</voice><staff>${v.staff}</staff></note>`;
          }
          return event.notes
            .map((note, noteIndex) => {
              const lyric = note.lyric
                ? `<lyric number="1"><syllabic>single</syllabic><text>${note.lyric}</text></lyric>`
                : "";
              return `<note>${noteIndex ? "<chord/>" : ""}${pitchXml(note.midi)}<duration>${dur}</duration><voice>${v.voice}</voice><stem>${v.stem}</stem><staff>${v.staff}</staff>${lyric}</note>`;
            })
            .join("");
        })
        .join("");
      if (sum !== target) {
        throw new Error(`voice ${v.voice} staff ${v.staff} sums to ${sum}, expected ${target}`);
      }
      const backup = index === 0 ? "" : `<backup><duration>${target}</duration></backup>`;
      return backup + body;
    })
    .join("");
}

function emitPart(id, measures, clefs) {
  let prevTime = "";
  return `<part id="${id}">${measures
    .map((measure, index) => {
      const time = measure.time ? `${measure.time[0]}/${measure.time[1]}` : prevTime;
      const timeChanged = measure.time && time !== prevTime;
      prevTime = time;
      const attrs = [];
      if (index === 0) {
        attrs.push(`<divisions>${DIV}</divisions>`);
        attrs.push(`<key><fifths>0</fifths><mode>major</mode></key>`);
        attrs.push(`<time><beats>${measure.time[0]}</beats><beat-type>${measure.time[1]}</beat-type></time>`);
        attrs.push(`<staves>2</staves>`);
        attrs.push(clefs);
      } else if (timeChanged) {
        attrs.push(`<time><beats>${measure.time[0]}</beats><beat-type>${measure.time[1]}</beat-type></time>`);
      }
      const tempo = measure.tempo
        ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${measure.tempo}</per-minute></metronome></direction-type><sound tempo="${measure.tempo}"/></direction>`
        : "";
      const attrXml = attrs.length ? `<attributes>${attrs.join("")}</attributes>` : "";
      return `<measure number="${index + 1}">${attrXml}${tempo}${emitVoices(measure.voices, measure.beats)}</measure>`;
    })
    .join("")}</part>`;
}

const clefs = `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>晨光</work-title></work>
  <movement-title>Chen Guang</movement-title>
  <identification>
    <creator type="composer">Choir Roll exercise</creator>
    <rights>Original exercise, dedicated to the public domain.</rights>
    <encoding><software>Choir Roll</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>合唱</part-name>
      <part-abbreviation>SATB</part-abbreviation>
      <score-instrument id="P1-I1"><instrument-name>Choir</instrument-name></score-instrument>
    </score-part>
    <score-part id="P2">
      <part-name>钢琴</part-name>
      <part-abbreviation>Pno.</part-abbreviation>
      <score-instrument id="P2-I1"><instrument-name>Piano</instrument-name></score-instrument>
      <midi-instrument id="P2-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
    </score-part>
  </part-list>
  ${emitPart("P1", choir, clefs)}
  ${emitPart("P2", piano, clefs)}
</score-partwise>
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "samples", "chen-guang.musicxml");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml);
console.log(`wrote ${out} (${xml.length} bytes)`);
