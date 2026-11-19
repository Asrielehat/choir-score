import type { RawNote, RawScore } from "./musicxml/parse";
import { buildMeasures } from "./timing";
import { OPTIONAL_ROLES, ROLE_META, ROLE_ORDER, type NoteEvent, type Role, type ScoreProject } from "./types";

const PPQ_OUT = 480;

function textOf(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes).replace(/\0/g, "").trim();
}

function readVLQ(data: Uint8Array, index: number): [number, number] {
  let value = 0;
  let i = index;
  let guard = 0;
  while (i < data.length && guard++ < 5) {
    const byte = data[i++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, i];
  }
  throw new Error("MIDI 时值损坏。");
}

function u16(data: Uint8Array, index: number): number {
  return (data[index] << 8) | data[index + 1];
}

function u32(data: Uint8Array, index: number): number {
  return ((data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3]) >>> 0;
}

interface MidiNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  channel: number;
}

interface MidiTrackData {
  name: string;
  program?: number;
  notes: MidiNote[];
}

export function parseMidi(data: Uint8Array): RawScore {
  if (data.length < 14 || textOf(data.slice(0, 4)) !== "MThd") {
    throw new Error("不是 MIDI 文件。");
  }
  const headerLen = u32(data, 4);
  const format = u16(data, 8);
  const ntrks = u16(data, 10);
  const division = u16(data, 12);
  if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间码的 MIDI。");
  const ppq = division || 480;
  let offset = 8 + headerLen;
  const tracks: MidiTrackData[] = [];
  const tempos: { beat: number; bpm: number }[] = [];
  const meters: { beat: number; beats: number; beatType: number }[] = [];
  let title = "";

  for (let t = 0; t < ntrks && offset + 8 <= data.length; t++) {
    if (textOf(data.slice(offset, offset + 4)) !== "MTrk") break;
    const length = u32(data, offset + 4);
    const end = Math.min(data.length, offset + 8 + length);
    offset += 8;
    const pending = new Map<string, { tick: number; vel: number }[]>();
    const notes: MidiNote[] = [];
    let tick = 0;
    let status = 0;
    let name = "";
    let program: number | undefined;
    const finish = (channel: number, midi: number, tickOff: number) => {
      const key = `${channel}:${midi}`;
      const stack = pending.get(key);
      const on = stack?.shift();
      if (!on) return;
      const dur = (tickOff - on.tick) / ppq;
      // Channel 10 (index 9) is percussion. A click or drum track there is not a sung
      // or played note, and rendering it as piano is what makes playback sound like a metronome.
      if (dur > 1 / 480 && channel !== 9) {
        notes.push({
          midi,
          startBeat: on.tick / ppq,
          durationBeats: dur,
          velocity: on.vel,
          channel,
        });
      }
    };

    while (offset < end) {
      const [delta, next] = readVLQ(data, offset);
      offset = next;
      tick += delta;
      if (offset >= end) break;
      const byte = data[offset];
      if (byte === 0xff) {
        const type = data[offset + 1];
        const [len, dataAt] = readVLQ(data, offset + 2);
        const payload = data.slice(dataAt, dataAt + len);
        offset = dataAt + len;
        if (type === 0x2f) break;
        if (type === 0x03 || type === 0x01) {
          const value = textOf(payload);
          if (type === 0x03 && value) name = value;
          if (!title && value && t === 0) title = value;
        } else if (type === 0x51 && payload.length >= 3) {
          const us = (payload[0] << 16) | (payload[1] << 8) | payload[2];
          if (us > 0) tempos.push({ beat: tick / ppq, bpm: 60_000_000 / us });
        } else if (type === 0x58 && payload.length >= 2) {
          const beats = payload[0];
          const beatType = 2 ** payload[1];
          if (beats > 0 && beatType > 0) meters.push({ beat: tick / ppq, beats, beatType });
        }
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        const [len, dataAt] = readVLQ(data, offset + 1);
        offset = dataAt + len;
        continue;
      }
      if (byte & 0x80) {
        status = byte;
        offset++;
      }
      const command = status & 0xf0;
      const channel = status & 0x0f;
      if (command === 0x80 || command === 0x90 || command === 0xa0 || command === 0xb0 || command === 0xe0) {
        const d1 = data[offset++] ?? 0;
        const d2 = data[offset++] ?? 0;
        if (command === 0x90 && d2 > 0) {
          const key = `${channel}:${d1}`;
          const stack = pending.get(key) ?? [];
          stack.push({ tick, vel: d2 });
          pending.set(key, stack);
        } else if (command === 0x80 || command === 0x90) {
          finish(channel, d1, tick);
        }
      } else if (command === 0xc0 || command === 0xd0) {
        const d1 = data[offset++] ?? 0;
        if (command === 0xc0) program = d1;
      } else {
        break;
      }
    }
    for (const [key, stack] of pending) {
      const [channelText, midiText] = key.split(":");
      if (Number(channelText) === 9) continue; // percussion
      for (const on of stack) {
        notes.push({
          midi: Number(midiText),
          startBeat: on.tick / ppq,
          durationBeats: Math.max(1 / 8, (tick - on.tick) / ppq),
          velocity: on.vel,
          channel: Number(channelText),
        });
      }
    }
    if (notes.length) tracks.push({ name: name || `Track ${t + 1}`, program, notes });
    offset = end;
  }

  if (format === 0 && tracks.length === 1) {
    const byChannel = new Map<number, MidiNote[]>();
    for (const note of tracks[0].notes) {
      const arr = byChannel.get(note.channel) ?? [];
      arr.push(note);
      byChannel.set(note.channel, arr);
    }
    if (byChannel.size > 1) {
      const split: MidiTrackData[] = [];
      for (const [channel, notes] of byChannel) {
        split.push({
          name: `${tracks[0].name} ch${channel + 1}`,
          program: tracks[0].program,
          notes,
        });
      }
      tracks.splice(0, tracks.length, ...split);
    }
  } else {
    const expanded: MidiTrackData[] = [];
    for (const track of tracks) {
      const channels = new Set(track.notes.map((n) => n.channel));
      if (channels.size <= 1) {
        expanded.push(track);
        continue;
      }
      for (const channel of channels) {
        expanded.push({
          name: `${track.name} ch${channel + 1}`,
          program: track.program,
          notes: track.notes.filter((n) => n.channel === channel),
        });
      }
    }
    tracks.splice(0, tracks.length, ...expanded);
  }

  const meterPoints = meters.length ? dedupeByBeat(meters) : [{ beat: 0, beats: 4, beatType: 4 }];
  const endBeat = tracks.reduce((max, track) => {
    for (const note of track.notes) max = Math.max(max, note.startBeat + note.durationBeats);
    return max;
  }, 0);
  const measures = buildMeasures(meterPoints, Math.max(endBeat, measureLength(meterPoints[0])));
  const measureIndexAt = (beat: number) => {
    for (let i = 0; i < measures.length; i++) {
      if (beat < measures[i].startBeat + measures[i].lengthBeats - 1e-6) return i;
    }
    return Math.max(0, measures.length - 1);
  };

  return {
    title: title || tracks.find((track) => track.name)?.name || "MIDI",
    tempos: dedupeByBeat(tempos.length ? tempos : [{ beat: 0, bpm: 120 }]),
    meters: meterPoints,
    keys: [{ beat: 0, fifths: 0, mode: "major" }],
    measures,
    warnings: [],
    parts: tracks.map((track, index) => ({
      id: `M${index + 1}`,
      name: track.name,
      abbr: "",
      staves: 1,
      clefs: [],
      midiProgram: track.program == null ? undefined : track.program + 1,
      notes: track.notes.map<RawNote>((note) => ({
        partId: `M${index + 1}`,
        staff: 1,
        voice: 1,
        midi: note.midi,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        velocity: note.velocity,
        measureIndex: measureIndexAt(note.startBeat),
      })),
    })),
  };
}

function measureLength(meter: { beats: number; beatType: number }): number {
  return meter.beats * (4 / meter.beatType);
}

function dedupeByBeat<T extends { beat: number }>(items: T[]): T[] {
  const sorted = items.slice().sort((a, b) => a.beat - b.beat);
  const out: T[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - item.beat) < 1e-4) out[out.length - 1] = item;
    else out.push(item);
  }
  return out;
}

function encodeVLQ(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function bytesOf(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0x7f);
  return out;
}

function chunk(type: string, body: number[]): number[] {
  const head = [...type].map((ch) => ch.charCodeAt(0));
  const len = body.length;
  return [...head, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

function trackFromEvents(events: { tick: number; order: number; data: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let cursor = 0;
  for (const event of events) {
    const tick = Math.max(cursor, event.tick);
    body.push(...encodeVLQ(tick - cursor), ...event.data);
    cursor = tick;
  }
  return chunk("MTrk", body);
}

export function exportMidi(project: ScoreProject): Uint8Array {
  const endBeat = project.notes.reduce((max, note) => Math.max(max, note.startBeat + note.durationBeats), 0);
  const endTick = Math.max(PPQ_OUT, Math.round(endBeat * PPQ_OUT) + PPQ_OUT);
  const tempoEvents: { tick: number; order: number; data: number[] }[] = [];
  const title = ascii(project.title || "Choir Roll");
  tempoEvents.push({ tick: 0, order: 0, data: [0xff, 0x03, ...encodeVLQ(bytesOf(title).length), ...bytesOf(title)] });
  const meters = project.meters.length ? project.meters : [{ beat: 0, beats: 4, beatType: 4 }];
  for (const meter of meters) {
    const dd = Math.max(0, Math.round(Math.log2(meter.beatType || 4)));
    tempoEvents.push({
      tick: Math.round(meter.beat * PPQ_OUT),
      order: 1,
      data: [0xff, 0x58, 0x04, meter.beats & 255, dd & 255, 24, 8],
    });
  }
  const tempos = project.tempos.length ? project.tempos : [{ beat: 0, bpm: 120 }];
  for (const tempo of tempos) {
    const us = Math.max(1, Math.round(60_000_000 / tempo.bpm));
    tempoEvents.push({
      tick: Math.round(tempo.beat * PPQ_OUT),
      order: 2,
      data: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255],
    });
  }
  tempoEvents.push({ tick: endTick, order: 9, data: [0xff, 0x2f, 0x00] });

  const tracks = [trackFromEvents(tempoEvents)];
  [...ROLE_ORDER, ...OPTIONAL_ROLES].forEach((role, index) => {
    const notes = project.notes
      .filter((note) => note.trackId === role)
      .slice()
      .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
    if (!notes.length) return;
    const channel = index;
    const name = `${ROLE_META[role].nameZh} ${ROLE_META[role].name}`;
    const events: { tick: number; order: number; data: number[] }[] = [];
    const nameBytes = bytesOf(ascii(name));
    events.push({ tick: 0, order: 0, data: [0xff, 0x03, ...encodeVLQ(nameBytes.length), ...nameBytes] });
    events.push({ tick: 0, order: 1, data: [0xc0 | channel, 0] });
    const prepared = resolveOverlaps(notes);
    for (const note of prepared) {
      const on = Math.max(0, Math.round(note.startBeat * PPQ_OUT));
      const off = Math.max(on + 1, Math.round((note.startBeat + note.durationBeats) * PPQ_OUT));
      const vel = Math.max(1, Math.min(127, Math.round(note.velocity || 90)));
      events.push({ tick: on, order: 3, data: [0x90 | channel, note.midi & 127, vel] });
      events.push({ tick: off, order: 2, data: [0x80 | channel, note.midi & 127, 0] });
    }
    events.push({ tick: endTick, order: 9, data: [0xff, 0x2f, 0x00] });
    tracks.push(trackFromEvents(events));
  });

  const header = chunk("MThd", [0, 1, 0, tracks.length, (PPQ_OUT >> 8) & 255, PPQ_OUT & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

function resolveOverlaps(notes: NoteEvent[]): NoteEvent[] {
  const byPitch = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const arr = byPitch.get(note.midi) ?? [];
    arr.push({ ...note });
    byPitch.set(note.midi, arr);
  }
  const out: NoteEvent[] = [];
  for (const group of byPitch.values()) {
    group.sort((a, b) => a.startBeat - b.startBeat);
    for (let i = 0; i < group.length; i++) {
      const note = group[i];
      const next = group[i + 1];
      if (next && note.startBeat + note.durationBeats > next.startBeat) {
        note.durationBeats = Math.max(1 / PPQ_OUT, next.startBeat - note.startBeat);
      }
      if (note.durationBeats > 0) out.push(note);
    }
  }
  return out;
}

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim() || "Choir";
}

export function trackNameForRole(role: Role): string {
  return `${ROLE_META[role].nameZh} ${ROLE_META[role].name}`;
}
