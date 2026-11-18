import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseMusicXml } from "../lib/musicxml/parse";
import { projectFromMidi, projectFromMxl, projectFromMusicXml, toMidi, toMusicXml } from "../lib/project";
import { applyStreamRoles } from "../lib/separate";
import { beatToSeconds } from "../lib/timing";
import { note, partwise, scorePart } from "./helpers";

function load(xml: string) {
  return projectFromMusicXml(xml);
}

describe("voice separation", () => {
  it("splits a closed score by stem direction, not just voice number", () => {
    const xml = partwise(
      scorePart("P1", "合唱"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
        ${note({ midi: 67, duration: 4, voice: 1, staff: 1, stem: "down" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 72, duration: 4, voice: 2, staff: 1, stem: "up" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 64, duration: 4, voice: 5, staff: 2, stem: "up" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 48, duration: 4, voice: 6, staff: 2, stem: "down" })}
      </measure></part>`,
    );
    const project = load(xml);
    const at = (role: string) => project.notes.filter((n) => n.trackId === role);
    expect(at("soprano").map((n) => n.midi)).toEqual([72]);
    expect(at("alto").map((n) => n.midi)).toEqual([67]);
    expect(at("tenor").map((n) => n.midi)).toEqual([64]);
    expect(at("bass").map((n) => n.midi)).toEqual([48]);
    expect(at("soprano")[0].startBeat).toBeCloseTo(0);
    expect(at("alto")[0].startBeat).toBeCloseTo(0);
  });

  it("falls back to voice numbers when stems are missing", () => {
    const xml = partwise(
      scorePart("P1", "SATB"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
        ${note({ midi: 72, duration: 4, voice: 1, staff: 1 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 67, duration: 4, voice: 2, staff: 1 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 64, duration: 4, voice: 5, staff: 2 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 48, duration: 4, voice: 6, staff: 2 })}
      </measure></part>`,
    );
    const project = load(xml);
    expect(project.notes.find((n) => n.midi === 72)?.trackId).toBe("soprano");
    expect(project.notes.find((n) => n.midi === 67)?.trackId).toBe("alto");
    expect(project.notes.find((n) => n.midi === 64)?.trackId).toBe("tenor");
    expect(project.notes.find((n) => n.midi === 48)?.trackId).toBe("bass");
  });

  it("splits chords in one voice and copies a unison to both", () => {
    const xml = partwise(
      scorePart("P1", "Choir"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
          <clef number="1"><sign>G</sign><line>2</line></clef>
          <clef number="2"><sign>F</sign><line>4</line></clef>
        </attributes>
        ${note({ midi: 76, duration: 1, voice: 1, staff: 1, stem: "up" })}
        ${note({ midi: 72, duration: 1, voice: 1, staff: 1, chord: true })}
        ${note({ midi: 67, duration: 1, voice: 1, staff: 1 })}
        ${note({ rest: true, duration: 2, voice: 1, staff: 1 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 64, duration: 1, voice: 5, staff: 2, stem: "up" })}
        ${note({ midi: 48, duration: 1, voice: 5, staff: 2, chord: true })}
        ${note({ midi: 55, duration: 1, voice: 5, staff: 2 })}
        ${note({ rest: true, duration: 2, voice: 5, staff: 2 })}
      </measure></part>`,
    );
    const project = load(xml);
    const soprano = project.notes.filter((n) => n.trackId === "soprano");
    const alto = project.notes.filter((n) => n.trackId === "alto");
    expect(soprano.map((n) => [n.midi, n.startBeat])).toEqual([
      [76, 0],
      [67, 1],
    ]);
    expect(alto.map((n) => [n.midi, n.startBeat])).toEqual([
      [72, 0],
      [67, 1],
    ]);
    expect(project.notes.filter((n) => n.trackId === "tenor").map((n) => n.midi).sort()).toEqual([55, 64]);
    expect(project.notes.filter((n) => n.trackId === "bass").map((n) => n.midi).sort()).toEqual([48, 55]);
  });

  it("keeps a monophonic shared-staff voice on one part when the other voice is resting", () => {
    const xml = partwise(
      scorePart("P1", "合唱"),
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
          ${note({ midi: 72, duration: 1, voice: 1, staff: 1, stem: "up" })}
          <backup><duration>1</duration></backup>
          ${note({ midi: 67, duration: 1, voice: 2, staff: 1, stem: "down" })}
          <backup><duration>1</duration></backup>
          ${note({ midi: 64, duration: 1, voice: 5, staff: 2, stem: "up" })}
          <backup><duration>1</duration></backup>
          ${note({ midi: 48, duration: 1, voice: 6, staff: 2, stem: "down" })}
        </measure>
        <measure number="2">
          ${note({ midi: 74, duration: 1, voice: 1, staff: 1, stem: "up" })}
          <backup><duration>1</duration></backup>
          ${note({ rest: true, duration: 1, voice: 2, staff: 1 })}
          <backup><duration>1</duration></backup>
          ${note({ midi: 65, duration: 1, voice: 5, staff: 2, stem: "up" })}
          <backup><duration>1</duration></backup>
          ${note({ rest: true, duration: 1, voice: 6, staff: 2 })}
        </measure>
      </part>`,
    );
    const project = load(xml);
    const soprano = project.notes.filter((n) => n.trackId === "soprano");
    const alto = project.notes.filter((n) => n.trackId === "alto");
    expect(soprano.map((n) => n.midi)).toEqual([72, 74]);
    expect(alto.map((n) => n.midi)).toEqual([67]);
    expect(project.notes.filter((n) => n.trackId === "bass")).toHaveLength(1);
  });

  it("detects an open score and a separate piano grand staff", () => {
    const voicePart = (id: string, name: string, midi: number) =>
      `<part id="${id}"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi, duration: 4, lyric: "啊" })}
      </measure></part>`;
    const xml = partwise(
      [
        scorePart("S", "女高音"),
        scorePart("A", "女低音"),
        scorePart("T", "男高音"),
        scorePart("B", "男低音"),
        scorePart("P", "钢琴"),
      ].join(""),
      [
        voicePart("S", "女高音", 72),
        voicePart("A", "女低音", 67),
        voicePart("T", "男高音", 64),
        voicePart("B", "男低音", 48),
        `<part id="P"><measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
          ${note({ midi: 76, duration: 4, staff: 1 })}
          ${note({ midi: 72, duration: 4, staff: 1, chord: true })}
          <backup><duration>4</duration></backup>
          ${note({ midi: 36, duration: 4, staff: 2 })}
        </measure></part>`,
      ].join(""),
    );
    const project = load(xml);
    expect(project.notes.find((n) => n.midi === 72 && n.lyric)?.trackId).toBe("soprano");
    expect(project.notes.find((n) => n.midi === 67)?.trackId).toBe("alto");
    expect(project.notes.find((n) => n.midi === 64)?.trackId).toBe("tenor");
    expect(project.notes.find((n) => n.midi === 48)?.trackId).toBe("bass");
    expect(project.notes.find((n) => n.midi === 76)?.trackId).toBe("piano-rh");
    expect(project.notes.find((n) => n.midi === 72 && !n.lyric)?.trackId).toBe("piano-rh");
    expect(project.notes.find((n) => n.midi === 36)?.trackId).toBe("piano-lh");
  });

  it("does not turn a piano reduction into SATB", () => {
    const xml = partwise(
      scorePart("P1", "Piano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
        ${note({ midi: 76, duration: 1, staff: 1 })}
        ${note({ midi: 72, duration: 1, staff: 1, chord: true })}
        ${note({ midi: 74, duration: 1, staff: 1 })}
        ${note({ rest: true, duration: 2, staff: 1 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 48, duration: 2, staff: 2 })}
        ${note({ midi: 43, duration: 2, staff: 2 })}
      </measure></part>`,
    );
    const project = load(xml);
    expect(project.notes.every((n) => n.trackId === "piano-rh" || n.trackId === "piano-lh")).toBe(true);
    expect(project.notes.filter((n) => n.trackId === "piano-rh").map((n) => n.midi).sort()).toEqual([72, 74, 76]);
    expect(project.notes.filter((n) => n.trackId === "piano-lh").map((n) => n.startBeat)).toEqual([0, 2]);
  });

  it("ranks four unnamed staves by pitch", () => {
    const one = (id: string, midi: number) =>
      `<part id="${id}"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi, duration: 4 })}
      </measure></part>`;
    const xml = partwise(
      ["P1", "P2", "P3", "P4"].map((id) => scorePart(id, `Voice ${id}`)).join(""),
      [one("P1", 60), one("P2", 72), one("P3", 48), one("P4", 67)].join(""),
    );
    const project = load(xml);
    expect(project.notes.find((n) => n.midi === 72)?.trackId).toBe("soprano");
    expect(project.notes.find((n) => n.midi === 67)?.trackId).toBe("alto");
    expect(project.notes.find((n) => n.midi === 60)?.trackId).toBe("tenor");
    expect(project.notes.find((n) => n.midi === 48)?.trackId).toBe("bass");
  });

  it("lets the user override a stream", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 4 })}
      </measure></part>`,
    );
    const project = load(xml);
    const streamId = project.streams[0].id;
    const next = applyStreamRoles(project, { [streamId]: "alto" });
    expect(next.notes[0].trackId).toBe("alto");
    expect(next.streams[0].role).toBe("alto");
  });
});

describe("musicxml timing", () => {
  it("advances through rests and lines voices up after backup", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 1 })}
        ${note({ rest: true, duration: 1 })}
        ${note({ midi: 74, duration: 1 })}
        ${note({ midi: 76, duration: 1 })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 67, duration: 4, voice: 2 })}
      </measure></part>`,
    );
    const score = parseMusicXml(xml);
    const notes = score.parts[0].notes;
    expect(notes.find((n) => n.midi === 74)?.startBeat).toBeCloseTo(2);
    expect(notes.find((n) => n.midi === 67)?.startBeat).toBeCloseTo(0);
    expect(notes.find((n) => n.midi === 67)?.durationBeats).toBeCloseTo(4);
  });

  it("keeps the timeline continuous across meter changes", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <direction><sound tempo="60"/></direction>
          ${note({ midi: 72, duration: 4 })}
        </measure>
        <measure number="2">
          <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
          <direction><sound tempo="120"/></direction>
          ${note({ midi: 74, duration: 3 })}
        </measure>
        <measure number="3">
          <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          ${note({ midi: 76, duration: 1 })}
          ${note({ rest: true, duration: 3 })}
        </measure>
      </part>`,
    );
    const project = load(xml);
    const notes = project.notes.filter((n) => n.trackId === "soprano");
    expect(notes.map((n) => [n.midi, n.startBeat, n.durationBeats])).toEqual([
      [72, 0, 4],
      [74, 4, 3],
      [76, 7, 1],
    ]);
    expect(project.measures.map((m) => m.startBeat)).toEqual([0, 4, 7]);
    expect(beatToSeconds(4, project.tempos)).toBeCloseTo(4);
    expect(beatToSeconds(6, project.tempos)).toBeCloseTo(5);
    expect(beatToSeconds(7, project.tempos)).toBeCloseTo(5.5);
  });

  it("merges ties across a barline", () => {
    const xml = partwise(
      scorePart("P1", "Alto"),
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          ${note({ midi: 67, duration: 4, tie: "start" })}
        </measure>
        <measure number="2">
          ${note({ midi: 67, duration: 2, tie: "stop" })}
          ${note({ rest: true, duration: 2 })}
        </measure>
      </part>`,
    );
    const project = load(xml);
    expect(project.notes).toHaveLength(1);
    expect(project.notes[0].trackId).toBe("alto");
    expect(project.notes[0].durationBeats).toBeCloseTo(6);
  });

  it("does not insert a silent full bar before a pickup", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1">
        <measure number="0" implicit="yes">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          ${note({ midi: 72, duration: 1 })}
        </measure>
        <measure number="1">
          ${note({ midi: 76, duration: 4 })}
        </measure>
      </part>`,
    );
    const project = load(xml);
    expect(project.notes.map((n) => [n.midi, n.startBeat])).toEqual([
      [72, 0],
      [76, 1],
    ]);
    expect(project.measures[0].lengthBeats).toBeCloseTo(1);
    expect(project.measures[1].startBeat).toBeCloseTo(1);
  });

  it("reads a compressed mxl package", () => {
    const xml = partwise(
      scorePart("P1", "Tenor"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 65, duration: 4, lyric: "来" })}
      </measure></part>`,
    );
    const packed = zipSync({
      "META-INF/container.xml": strToU8(
        `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>`,
      ),
      "score.musicxml": strToU8(xml),
    });
    const project = projectFromMxl(packed);
    expect(project.notes).toHaveLength(1);
    expect(project.notes[0].trackId).toBe("tenor");
    expect(project.notes[0].lyric).toBe("来");
  });
});

describe("round trip", () => {
  it("exports MIDI and MusicXML without moving sounding notes", () => {
    const xml = partwise(
      scorePart("P1", "Soprano") + scorePart("P2", "Piano RH"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <direction><sound tempo="90"/></direction>
        ${note({ midi: 72, duration: 3, lyric: "啊" })}
        ${note({ midi: 74, duration: 5 })}
      </measure></part>
      <part id="P2"><measure number="1">
        <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 48, duration: 8 })}
      </measure></part>`,
    );
    const project = load(xml);
    const midi = toMidi(project);
    const fromMidi = projectFromMidi(midi);
    expect(fromMidi.notes.find((n) => n.trackId === "soprano" && n.midi === 72)?.startBeat).toBeCloseTo(0);
    expect(fromMidi.notes.find((n) => n.midi === 72)?.durationBeats).toBeCloseTo(1.5, 2);
    expect(fromMidi.notes.find((n) => n.midi === 74)?.startBeat).toBeCloseTo(1.5, 2);
    expect(fromMidi.notes.find((n) => n.trackId === "piano-rh" && n.midi === 48)?.durationBeats).toBeCloseTo(4, 2);
    expect(fromMidi.tempos[0].bpm).toBeCloseTo(90, 0);

    const again = load(toMusicXml(project));
    const soprano = again.notes.filter((n) => n.trackId === "soprano");
    expect(soprano.map((n) => n.midi)).toEqual([72, 74]);
    expect(soprano[0].durationBeats).toBeCloseTo(1.5, 2);
    expect(soprano[0].lyric).toBe("啊");
    expect(soprano[1].startBeat).toBeCloseTo(1.5, 2);
  });
});
