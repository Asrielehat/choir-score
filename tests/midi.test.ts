import { describe, expect, it } from "vitest";
import { parseMidi } from "../lib/midi";

const PPQ = 480;

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(id: string, body: number[]): number[] {
  const length = body.length;
  return [
    ...Array.from(id, (char) => char.charCodeAt(0)),
    (length >> 24) & 255,
    (length >> 16) & 255,
    (length >> 8) & 255,
    length & 255,
    ...body,
  ];
}

/** A one-track file with a melodic note on channel 0 and a click on channel 9. */
function midiWithPercussion(): Uint8Array {
  const event = (delta: number, bytes: number[]) => [...vlq(delta), ...bytes];
  const body = [
    ...event(0, [0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74]), // track name "Test"
    ...event(0, [0x90, 60, 96]), // note on, channel 0
    ...event(0, [0x99, 76, 110]), // note on, channel 9 (percussion)
    ...event(PPQ, [0x80, 60, 0]),
    ...event(0, [0x89, 76, 0]),
    ...event(0, [0xff, 0x2f, 0x00]),
  ];
  return new Uint8Array([
    ...chunk("MThd", [0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255]),
    ...chunk("MTrk", body),
  ]);
}

describe("midi import", () => {
  it("drops percussion notes so a click track does not play as piano", () => {
    const score = parseMidi(midiWithPercussion());
    const notes = score.parts.flatMap((part) => part.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(60);
  });
});
