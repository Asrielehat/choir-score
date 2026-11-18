import { describe, expect, it } from "vitest";
import { beatToSeconds, buildMeasures, secondsToBeat, snapBeat } from "../lib/timing";

describe("timing", () => {
  it("converts beats through a tempo change without a gap", () => {
    const tempos = [
      { beat: 0, bpm: 60 },
      { beat: 4, bpm: 120 },
    ];
    expect(beatToSeconds(0, tempos)).toBeCloseTo(0);
    expect(beatToSeconds(4, tempos)).toBeCloseTo(4);
    expect(beatToSeconds(6, tempos)).toBeCloseTo(5);
    expect(secondsToBeat(4, tempos)).toBeCloseTo(4);
    expect(secondsToBeat(5, tempos)).toBeCloseTo(6);
  });

  it("builds a continuous barline grid across a meter change", () => {
    const measures = buildMeasures(
      [
        { beat: 0, beats: 4, beatType: 4 },
        { beat: 8, beats: 3, beatType: 4 },
        { beat: 14, beats: 6, beatType: 8 },
      ],
      17,
    );
    expect(measures.map((m) => m.startBeat)).toEqual([0, 4, 8, 11, 14]);
    expect(measures[2].lengthBeats).toBe(3);
    expect(measures[4].lengthBeats).toBe(3);
    expect(measures[4].startBeat + measures[4].lengthBeats).toBe(17);
  });

  it("snaps to a grid and can stay free", () => {
    expect(snapBeat(1.12, 0.25, true)).toBe(1);
    expect(snapBeat(1.13, 0.25, true)).toBe(1.25);
    expect(snapBeat(1.13, 0.25, false)).toBe(1.13);
    expect(snapBeat(-2, 0.25, true)).toBe(0);
  });
});
