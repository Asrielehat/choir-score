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
  const activeTrack = useEditor((s) => s.activeTrack);
  if (!project) return null;

  return (
    <div className="flex gap-2 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
      {project.tracks.map((track) => {
        const meta = ROLE_META[track.role];
        const notes = project.notes.filter((note) => note.trackId === track.id);
        const audible = isAudible(track, project.tracks);
        const selectedHere = notes.length > 0 && notes.every((note) => selection.includes(note.id));
        const active = activeTrack === track.role;
        return (
          <section
            key={track.id}
            className={cn(
              "min-w-[220px] rounded-lg border bg-[#141821] p-2.5 md:min-w-0",
              audible ? "border-[#2e3342]" : "border-[#2e3342] opacity-60",
              active && "border-[#d7a15e]/70",
              selectedHere && "ring-1 ring-[#d7a15e]",
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={(event) => useEditor.getState().selectTrack(track.id, event.shiftKey)}
              title={
                audible
                  ? tr(locale, "点这个声部，之后双击卷帘就画在它上面", "Make this the track new notes are drawn into")
                  : tr(locale, "静音轨不参与选择，先取消静音才能改", "A muted track cannot be selected; unmute it first")
              }
            >
              <span className="h-8 w-1.5 rounded-full" style={{ background: track.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {locale === "zh" ? meta.nameZh : meta.name}
                  <span className="ml-1.5 text-xs text-[#9c968a]">{locale === "zh" ? meta.name : meta.nameZh}</span>
                  {active ? (
                    <span className="ml-1.5 rounded bg-[#d7a15e]/20 px-1 text-[9px] tracking-wide text-[#f0d7a8]">
                      {tr(locale, "当前", "active")}
                    </span>
                  ) : null}
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
            {audible ? null : (
              <p className="mt-1.5 text-[10px] leading-4 text-[#8d877c]">
                {tr(locale, "静音中：卷帘上的音块不可选中", "Muted: its notes cannot be selected")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
