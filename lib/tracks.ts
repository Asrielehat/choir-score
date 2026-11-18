import type { Track } from "./types";

export function isAudible(track: Track, tracks: Track[]): boolean {
  if (track.muted) return false;
  if (tracks.some((item) => item.solo) && !track.solo) return false;
  return true;
}
