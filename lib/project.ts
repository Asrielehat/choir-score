import { exportMidi, parseMidi } from "./midi";
import { exportMusicXml } from "./musicxml/export";
import { parseMusicXml, type ParseOptions } from "./musicxml/parse";
import { extractMxl } from "./mxl";
import { separateScore } from "./separate";
import { projectEndBeat } from "./timing";
import {
  OPTIONAL_ROLES,
  ROLE_ORDER,
  makeTrack,
  type KeyPoint,
  type MeterPoint,
  type NoteEvent,
  type ScoreProject,
  type StreamInfo,
  type Track,
  isRole,
} from "./types";

export interface MusicXmlImportOptions {
  fromOmr?: boolean;
  initialMeter?: { beats: number; beatType: number };
  initialKey?: { fifths: number; mode: "major" | "minor" };
}

export function projectFromMusicXml(xml: string, options?: MusicXmlImportOptions): ScoreProject {
  const parseOptions: ParseOptions = {
    lockToMeter: !!options?.fromOmr,
    initialMeter: options?.initialMeter,
    initialKey: options?.initialKey,
  };
  const project = separateScore(parseMusicXml(xml, parseOptions), { choirLayout: !!options?.fromOmr });
  return options?.fromOmr ? trimTrailingEmptyMeasures(project) : project;
}

/**
 * Recognize each page on its own, then lay them on one timeline.
 * A later page that reprints neither the meter nor the key keeps the previous page's.
 * Trailing empty bars (Audiveris often invents them past the last system) are dropped
 * before the next page is appended, so they don't shove the rest of the piece forward.
 */
export function projectFromOmrPages(xmls: string[], extras?: { bpm?: number | null }): ScoreProject {
  let carryMeter: { beats: number; beatType: number } | undefined;
  let carryKey: { fifths: number; mode: "major" | "minor" } | undefined;
  const pages: ScoreProject[] = [];
  for (const xml of xmls) {
    const hasTime = /<beats>\s*\d+\s*<\/beats>/.test(xml);
    const hasKey = /<fifths>\s*-?\d+\s*<\/fifths>/.test(xml);
    const project = projectFromMusicXml(xml, {
      fromOmr: true,
      initialMeter: hasTime ? undefined : carryMeter,
      initialKey: hasKey ? undefined : carryKey,
    });
    pages.push(project);
    const lastMeter = project.meters[project.meters.length - 1];
    if (lastMeter) carryMeter = { beats: lastMeter.beats, beatType: lastMeter.beatType };
    const lastKey = project.keys[project.keys.length - 1];
    if (lastKey) carryKey = { fifths: lastKey.fifths, mode: lastKey.mode };
  }
  const merged = concatenateProjects(pages);
  const explicit = xmls.some((xml) => /<sound\b[^>]*\btempo\s*=/.test(xml) || /<per-minute>\s*\d/.test(xml));
  if (!explicit && extras?.bpm && extras.bpm >= 36 && extras.bpm <= 240) {
    merged.tempos = [{ beat: 0, bpm: extras.bpm }];
    merged.warnings = [`谱面上的速度记号读成 ♩ = ${extras.bpm}。`, ...merged.warnings];
  }
  return merged;
}

export function trimTrailingEmptyMeasures(project: ScoreProject): ScoreProject {
  if (!project.notes.length || project.measures.length < 2) return project;
  const lastOnset = Math.max(...project.notes.map((note) => note.startBeat));
  const keep = project.measures.filter((measure) => measure.startBeat <= lastOnset + 1e-3);
  if (keep.length === project.measures.length) return project;
  const dropped = project.measures.length - keep.length;
  return {
    ...project,
    measures: keep.map((measure, index) => ({ ...measure, index: index + 1 })),
    warnings: [...project.warnings, `去掉页末 ${dropped} 个没有音符的小节，后面的音乐不因此后移。`],
  };
}

export function concatenateProjects(pages: ScoreProject[]): ScoreProject {
  const usable = pages.filter((page) => page);
  if (!usable.length) throw new Error("没有识别出乐谱。");
  if (usable.length === 1) return usable[0];
  let shift = 0;
  let serial = 0;
  const notes: NoteEvent[] = [];
  const streams: StreamInfo[] = [];
  const measures: ScoreProject["measures"] = [];
  const tempos: ScoreProject["tempos"] = [];
  const meters: MeterPoint[] = [];
  const keys: KeyPoint[] = [];
  const warnings: string[] = [];
  const pageImages: NonNullable<ScoreProject["pages"]> = [];
  usable.forEach((page, pageIndex) => {
    const streamIds = new Map<string, string>();
    for (const stream of page.streams) {
      const id = `${stream.id}@p${pageIndex + 1}`;
      streamIds.set(stream.id, id);
      streams.push({ ...stream, id });
    }
    for (const note of page.notes) {
      notes.push({
        ...note,
        id: `p${pageIndex + 1}-${++serial}`,
        startBeat: note.startBeat + shift,
        streamId: streamIds.get(note.streamId) ?? note.streamId,
      });
    }
    for (const measure of page.measures) {
      measures.push({ ...measure, index: measures.length + 1, startBeat: measure.startBeat + shift });
    }
    for (const tempo of page.tempos) {
      const beat = tempo.beat + shift;
      const last = tempos[tempos.length - 1];
      if (last && last.bpm === tempo.bpm && Math.abs(last.beat - beat) < 1e-3) continue;
      if (last && page.tempos.length === 1 && tempo.bpm === 120 && tempo.beat <= 1e-6) continue;
      tempos.push({ beat, bpm: tempo.bpm });
    }
    for (const meter of page.meters) {
      const beat = meter.beat + shift;
      const last = meters[meters.length - 1];
      if (last && last.beats === meter.beats && last.beatType === meter.beatType) continue;
      meters.push({ beat, beats: meter.beats, beatType: meter.beatType });
    }
    for (const key of page.keys) {
      const beat = key.beat + shift;
      const last = keys[keys.length - 1];
      if (last && last.fifths === key.fifths && last.mode === key.mode) continue;
      keys.push({ beat, fifths: key.fifths, mode: key.mode });
    }
    warnings.push(...page.warnings.map((warning) => `第 ${pageIndex + 1} 页：${warning}`));
    if (page.pages) pageImages.push(...page.pages);
    const end = page.measures.length
      ? page.measures[page.measures.length - 1].startBeat + page.measures[page.measures.length - 1].lengthBeats
      : projectEndBeat(page);
    shift += end;
  });
  const noteTrackIds = new Set(notes.map((note) => note.trackId));
  const tracks = mergeTracks(
    usable.flatMap((page) => page.tracks),
    notes.filter((note) => noteTrackIds.has(note.trackId)),
  );
  const titled = usable.find((page) => page.title && page.title !== "未命名" && page.title !== "Fixture");
  return {
    title: titled?.title || usable[0].title,
    sourceName: usable[0].sourceName,
    tracks,
    notes,
    streams,
    tempos: tempos.length ? tempos : [{ beat: 0, bpm: 120 }],
    meters: meters.length ? meters : [{ beat: 0, beats: 4, beatType: 4 }],
    keys: keys.length ? keys : [{ beat: 0, fifths: 0, mode: "major" }],
    measures,
    warnings,
    pages: pageImages.length ? pageImages : undefined,
  };
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
  const rawNotes = Array.isArray(input.notes) ? input.notes : [];
  const tracks = mergeTracks(Array.isArray(input.tracks) ? input.tracks : [], rawNotes);
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
      ? input.pages.filter((page) => page && typeof page.href === "string" && page.href.startsWith("data:image/")).slice(0, 8)
      : undefined,
  };
}

function mergeTracks(tracks: Track[], notes: NoteEvent[] = []): Track[] {
  const byId = new Map(tracks.filter((track) => track && isRole(track.id)).map((track) => [track.id, track]));
  const roles = [
    ...ROLE_ORDER,
    ...OPTIONAL_ROLES.filter((role) => notes.some((note) => note.trackId === role) || byId.has(role)),
  ];
  return roles.map((role) => {
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
