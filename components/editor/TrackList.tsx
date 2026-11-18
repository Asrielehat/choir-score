"use client";

import { pitchRangeLabel } from "@/lib/pitch";
import { useEditor, type Locale } from "@/lib/store";
import { isAudible } from "@/lib/tracks";
import { ROLE_META } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

function tr(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

export function TrackList() {
  const project = useEditor((s) => s.project);
  const locale = useEditor((s) => s.locale);
  const selection = useEditor((s) => s.selection);
  if (!project) return null;

  return (
    <div className="flex gap-2 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
      {project.tracks.map((track) => {
        const meta = ROLE_META[track.role];
        const notes = project.notes.filter((note) => note.trackId === track.id);
        const audible = isAudible(track, project.tracks);
        const selectedHere = notes.length > 0 && notes.every((note) => selection.includes(note.id));
        return (
          <section
            key={track.id}
            className={cn(
              "min-w-[220px] rounded-lg border bg-[#141821] p-2.5 md:min-w-0",
              audible ? "border-[#2e3342]" : "border-[#2e3342] opacity-60",
              selectedHere && "ring-1 ring-[#d7a15e]",
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={(event) => useEditor.getState().selectTrack(track.id, event.shiftKey)}
            >
              <span className="h-8 w-1.5 rounded-full" style={{ background: track.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {locale === "zh" ? meta.nameZh : meta.name}
                  <span className="ml-1.5 text-xs text-[#9c968a]">{locale === "zh" ? meta.name : meta.nameZh}</span>
                </span>
                <span className="block text-[11px] text-[#9c968a]">
                  {notes.length
                    ? `${notes.length} · ${pitchRangeLabel(notes.map((note) => note.midi))}`
                    : tr(locale, "空轨", "empty")}
                </span>
              </span>
            </button>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={track.muted}
                className={cn(
                  "h-8 min-w-8 rounded-md px-2 text-xs font-semibold",
                  track.muted ? "bg-[#ef6f6c] text-[#1a0d0d]" : "bg-[#262b38] text-[#f3efe6]",
                )}
                onClick={() => useEditor.getState().toggleMute(track.id)}
              >
                M
              </button>
              <button
                type="button"
                aria-pressed={track.solo}
                title={tr(locale, "单击独奏这一轨，Shift 加选", "Solo this track. Shift-click to add.")}
                className={cn(
                  "h-8 min-w-8 rounded-md px-2 text-xs font-semibold",
                  track.solo ? "bg-[#d7a15e] text-[#1a1208]" : "bg-[#262b38] text-[#f3efe6]",
                )}
                onClick={(event) => useEditor.getState().solo(track.id, event.shiftKey)}
              >
                S
              </button>
              <Slider
                className="ml-1"
                min={0}
                max={100}
                step={1}
                value={[Math.round(track.volume * 100)]}
                aria-label={tr(locale, `${meta.nameZh}音量`, `${meta.name} volume`)}
                onValueChange={([value]) => useEditor.getState().setVolume(track.id, value / 100)}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
