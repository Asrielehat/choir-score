export type Role =
  | "soprano"
  | "alto"
  | "tenor"
  | "bass"
  | "piano-rh"
  | "piano-lh";

export type Layer = "upper" | "lower" | "all";

export interface TempoPoint {
  beat: number;
  bpm: number;
}

export interface MeterPoint {
  beat: number;
  beats: number;
  beatType: number;
}

export interface KeyPoint {
  beat: number;
  fifths: number;
  mode: "major" | "minor";
}

/** A bar on the continuous timeline. Pickup bars may be shorter than the time signature. */
export interface MeasureSpan {
  index: number;
  startBeat: number;
  lengthBeats: number;
  beats: number;
  beatType: number;
}

export interface NoteEvent {
  id: string;
  trackId: string;
  streamId: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  lyric?: string;
}

export interface Track {
  id: string;
  role: Role;
  name: string;
  nameZh: string;
  color: string;
  muted: boolean;
  solo: boolean;
  /** Linear gain, 0–1. */
  volume: number;
}

export interface StreamInfo {
  id: string;
  partId: string;
  partName: string;
  staff: number;
  /** 0 when the stream is the whole staff (piano or a single melody). */
  voice: number;
  layer: Layer;
  role: Role;
  reasonZh: string;
  reasonEn: string;
}

export interface ScoreProject {
  title: string;
  sourceName?: string;
  tracks: Track[];
  notes: NoteEvent[];
  streams: StreamInfo[];
  tempos: TempoPoint[];
  meters: MeterPoint[];
  keys: KeyPoint[];
  measures: MeasureSpan[];
  warnings: string[];
}

export interface RoleMeta {
  name: string;
  nameZh: string;
  short: string;
  shortZh: string;
  color: string;
}

export const ROLE_ORDER: Role[] = [
  "soprano",
  "alto",
  "tenor",
  "bass",
  "piano-rh",
  "piano-lh",
];

export const ROLE_META: Record<Role, RoleMeta> = {
  soprano: {
    name: "Soprano",
    nameZh: "女高音",
    short: "S",
    shortZh: "S",
    color: "#ff7b72",
  },
  alto: {
    name: "Alto",
    nameZh: "女低音",
    short: "A",
    shortZh: "A",
    color: "#f0c14a",
  },
  tenor: {
    name: "Tenor",
    nameZh: "男高音",
    short: "T",
    shortZh: "T",
    color: "#3ecfb2",
  },
  bass: {
    name: "Bass",
    nameZh: "男低音",
    short: "B",
    shortZh: "B",
    color: "#7aa2ff",
  },
  "piano-rh": {
    name: "Piano RH",
    nameZh: "钢琴右手",
    short: "RH",
    shortZh: "右",
    color: "#d2c4ff",
  },
  "piano-lh": {
    name: "Piano LH",
    nameZh: "钢琴左手",
    short: "LH",
    shortZh: "左",
    color: "#8d7cc2",
  },
};

export function makeTrack(role: Role): Track {
  const meta = ROLE_META[role];
  return {
    id: role,
    role,
    name: meta.name,
    nameZh: meta.nameZh,
    color: meta.color,
    muted: false,
    solo: false,
    volume: role === "piano-rh" || role === "piano-lh" ? 0.72 : 0.88,
  };
}

export function isRole(value: string): value is Role {
  return (ROLE_ORDER as string[]).includes(value);
}
