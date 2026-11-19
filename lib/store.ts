import { create } from "zustand";
import { engine } from "./audio";
import type { OmrStatus } from "./omr";
import { STORAGE_KEY, normalizeProject, serializeProject } from "./project";
import { applyStreamRoles, moveNotesToRole } from "./separate";
import { audibleTrackIds, isAudible, keepAudibleSelection } from "./tracks";
import { snapBeat } from "./timing";
import type { NoteEvent, Role, ScoreProject, StreamInfo } from "./types";

export type Locale = "zh" | "en";

interface Hist {
  notes: NoteEvent[];
  streams: StreamInfo[];
}

let noteSerial = 0;

function newNoteId(): string {
  noteSerial += 1;
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `u${random.slice(0, 8)}` : `u${Date.now().toString(36)}${noteSerial}`;
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
  /** Track that new notes are drawn into, and the one the pencil follows. */
  activeTrack: Role;
  /** Bumped whenever a whole project is replaced, so the roll knows to re-frame the view. */
  loadToken: number;
  past: string[];
  future: string[];
  error: string | null;
  busy: boolean;
  busyLabel: string;
  busySince: number;
  omrStatus: OmrStatus | null;
  setLocale: (locale: Locale) => void;
  setProject: (project: ScoreProject) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean, label?: string) => void;
  setOmrStatus: (status: OmrStatus | null) => void;
  setSnap: (snap: boolean) => void;
  setSnapBeats: (beats: number) => void;
  setTempoScale: (scale: number) => void;
  setZoom: (zoomX: number, zoomY?: number) => void;
  setScroll: (scrollX: number, scrollY: number) => void;
  setFollow: (follow: boolean) => void;
  setSelection: (ids: string[]) => void;
  setActiveTrack: (role: Role) => void;
  selectTrack: (trackId: string, add: boolean) => void;
  addNote: (input: { trackId: Role; midi: number; startBeat: number; durationBeats: number }) => string | null;
  deleteNotes: (ids: string[]) => void;
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

function firstAudibleTrack(project: ScoreProject): Role {
  const audible = audibleTrackIds(project);
  const withNotes = project.tracks.find((track) => audible.has(track.id) && project.notes.some((note) => note.trackId === track.id));
  const track = withNotes ?? project.tracks.find((item) => audible.has(item.id)) ?? project.tracks[0];
  return (track?.role ?? "soprano") as Role;
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
  activeTrack: "soprano",
  loadToken: 0,
  past: [],
  future: [],
  error: null,
  busy: false,
  busyLabel: "",
  busySince: 0,
  omrStatus: null,
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
      activeTrack: firstAudibleTrack(normalized),
      loadToken: get().loadToken + 1,
      past: [],
      future: [],
      error: null,
      playing: false,
      displayBeat: 0,
    });
    engine.setMix(normalized.tracks);
  },
  setError: (error) => set({ error }),
  setBusy: (busy, label = "") => set({ busy, busyLabel: busy ? label : "", busySince: busy ? Date.now() : 0 }),
  setOmrStatus: (omrStatus) => set({ omrStatus }),
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
  setSelection: (ids) => {
    const project = get().project;
    set({ selection: project ? keepAudibleSelection(project, ids) : [] });
  },
  setActiveTrack: (role) => set({ activeTrack: role }),
  selectTrack: (trackId, add) => {
    const project = get().project;
    if (!project) return;
    const track = project.tracks.find((item) => item.id === trackId);
    if (track) set({ activeTrack: track.role });
    // A muted track has nothing you can edit, so it does not take the selection.
    if (!track || !isAudible(track, project.tracks)) return;
    const ids = project.notes.filter((note) => note.trackId === trackId).map((note) => note.id);
    set({ selection: add ? [...new Set([...get().selection, ...ids])] : ids });
  },
  addNote: ({ trackId, midi, startBeat, durationBeats }) => {
    const project = get().project;
    if (!project) return null;
    const track = project.tracks.find((item) => item.id === trackId);
    // A muted (or soloed-away) part cannot be edited: its notes are dimmed and unselectable,
    // so silently dropping a new note into it would be invisible.
    if (!track || !isAudible(track, project.tracks)) {
      set({ error: get().locale === "zh" ? "这条声部正在静音，先取消静音再添加音块。" : "This part is muted. Unmute it before adding notes." });
      return null;
    }
    const note: NoteEvent = {
      id: newNoteId(),
      trackId,
      streamId: `manual:${trackId}`,
      midi: Math.max(0, Math.min(127, Math.round(midi))),
      startBeat: Math.max(0, Math.round(startBeat * 1e6) / 1e6),
      durationBeats: Math.max(1 / 32, Math.round(durationBeats * 1e6) / 1e6),
      velocity: 92,
    };
    const notes = [...project.notes, note].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
    set({ activeTrack: trackId });
    get().updateNotes(notes, true);
    // setSelection drops the id again when the target track is muted, which is the
    // same rule the roll uses for clicking: a dimmed note cannot be picked.
    get().setSelection([note.id]);
    return note.id;
  },
  deleteNotes: (ids) => {
    const project = get().project;
    if (!project || !ids.length) return;
    const drop = new Set(ids);
    if (!project.notes.some((note) => drop.has(note.id))) return;
    get().updateNotes(
      project.notes.filter((note) => !drop.has(note.id)),
      true,
    );
    set({ selection: get().selection.filter((id) => !drop.has(id)) });
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
    const next = { ...project, notes: prev.notes, streams: prev.streams };
    set({
      past: past.slice(0, -1),
      future: [...future, snapshot(project)],
      project: next,
      selection: keepAudibleSelection(next, get().selection),
    });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!project || !future.length) return;
    const nextNotes = JSON.parse(future[future.length - 1]) as Hist;
    const next = { ...project, notes: nextNotes.notes, streams: nextNotes.streams };
    set({
      future: future.slice(0, -1),
      past: [...past, snapshot(project)],
      project: next,
      selection: keepAudibleSelection(next, get().selection),
    });
  },
  deleteSelection: () => {
    if (!get().selection.length) return;
    get().deleteNotes(get().selection);
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
    const next = { ...project, tracks };
    set({ project: next, selection: keepAudibleSelection(next, get().selection) });
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
    const next = { ...project, tracks };
    set({ project: next, selection: keepAudibleSelection(next, get().selection) });
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

/** Remember the chosen language before the first paint settles. */
export function hydrateLocale() {
  try {
    const stored = localStorage.getItem("choir-roll.locale");
    if (stored === "zh" || stored === "en") useEditor.setState({ locale: stored });
  } catch {
    /* ignore */
  }
}
