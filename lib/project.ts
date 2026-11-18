import { exportMidi, parseMidi } from "./midi";
import { exportMusicXml } from "./musicxml/export";
import { parseMusicXml, type ParseOptions } from "./musicxml/parse";
import { extractMxl } from "./mxl";
import { separateScore } from "./separate";
import {
  ROLE_ORDER,
  makeTrack,
  type NoteEvent,
  type ScoreProject,
  type StreamInfo,
  type Track,
  isRole,
} from "./types";

export function projectFromMusicXml(xml: string, options?: { fromOmr?: boolean }): ScoreProject {
  const parseOptions: ParseOptions = { lockToMeter: !!options?.fromOmr };
  return separateScore(parseMusicXml(xml, parseOptions), { choirLayout: !!options?.fromOmr });
}

export function projectFromMidi(data: Uint8Array): ScoreProject {
  return separateScore(parseMidi(data));
}

export function projectFromMxl(data: Uint8Array): ScoreProject {
  return projectFromMusicXml(extractMxl(data));
}

export function importScoreBytes(filename: string, data: Uint8Array): ScoreProject {
  const name = filename.toLowerCase();
  const isZip = data.length > 2 && data[0] === 0x50 && data[1] === 0x4b;
  const isMidi = data.length > 4 && data[0] === 0x4d && data[1] === 0x54 && data[2] === 0x68 && data[3] === 0x64;
  if (name.endsWith(".mxl") || (isZip && !name.endsWith(".json"))) {
    const project = projectFromMxl(data);
    project.sourceName = filename;
    return project;
  }
  if (name.endsWith(".mid") || name.endsWith(".midi") || isMidi) {
    const project = projectFromMidi(data);
    project.sourceName = filename;
    return project;
  }
  const text = new TextDecoder().decode(data).replace(/^\uFEFF/, "");
  if (name.endsWith(".json") || text.trimStart().startsWith("{")) {
    const project = deserializeProject(text);
    project.sourceName = project.sourceName || filename;
    return project;
  }
  const project = projectFromMusicXml(text);
  project.sourceName = filename;
  return project;
}

export function serializeProject(project: ScoreProject): string {
  return JSON.stringify({ version: 1, project: normalizeProject(project) }, null, 2);
}

export function deserializeProject(text: string): ScoreProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("工程文件不是合法的 JSON。");
  }
  if (!data || typeof data !== "object") throw new Error("无法识别的工程文件。");
  const record = data as { version?: number; project?: ScoreProject };
  if (record.version !== 1 || !record.project) throw new Error("无法识别的工程文件（需要 version 1）。");
  return normalizeProject(record.project);
}

export function normalizeProject(input: ScoreProject): ScoreProject {
  const tracks = mergeTracks(Array.isArray(input.tracks) ? input.tracks : []);
  const notes = (Array.isArray(input.notes) ? input.notes : [])
    .filter((note): note is NoteEvent => !!note && typeof note.id === "string" && typeof note.midi === "number")
    .map((note) => ({
      ...note,
      trackId: tracks.some((track) => track.id === note.trackId) ? note.trackId : "soprano",
      durationBeats: Math.max(0.05, Number(note.durationBeats) || 0),
      startBeat: Number(note.startBeat) || 0,
      velocity: Math.max(1, Math.min(127, Number(note.velocity) || 90)),
    }));
  const streams = (Array.isArray(input.streams) ? input.streams : []).filter(
    (stream): stream is StreamInfo => !!stream && typeof stream.id === "string" && isRole(stream.role),
  );
  return {
    title: input.title || "未命名",
    sourceName: input.sourceName,
    tracks,
    notes,
    streams,
    tempos: input.tempos?.length ? input.tempos : [{ beat: 0, bpm: 120 }],
    meters: input.meters?.length ? input.meters : [{ beat: 0, beats: 4, beatType: 4 }],
    keys: input.keys?.length ? input.keys : [{ beat: 0, fifths: 0, mode: "major" }],
    measures: Array.isArray(input.measures) ? input.measures : [],
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    pages: Array.isArray(input.pages)
      ? input.pages.filter((page) => page && typeof page.href === "string" && page.href.startsWith("data:image/")).slice(0, 3)
      : undefined,
  };
}

function mergeTracks(tracks: Track[]): Track[] {
  const byId = new Map(tracks.filter((track) => track && isRole(track.id)).map((track) => [track.id, track]));
  return ROLE_ORDER.map((role) => {
    const existing = byId.get(role);
    const base = makeTrack(role);
    if (!existing) return base;
    return {
      ...base,
      muted: !!existing.muted,
      solo: !!existing.solo,
      volume: Math.max(0, Math.min(1, Number(existing.volume ?? base.volume))),
    };
  });
}

export function toMidi(project: ScoreProject): Uint8Array {
  return exportMidi(normalizeProject(project));
}

export function toMusicXml(project: ScoreProject): string {
  return exportMusicXml(normalizeProject(project));
}

export const STORAGE_KEY = "choir-roll.project.v1";
