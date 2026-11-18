import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectFromMusicXml } from "../lib/project";
import { beatToSeconds } from "../lib/timing";

const xml = readFileSync(new URL("../public/samples/chen-guang.musicxml", import.meta.url), "utf8");

describe("晨光 sample", () => {
  const project = projectFromMusicXml(xml);

  it("is a closed SATB score with piano on a continuous timeline", () => {
    expect(project.title).toBe("晨光");
    expect(project.measures.map((m) => m.startBeat)).toEqual([0, 4, 8, 12, 16, 19, 22, 26]);
    expect(project.measures.map((m) => m.lengthBeats)).toEqual([4, 4, 4, 4, 3, 3, 4, 4]);
    expect(project.tempos.map((t) => [t.beat, t.bpm])).toEqual([
      [0, 80],
      [16, 100],
      [22, 80],
    ]);
    expect(beatToSeconds(16, project.tempos)).toBeCloseTo(12);
    expect(beatToSeconds(22, project.tempos)).toBeCloseTo(15.6);
  });

  it("separates shared staves into S A T B and piano hands", () => {
    const of = (role: string) => project.notes.filter((n) => n.trackId === role);
    expect(of("soprano")).toHaveLength(27);
    expect(of("alto")).toHaveLength(26);
    expect(of("tenor")).toHaveLength(27);
    expect(of("bass")).toHaveLength(27);
    expect(of("piano-rh").length).toBeGreaterThan(8);
    expect(of("piano-lh").length).toBeGreaterThan(4);

    expect(of("soprano")[0]).toMatchObject({ midi: 72, startBeat: 0, durationBeats: 1, lyric: "晨" });
    expect(of("alto")[0]).toMatchObject({ midi: 67, startBeat: 0, durationBeats: 2, lyric: "晨" });
    expect(of("tenor")[0]).toMatchObject({ midi: 64, startBeat: 0 });
    expect(of("bass")[0]).toMatchObject({ midi: 48, startBeat: 0 });

    const sopranoAt16 = of("soprano").find((n) => Math.abs(n.startBeat - 16) < 1e-6);
    expect(sopranoAt16).toMatchObject({ midi: 79, lyric: "心" });

    const unison = 25;
    expect(of("soprano").some((n) => n.startBeat === unison && n.midi === 76)).toBe(true);
    expect(of("alto").some((n) => n.startBeat === unison && n.midi === 76)).toBe(true);
    expect(of("tenor").some((n) => n.startBeat === unison && n.midi === 64)).toBe(true);
    expect(of("bass").some((n) => n.startBeat === unison && n.midi === 64)).toBe(true);

    const left = of("piano-lh").slice().sort((a, b) => a.startBeat - b.startBeat);
    expect(left[0]).toMatchObject({ midi: 48, startBeat: 0, durationBeats: 1 });
    expect(left[1].startBeat).toBeCloseTo(2);
    expect(project.notes.some((n) => n.trackId.startsWith("piano") && n.lyric)).toBe(false);
  });
});
