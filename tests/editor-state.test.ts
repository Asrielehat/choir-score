import { beforeEach, describe, expect, it } from "vitest";
import { hitTestNote } from "../components/editor/geometry";
import { blankProject } from "../lib/project";
import { useEditor } from "../lib/store";
import { rollLength } from "../lib/timing";
import type { NoteEvent } from "../lib/types";

function note(overrides: Partial<NoteEvent> & Pick<NoteEvent, "id" | "trackId">): NoteEvent {
  return {
    streamId: "manual",
    midi: 60,
    startBeat: 0,
    durationBeats: 4,
    velocity: 90,
    ...overrides,
  };
}

describe("editor state", () => {
  beforeEach(() => {
    useEditor.getState().setProject(blankProject("Test"));
  });

  it("starts a blank project with the six standard tracks and no notes", () => {
    const project = useEditor.getState().project!;
    expect(project.notes).toHaveLength(0);
    expect(project.tracks.map((track) => track.role)).toEqual([
      "soprano",
      "alto",
      "tenor",
      "bass",
      "piano-rh",
      "piano-lh",
    ]);
    expect(rollLength(project)).toBe(16);
  });

  it("adds a note into the active track and selects it", () => {
    const store = useEditor.getState();
    store.setActiveTrack("alto");
    const id = useEditor.getState().addNote({ trackId: "alto", midi: 64, startBeat: 2, durationBeats: 0.5 });
    expect(id).toBeTruthy();
    const project = useEditor.getState().project!;
    expect(project.notes).toHaveLength(1);
    expect(project.notes[0].trackId).toBe("alto");
    expect(project.notes[0].midi).toBe(64);
    expect(useEditor.getState().selection).toEqual([id]);
  });

  it("deletes notes that are selected and unselects them", () => {
    const state = useEditor.getState();
    const id = state.addNote({ trackId: "soprano", midi: 60, startBeat: 0, durationBeats: 1 })!;
    useEditor.getState().deleteSelection();
    expect(useEditor.getState().project!.notes).toHaveLength(0);
    expect(useEditor.getState().selection).toEqual([]);
    expect(id).toBeTruthy();
  });

  it("drops notes of a muted track from the selection", () => {
    const state = useEditor.getState();
    const keep = state.addNote({ trackId: "soprano", midi: 60, startBeat: 0, durationBeats: 2 })!;
    const mute = state.addNote({ trackId: "alto", midi: 60, startBeat: 0, durationBeats: 2 })!;
    useEditor.getState().setSelection([keep, mute]);
    expect(useEditor.getState().selection.sort()).toEqual([keep, mute].sort());

    useEditor.getState().toggleMute("alto");
    expect(useEditor.getState().selection).toEqual([keep]);

    // Selecting a muted track does not pull its notes back in.
    useEditor.getState().selectTrack("alto", true);
    expect(useEditor.getState().selection).toEqual([keep]);
  });

  it("cannot select a note on a track silenced by solo", () => {
    const state = useEditor.getState();
    const soprano = state.addNote({ trackId: "soprano", midi: 67, startBeat: 0, durationBeats: 1 })!;
    const alto = state.addNote({ trackId: "alto", midi: 64, startBeat: 0, durationBeats: 1 })!;
    useEditor.getState().solo("soprano", false);
    useEditor.getState().setSelection([soprano, alto]);
    expect(useEditor.getState().selection).toEqual([soprano]);
  });

  it("hit-tests only the audible voice when two parts share the same pitch", () => {
    const soprano = note({ id: "s1", trackId: "soprano" });
    const alto = note({ id: "a1", trackId: "alto" });
    const notes = [soprano, alto];
    const zoomX = 64;
    const zoomY = 13;
    const x = 100;
    const y = 32 + (108 - 60) * zoomY; // row of MIDI 60 with scrollY 0

    const onlySoprano = hitTestNote(x, y, notes, new Set(), zoomX, zoomY, 0, 0, new Set(["soprano"]));
    expect(onlySoprano?.id).toBe("s1");

    const onlyAlto = hitTestNote(x, y, notes, new Set(), zoomX, zoomY, 0, 0, new Set(["alto"]));
    expect(onlyAlto?.id).toBe("a1");

    expect(hitTestNote(x, y, notes, new Set(), zoomX, zoomY, 0, 0, new Set())).toBeNull();
  });

  it("refuses to add a note to a muted track instead of hiding it", () => {
    useEditor.getState().toggleMute("soprano");
    const id = useEditor.getState().addNote({ trackId: "soprano", midi: 60, startBeat: 0, durationBeats: 1 });
    expect(id).toBeNull();
    expect(useEditor.getState().project!.notes).toHaveLength(0);
    expect(useEditor.getState().error).toBeTruthy();
  });

  it("grows the timeline with the last note and never shrinks below one screen", () => {
    const project = useEditor.getState().project!;
    useEditor.getState().addNote({ trackId: "soprano", midi: 60, startBeat: 40, durationBeats: 2 });
    const next = useEditor.getState().project!;
    expect(rollLength(next)).toBe(46);
    expect(rollLength(project)).toBe(16);
  });
});
