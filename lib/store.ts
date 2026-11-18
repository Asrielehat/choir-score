import { create } from "zustand";
import { engine } from "./audio";
import { STORAGE_KEY, normalizeProject, serializeProject } from "./project";
import { applyStreamRoles, moveNotesToRole } from "./separate";
import { isAudible } from "./tracks";
import { snapBeat } from "./timing";
import type { NoteEvent, Role, ScoreProject, StreamInfo } from "./types";

export type Locale = "zh" | "en";

interface Hist {
  notes: NoteEvent[];
  streams: StreamInfo[];
}

interface EditorState {
  project: ScoreProject | null;
  selection: string[];
  locale: Locale;
  snap: boolean;
  snapBeats: number;
  tempoScale: number;
  zoomX: number;
  zoomY: number;
  scrollX: number;
  scrollY: number;
  follow: boolean;
  playing: boolean;
  displayBeat: number;
  past: string[];
  future: string[];
  error: string | null;
  busy: boolean;
  setLocale: (locale: Locale) => void;
  setProject: (project: ScoreProject) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  setSnap: (snap: boolean) => void;
  setSnapBeats: (beats: number) => void;
  setTempoScale: (scale: number) => void;
  setZoom: (zoomX: number, zoomY?: number) => void;
  setScroll: (scrollX: number, scrollY: number) => void;
  setFollow: (follow: boolean) => void;
  setSelection: (ids: string[]) => void;
  selectTrack: (trackId: string, add: boolean) => void;
  updateNotes: (notes: NoteEvent[], record: boolean) => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  nudge: (beats: number, semitones: number) => void;
  toggleMute: (id: string) => void;
  solo: (id: string, additive: boolean) => void;
  setVolume: (id: string, volume: number) => void;
  reassignStreams: (updates: Record<string, Role>) => void;
  moveSelection: (role: Role) => void;
  setTitle: (title: string) => void;
  markTransport: (beat: number, playing: boolean) => void;
}

function snapshot(project: ScoreProject): string {
  return JSON.stringify({ notes: project.notes, streams: project.streams } satisfies Hist);
}

function pushHistory(past: string[], project: ScoreProject): string[] {
  return [...past, snapshot(project)].slice(-80);
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selection: [],
  locale: "zh",
  snap: true,
  snapBeats: 0.25,
  tempoScale: 1,
  zoomX: 64,
  zoomY: 13,
  scrollX: 0,
  scrollY: 200,
  follow: true,
  playing: false,
  displayBeat: 0,
  past: [],
  future: [],
  error: null,
  busy: false,
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem("choir-roll.locale", locale);
    } catch {
      /* ignore */
    }
  },
  setProject: (project) => {
    engine.stop();
    const normalized = normalizeProject(project);
    set({
      project: normalized,
      selection: [],
      past: [],
      future: [],
      error: null,
      playing: false,
      displayBeat: 0,
    });
    engine.setMix(normalized.tracks);
  },
  setError: (error) => set({ error }),
  setBusy: (busy) => set({ busy }),
  setSnap: (snap) => set({ snap }),
  setSnapBeats: (snapBeats) => set({ snapBeats }),
  setTempoScale: (tempoScale) => set({ tempoScale: Math.min(2, Math.max(0.5, tempoScale)) }),
  setZoom: (zoomX, zoomY) =>
    set({
      zoomX: Math.min(280, Math.max(18, zoomX)),
      zoomY: zoomY == null ? get().zoomY : Math.min(28, Math.max(8, zoomY)),
    }),
  setScroll: (scrollX, scrollY) => set({ scrollX: Math.max(0, scrollX), scrollY: Math.max(0, scrollY) }),
  setFollow: (follow) => set({ follow }),
  setSelection: (selection) => set({ selection }),
  selectTrack: (trackId, add) => {
    const project = get().project;
    if (!project) return;
    const ids = project.notes.filter((note) => note.trackId === trackId).map((note) => note.id);
    set({ selection: add ? [...new Set([...get().selection, ...ids])] : ids });
  },
  updateNotes: (notes, record) => {
    const project = get().project;
    if (!project) return;
    if (record && JSON.stringify(project.notes) === JSON.stringify(notes)) return;
    set({
      project: { ...project, notes },
      past: record ? pushHistory(get().past, project) : get().past,
      future: record ? [] : get().future,
    });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!project || !past.length) return;
    const prev = JSON.parse(past[past.length - 1]) as Hist;
    set({
      past: past.slice(0, -1),
      future: [...future, snapshot(project)],
      project: { ...project, notes: prev.notes, streams: prev.streams },
      selection: get().selection.filter((id) => prev.notes.some((note) => note.id === id)),
    });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!project || !future.length) return;
    const next = JSON.parse(future[future.length - 1]) as Hist;
    set({
      future: future.slice(0, -1),
      past: [...past, snapshot(project)],
      project: { ...project, notes: next.notes, streams: next.streams },
      selection: get().selection.filter((id) => next.notes.some((note) => note.id === id)),
    });
  },
  deleteSelection: () => {
    const project = get().project;
    if (!project || !get().selection.length) return;
    const drop = new Set(get().selection);
    get().updateNotes(
      project.notes.filter((note) => !drop.has(note.id)),
      true,
    );
    set({ selection: [] });
  },
  nudge: (beats, semitones) => {
    const { project, selection, snap, snapBeats } = get();
    if (!project || !selection.length) return;
    const selected = new Set(selection);
    const moving = project.notes.filter((note) => selected.has(note.id));
    if (!moving.length) return;
    let delta = beats;
    if (snap && beats !== 0) {
      const anchor = moving[0];
      delta = snapBeat(anchor.startBeat + beats, snapBeats, true) - anchor.startBeat;
    }
    const minStart = Math.min(...moving.map((note) => note.startBeat));
    if (minStart + delta < 0) delta = -minStart;
    get().updateNotes(
      project.notes.map((note) => {
        if (!selected.has(note.id)) return note;
        return {
          ...note,
          startBeat: Math.max(0, note.startBeat + delta),
          midi: Math.max(0, Math.min(127, note.midi + semitones)),
        };
      }),
      true,
    );
  },
  toggleMute: (id) => {
    const project = get().project;
    if (!project) return;
    const tracks = project.tracks.map((track) => (track.id === id ? { ...track, muted: !track.muted } : track));
    set({ project: { ...project, tracks } });
    engine.setMix(tracks);
  },
  solo: (id, additive) => {
    const project = get().project;
    if (!project) return;
    const tracks = project.tracks.map((track) => {
      if (additive) return track.id === id ? { ...track, solo: !track.solo } : track;
      if (track.id !== id) return { ...track, solo: false };
      const onlyThis = track.solo && project.tracks.every((item) => item.id === id || !item.solo);
      return { ...track, solo: !onlyThis };
    });
    set({ project: { ...project, tracks } });
    engine.setMix(tracks);
  },
  setVolume: (id, volume) => {
    const project = get().project;
    if (!project) return;
    const tracks = project.tracks.map((track) =>
      track.id === id ? { ...track, volume: Math.max(0, Math.min(1, volume)) } : track,
    );
    set({ project: { ...project, tracks } });
    engine.setMix(tracks);
  },
  reassignStreams: (updates) => {
    const project = get().project;
    if (!project) return;
    const next = applyStreamRoles(project, updates);
    set({
      project: next,
      past: pushHistory(get().past, project),
      future: [],
    });
  },
  moveSelection: (role) => {
    const project = get().project;
    if (!project || !get().selection.length) return;
    const next = moveNotesToRole(project, get().selection, role);
    set({
      project: next,
      past: pushHistory(get().past, project),
      future: [],
    });
  },
  setTitle: (title) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, title } });
  },
  markTransport: (displayBeat, playing) => set({ displayBeat, playing }),
}));

export function persistSoon(project: ScoreProject) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
  } catch {
    /* private mode or quota */
  }
}

export function audibleTrackIds(project: ScoreProject): Set<string> {
  return new Set(project.tracks.filter((track) => isAudible(track, project.tracks)).map((track) => track.id));
}
