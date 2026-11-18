import { describe, expect, it } from "vitest";
import { parseMusicXml } from "../lib/musicxml/parse";
import { projectFromMusicXml } from "../lib/project";
import { note, partwise, scorePart } from "./helpers";

describe("OMR post-processing", () => {
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
    expect(soprano.map((item) => item.startBeat)).toEqual([0, 1, 2, 3, 4]);
    expect(soprano[4].midi).toBe(71);
    expect(locked.measures[1].startBeat).toBeCloseTo(4);
    expect(locked.warnings.some((warning) => warning.includes("裁到小节线"))).toBe(true);

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
});
