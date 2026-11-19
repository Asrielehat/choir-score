import { describe, expect, it } from "vitest";
import { readMetronomeBpm } from "../lib/metronome";
import { parseMusicXml } from "../lib/musicxml/parse";
import { projectFromMusicXml, projectFromOmrPages } from "../lib/project";
import { note, partwise, scorePart } from "./helpers";

function singlePart(id: string, midi: number, clef: string, options?: { octave?: number; lyric?: string; midis?: number[] }): string {
  const pitches = options?.midis ?? [midi];
  const line = clef === "F" ? 4 : 2;
  const octave = options?.octave ? `<clef-octave-change>${options.octave}</clef-octave-change>` : "";
  return `<part id="${id}"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>${clef}</sign><line>${line}</line>${octave}</clef>
    </attributes>
    ${pitches.map((value) => note({ midi: value, duration: 4 / pitches.length, lyric: options?.lyric })).join("")}
  </measure></part>`;
}

/** Audiveris exports a closed score as one single-staff part per printed staff, both named "Voice". */
function closedStaffPart(id: string, clef: string, upperMidi: number, lowerMidi: number): string {
  const line = clef === "F" ? 4 : 2;
  return `<part id="${id}"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>${clef}</sign><line>${line}</line></clef>
    </attributes>
    ${note({ midi: upperMidi, duration: 2, voice: 1, stem: "up", lyric: "光" })}
    ${note({ midi: 62, duration: 1 })}
    <backup><duration>4</duration></backup>
    ${note({ midi: lowerMidi, duration: 4, voice: 2, stem: "down", lyric: "光" })}
  </measure></part>`;
}

describe("OMR post-processing", () => {
  it("splits a closed score that arrives as two unnamed single-staff parts", () => {
    const xml = partwise(
      [scorePart("P1", "Voice"), scorePart("P2", "Voice")].join(""),
      [closedStaffPart("P1", "G", 72, 64), closedStaffPart("P2", "F", 55, 48)].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    const trackOf = (midi: number) => project.notes.filter((item) => item.midi === midi).map((item) => item.trackId).sort();
    expect(trackOf(72)).toEqual(["soprano"]);
    expect(trackOf(64)).toEqual(["alto"]);
    expect(trackOf(55)).toEqual(["tenor"]);
    expect(trackOf(48)).toEqual(["bass"]);
  });

  it("still keeps four open-score parts one voice each", () => {
    const xml = partwise(
      ["P1", "P2", "P3", "P4"].map((id) => scorePart(id, "Voice")).join(""),
      [
        singlePart("P1", 72, "G", { lyric: "光" }),
        singlePart("P2", 67, "G", { lyric: "光" }),
        singlePart("P3", 60, "G", { lyric: "光" }),
        singlePart("P4", 48, "F", { lyric: "光" }),
      ].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.find((item) => item.midi === 72)?.trackId).toBe("soprano");
    expect(project.notes.find((item) => item.midi === 67)?.trackId).toBe("alto");
    expect(project.notes.find((item) => item.midi === 60)?.trackId).toBe("tenor");
    expect(project.notes.find((item) => item.midi === 48)?.trackId).toBe("bass");
  });

  it("trims an over-full measure back to the barline and does not shift the next bar", () => {
    const quarters = [72, 74, 76, 77, 79].map((midi) => note({ midi, duration: 1 })).join("");
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          ${quarters}
        </measure>
        <measure number="2">
          ${note({ midi: 71, duration: 1 })}
          ${note({ rest: true, duration: 3 })}
        </measure>
      </part>`,
    );
    const locked = parseMusicXml(xml, { lockToMeter: true });
    const soprano = locked.parts[0].notes;
    expect(soprano).toHaveLength(6);
    expect(soprano.slice(0, 5).map((item) => item.midi)).toEqual([72, 74, 76, 77, 79]);
    expect(soprano.slice(0, 5).map((item) => item.durationBeats)).toEqual([0.8, 0.8, 0.8, 0.8, 0.8]);
    expect(soprano[5].midi).toBe(71);
    expect(soprano[5].startBeat).toBeCloseTo(4);
    expect(locked.measures[1].startBeat).toBeCloseTo(4);
    expect(locked.warnings.some((warning) => warning.includes("压进拍号"))).toBe(true);

    const loose = parseMusicXml(xml);
    expect(loose.parts[0].notes.map((item) => item.startBeat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(loose.measures[1].startBeat).toBeCloseTo(5);
  });

  it("reads a closed SA/TB system with the piano grand staff underneath", () => {
    const xml = partwise(
      scorePart("P1", "Voice"),
      `<part id="P1"><measure number="1">
        <attributes>
          <divisions>1</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
          <staves>4</staves>
          <clef number="1"><sign>G</sign><line>2</line></clef>
          <clef number="2"><sign>F</sign><line>4</line></clef>
          <clef number="3"><sign>G</sign><line>2</line></clef>
          <clef number="4"><sign>F</sign><line>4</line></clef>
        </attributes>
        ${note({ midi: 72, duration: 4, voice: 1, staff: 1, stem: "up", lyric: "光" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 67, duration: 4, voice: 2, staff: 1, stem: "down", lyric: "光" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 64, duration: 4, voice: 5, staff: 2, stem: "up", lyric: "光" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 48, duration: 4, voice: 6, staff: 2, stem: "down", lyric: "光" })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 76, duration: 4, voice: 1, staff: 3 })}
        ${note({ midi: 72, duration: 4, voice: 1, staff: 3, chord: true })}
        <backup><duration>4</duration></backup>
        ${note({ midi: 40, duration: 4, voice: 2, staff: 4 })}
      </measure></part>`,
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.find((item) => item.midi === 72 && item.lyric)?.trackId).toBe("soprano");
    expect(project.notes.find((item) => item.midi === 67)?.trackId).toBe("alto");
    expect(project.notes.find((item) => item.midi === 64)?.trackId).toBe("tenor");
    expect(project.notes.find((item) => item.midi === 48)?.trackId).toBe("bass");
    expect(project.notes.find((item) => item.midi === 76)?.trackId).toBe("piano-rh");
    expect(project.notes.find((item) => item.midi === 40)?.trackId).toBe("piano-lh");
  });

  it("keeps six unlabeled staves in page order: S A T B then piano", () => {
    const one = (id: string, midi: number, clef: string) => `<part id="${id}"><measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>${clef}</sign><line>${clef === "F" ? 4 : 2}</line></clef>
      </attributes>
      ${note({ midi, duration: 4 })}
    </measure></part>`;
    const xml = partwise(
      ["P1", "P2", "P3", "P4", "P5", "P6"].map((id) => scorePart(id, "Voice")).join(""),
      [
        one("P1", 74, "G"),
        one("P2", 69, "G"),
        one("P3", 62, "G"),
        one("P4", 50, "F"),
        one("P5", 76, "G"),
        one("P6", 43, "F"),
      ].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.find((item) => item.midi === 74)?.trackId).toBe("soprano");
    expect(project.notes.find((item) => item.midi === 69)?.trackId).toBe("alto");
    expect(project.notes.find((item) => item.midi === 62)?.trackId).toBe("tenor");
    expect(project.notes.find((item) => item.midi === 50)?.trackId).toBe("bass");
    expect(project.notes.find((item) => item.midi === 76)?.trackId).toBe("piano-rh");
    expect(project.notes.find((item) => item.midi === 43)?.trackId).toBe("piano-lh");
  });

  it("keeps soprano, tenor and bass when the alto staff is missing", () => {
    const xml = partwise(
      ["P1", "P2", "P3"].map((id) => scorePart(id, "Voice")).join(""),
      [
        singlePart("P1", 72, "G", { lyric: "光" }),
        singlePart("P2", 55, "G", { octave: -1, lyric: "光" }),
        singlePart("P3", 48, "F", { lyric: "光" }),
      ].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.find((item) => item.midi === 72)?.trackId).toBe("soprano");
    expect(project.notes.find((item) => item.midi === 55)?.trackId).toBe("tenor");
    expect(project.notes.find((item) => item.midi === 48)?.trackId).toBe("bass");
    expect(project.notes.some((item) => item.trackId === "alto")).toBe(false);
  });

  it("puts a lyric-less bass staff under the choir on its own cello track", () => {
    const xml = partwise(
      ["P1", "P2", "P3", "P4", "P5"].map((id) => scorePart(id, "Voice")).join(""),
      [
        singlePart("P1", 74, "G", { lyric: "光" }),
        singlePart("P2", 69, "G", { lyric: "光" }),
        singlePart("P3", 62, "G", { octave: -1, lyric: "光" }),
        singlePart("P4", 50, "F", { lyric: "光" }),
        singlePart("P5", 40, "F"),
      ].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.find((item) => item.midi === 50)?.trackId).toBe("bass");
    expect(project.notes.find((item) => item.midi === 40)?.trackId).toBe("cello");
    expect(project.tracks.some((track) => track.id === "cello")).toBe(true);
  });

  it("names a cello part from Vc. instead of treating it as a voice", () => {
    const xml = partwise(scorePart("P1", "Vc."), singlePart("P1", 43, "F", { midis: [40, 43, 45, 48] }));
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.every((item) => item.trackId === "cello")).toBe(true);
    expect(project.notes.map((item) => item.midi)).toEqual([40, 43, 45, 48]);
  });

  it("drops a bass part by an octave when the clef left it in the treble", () => {
    const xml = partwise(
      scorePart("P1", "Bass"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
          <clef><sign>G</sign><line>2</line></clef>
        </attributes>
        ${[72, 74, 76, 79].map((midi) => note({ midi, duration: 1 })).join("")}
      </measure></part>`,
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.map((item) => item.midi)).toEqual([60, 62, 64, 67]);
    expect(project.warnings.some((warning) => warning.includes("男低音"))).toBe(true);
  });

  it("does not transpose a tenor line that is already in its sounding range", () => {
    const xml = partwise(
      scorePart("P1", "Tenor"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
          <clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>
        </attributes>
        ${[50, 52, 53, 55].map((midi) => note({ midi, duration: 1 })).join("")}
      </measure></part>`,
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.map((item) => item.midi)).toEqual([50, 52, 53, 55]);
  });

  it("drops trailing empty bars and continues the next page on the same timeline", () => {
    const page = (midi: number, empty: boolean) =>
      partwise(
        scorePart("P1", "Soprano"),
        `<part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
              <key><fifths>2</fifths></key>
            </attributes>
            ${note({ midi, duration: 4 })}
          </measure>
          ${empty ? `<measure number="2">${note({ rest: true, duration: 4 })}</measure>` : ""}
        </part>`,
      );
    const project = projectFromOmrPages([page(72, true), page(74, false)]);
    expect(project.notes.map((item) => item.startBeat)).toEqual([0, 4]);
    expect(project.notes.map((item) => item.midi)).toEqual([72, 74]);
    expect(project.measures).toHaveLength(2);
    expect(project.keys.every((key) => key.fifths === 2)).toBe(true);
  });

  it("keeps the previous page's meter when the next page does not reprint it", () => {
    const first = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 3 })}
      </measure></part>`,
    );
    const second = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes>${note({ midi: 74, duration: 1 })}${note({ midi: 76, duration: 1 })}${note({ midi: 77, duration: 1 })}</measure>
        <measure number="2">${note({ midi: 79, duration: 1 })}</measure>
      </part>`,
    );
    const project = projectFromOmrPages([first, second]);
    expect(project.notes.map((item) => item.startBeat)).toEqual([0, 3, 4, 5, 6]);
    expect(project.meters[0]).toMatchObject({ beats: 3, beatType: 4 });
  });

  it("uses a header metronome mark only when the score has no tempo", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 4 })}
      </measure></part>`,
    );
    expect(projectFromOmrPages([xml], { bpm: 80 }).tempos[0].bpm).toBe(80);
    const marked = xml.replace(
      `<measure number="1">`,
      `<measure number="1"><direction><sound tempo="100"/></direction>`,
    );
    expect(projectFromOmrPages([marked], { bpm: 80 }).tempos[0].bpm).toBe(100);
    expect(readMetronomeBpm("2=80")).toBe(80);
    expect(readMetronomeBpm("Allegro q = 96")).toBe(96);
    expect(readMetronomeBpm("page 12")).toBeNull();
    expect(readMetronomeBpm("= 300")).toBeNull();
  });

  it("shortens unbeamed quarters to match a voice in the same bar that already fits", () => {
    const voice = (id: string, durations: number[], midis: number[]) => `<part id="${id}"><measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${durations.map((duration, index) => note({ midi: midis[index], duration })).join("")}
    </measure></part>`;
    const xml = partwise(
      [scorePart("P1", "Soprano"), scorePart("P2", "Alto")].join(""),
      [
        voice("P1", [1, 1, 1, 1, 4], [74, 72, 74, 76, 76]),
        voice("P2", [2, 2, 2, 2, 4], [69, 67, 69, 71, 71]),
      ].join(""),
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    const alto = project.notes.filter((item) => item.trackId === "alto");
    expect(alto.map((item) => item.durationBeats)).toEqual([0.5, 0.5, 0.5, 0.5, 2]);
    expect(alto.map((item) => item.midi)).toEqual([69, 67, 69, 71, 71]);
  });

  it("halves a run of quarters when that is the only way the bar adds up", () => {
    const xml = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${[74, 72, 74, 76].map((midi) => note({ midi, duration: 2 })).join("")}
        ${note({ midi: 76, duration: 4 })}
      </measure></part>`,
    );
    const project = projectFromMusicXml(xml, { fromOmr: true });
    expect(project.notes.map((item) => item.durationBeats)).toEqual([0.5, 0.5, 0.5, 0.5, 2]);
    expect(project.warnings.some((warning) => warning.includes("缩短"))).toBe(true);
  });

  it("does not merge a tie whose pitches differ, whose lyric is a new syllable, or that glues a whole bar to a long note", () => {
    const differentPitch = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 2, tie: "start" })}
        ${note({ midi: 74, duration: 2, tie: "stop" })}
      </measure></part>`,
    );
    expect(parseMusicXml(differentPitch, { lockToMeter: true }).parts[0].notes).toHaveLength(2);

    const newSyllable = partwise(
      scorePart("P1", "Soprano"),
      `<part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        ${note({ midi: 72, duration: 2, tie: "start", lyric: "在" })}
        ${note({ midi: 72, duration: 2, tie: "stop", lyric: "心" })}
      </measure></part>`,
    );
    const syllables = parseMusicXml(newSyllable, { lockToMeter: true }).parts[0].notes;
    expect(syllables).toHaveLength(2);
    expect(syllables.map((item) => item.lyric)).toEqual(["在", "心"]);

    const slur = partwise(
      scorePart("P1", "Bass"),
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          ${note({ midi: 55, duration: 4, tie: "start" })}
        </measure>
        <measure number="2">
          ${note({ midi: 55, duration: 3, tie: "stop" })}
          ${note({ rest: true, duration: 1 })}
        </measure>
      </part>`,
    );
    const held = parseMusicXml(slur, { lockToMeter: true }).parts[0].notes;
    expect(held.map((item) => item.durationBeats)).toEqual([4, 3]);
  });
});
