import type { ScoreProject, Track } from "./types";

export function isAudible(track: Track, tracks: Track[]): boolean {
  if (track.muted) return false;
  if (tracks.some((item) => item.solo) && !track.solo) return false;
  return true;
}

/** Track ids that are currently heard. Anything else is drawn faded and cannot be selected. */
export function audibleTrackIds(project: Pick<ScoreProject, "tracks">): Set<string> {
  return new Set(project.tracks.filter((track) => isAudible(track, project.tracks)).map((track) => track.id));
}

/** Drop ids that belong to a muted or non-soloed track, so a hidden note can never stay selected. */
export function keepAudibleSelection(project: Pick<ScoreProject, "notes" | "tracks">, ids: string[]): string[] {
  if (!ids.length) return ids;
  const audible = audibleTrackIds(project);
  const allowed = new Set(project.notes.filter((note) => audible.has(note.trackId)).map((note) => note.id));
  let dropped = false;
  const kept = ids.filter((id) => {
    const keep = allowed.has(id);
    if (!keep) dropped = true;
    return keep;
  });
  return dropped ? kept : ids;
}
