import { describe, expect, it } from "vitest";
import { sanitizeLyrics } from "../lib/lyrics";
import { repairOverfullMeasure, type RhythmSlot } from "../lib/rhythm";

function slot(duration: number, pitch?: number, extra: Partial<RhythmSlot> = {}): RhythmSlot {
  return {
    duration,
    rest: pitch == null,
    pitches: pitch == null ? [] : [pitch],
    ...extra,
  };
}

describe("Chinese lyric cleanup", () => {
  it("keeps Han syllables and drops watermark junk on a Chinese page", () => {
    const notes = sanitizeLyrics([
      { lyric: "月" },
      { lyric: "亮，" },
      { lyric: "」营宝" },
      { lyric: "如同" },
      { lyric: "a]" },
    ]);
    expect(notes.map((note) => note.lyric)).toEqual(["月", "亮", undefined, "如同", undefined]);
    const long = sanitizeLyrics([{ lyric: "月" }, { lyric: "声茗茬己" }, { lyric: "如同" }]);
    expect(long.map((note) => note.lyric)).toEqual(["月", undefined, "如同"]);
  });

  it("leaves an English page untouched", () => {
    const notes = sanitizeLyrics([{ lyric: "the" }, { lyric: "a" }, { lyric: "light" }]);
    expect(notes.map((note) => note.lyric)).toEqual(["the", "a", "light"]);
  });
});

describe("measure rhythm repair", () => {
  it("copies durations from the voice in the bar that already fits", () => {
    const soprano = [0.5, 0.5, 0.5, 0.5, 2].map((duration, index) => slot(duration, 72 - index));
    const alto = [1, 1, 1, 1, 2].map((duration, index) => slot(duration, 67 - index));
    const repaired = repairOverfullMeasure(
      [
        { id: "s", slots: soprano },
        { id: "a", slots: alto },
      ],
      4,
      "7",
    );
    expect(repaired.voices[1].slots.map((item) => item.duration)).toEqual([0.5, 0.5, 0.5, 0.5, 2]);
    expect(repaired.voices[1].kind).toBe("sibling");
  });

  it("halves one run of quarters and leaves the following half note", () => {
    const slots = [1, 1, 1, 1, 2].map((duration, index) => slot(duration, 60 + index));
    const repaired = repairOverfullMeasure([{ id: "s", slots }], 4, "3");
    expect(repaired.voices[0].slots.map((item) => item.duration)).toEqual([0.5, 0.5, 0.5, 0.5, 2]);
    expect(repaired.voices[0].kind).toBe("halve");
  });

  it("treats three equal notes as a triplet when halving them would leave the bar short", () => {
    const slots = [2, 2, 2].map((duration, index) => slot(duration, 64 + index));
    const repaired = repairOverfullMeasure([{ id: "s", slots }], 4, "4");
    expect(repaired.voices[0].kind).toBe("triplet");
    repaired.voices[0].slots.forEach((item) => expect(item.duration).toBeCloseTo(4 / 3, 2));
    expect(repaired.voices[0].slots.reduce((total, item) => total + item.duration, 0)).toBeCloseTo(4, 2);
  });

  it("drops one far-away note when removing it fills the bar exactly", () => {
    const slots = [slot(1, 60), slot(1, 84), slot(1, 62), slot(1, 64), slot(1, 65)];
    const repaired = repairOverfullMeasure([{ id: "s", slots }], 4, "2");
    expect(repaired.voices[0].kind).toBe("stray");
    expect(repaired.voices[0].slots.map((item) => item.pitches[0])).toEqual([60, 62, 64, 65]);
  });

  it("keeps every note and compresses the bar when no single repair fits", () => {
    const slots = [1, 1, 1, 1, 1].map((duration, index) => slot(duration, 70 + index));
    const repaired = repairOverfullMeasure([{ id: "s", slots }], 4, "1");
    expect(repaired.voices[0].kind).toBe("compress");
    expect(repaired.voices[0].slots).toHaveLength(5);
    expect(repaired.voices[0].slots.map((item) => item.duration).reduce((total, value) => total + value, 0)).toBeCloseTo(4);
    expect(repaired.warning).toContain("压进拍号");
  });

  it("shortens a rest when a voice enters late and runs past the barline", () => {
    const repaired = repairOverfullMeasure(
      [{ id: "b", entry: 2.5, slots: [slot(1.5), slot(1, 52)] }],
      4,
      "3",
    );
    expect(repaired.voices[0].kind).toBe("rest");
    expect(repaired.voices[0].slots.map((item) => item.duration)).toEqual([0.5, 1]);
  });

  it("drops the one rest that is exactly the overflow", () => {
    const slots = [slot(0.5, 47), slot(0.5, 55), slot(0.5, 55), slot(0.5, 55), slot(0.5), slot(0.5, 45), slot(1.5), slot(1, 52)];
    const repaired = repairOverfullMeasure([{ id: "b", slots }], 4, "3");
    expect(repaired.voices[0].kind).toBe("rest");
    expect(repaired.voices[0].slots.map((item) => item.duration)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]);
  });

  it("does not halve notes that are already beamed", () => {
    const slots = [1, 1, 1, 1].map((duration, index) => slot(duration, 70 + index, { beamed: true }));
    slots.push(slot(2, 74));
    const repaired = repairOverfullMeasure([{ id: "s", slots }], 4, "8");
    expect(repaired.voices[0].kind).toBe("compress");
  });
});
