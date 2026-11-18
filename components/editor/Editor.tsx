"use client";

import {
  CircleHelp,
  Download,
  FolderOpen,
  Languages,
  Pause,
  Play,
  Redo2,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { engine } from "@/lib/audio";
import type { OmrStatus } from "@/lib/omr";
import { importScoreBytes, projectFromMusicXml, projectFromOmrPages, serializeProject, STORAGE_KEY, deserializeProject, toMidi, toMusicXml } from "@/lib/project";
import { persistSoon, useEditor, type Locale } from "@/lib/store";
import { locateBeat, projectEndBeat } from "@/lib/timing";
import { ALL_ROLES, ROLE_META, type Role } from "@/lib/types";
import { downloadBlob, safeFileStem } from "@/lib/utils";
import { AssignDialog, HelpDialog, OmrDialog } from "./Dialogs";
import { PianoRoll } from "./PianoRoll";
import { TrackList } from "./TrackList";

function tr(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

export function Editor() {
  const project = useEditor((s) => s.project);
  const locale = useEditor((s) => s.locale);
  const error = useEditor((s) => s.error);
  const busy = useEditor((s) => s.busy);
  const selection = useEditor((s) => s.selection);
  const snap = useEditor((s) => s.snap);
  const snapBeats = useEditor((s) => s.snapBeats);
  const tempoScale = useEditor((s) => s.tempoScale);
  const follow = useEditor((s) => s.follow);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [omrOpen, setOmrOpen] = useState(false);
  const [omrStatus, setOmrStatus] = useState<OmrStatus | null>(null);
  const [pdfPage, setPdfPage] = useState("");
  const [busyLabel, setBusyLabel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showPage, setShowPage] = useState(true);

  useEffect(() => {
    const storedLocale = localStorage.getItem("choir-roll.locale");
    if (storedLocale === "zh" || storedLocale === "en") useEditor.getState().setLocale(storedLocale);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        useEditor.getState().setProject(deserializeProject(saved));
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    void loadSample();
  }, []);

  useEffect(() => engine.on((beat, playing) => useEditor.getState().markTransport(beat, playing)), []);

  useEffect(() => {
    let timer = 0;
    return useEditor.subscribe((state, prev) => {
      if (state.project && state.project !== prev.project) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => persistSoon(state.project!), 300);
      }
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      const state = useEditor.getState();
      const key = event.key.toLowerCase();
      if (event.key === " ") {
        event.preventDefault();
        void play(event.shiftKey);
      } else if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if ((event.metaKey || event.ctrlKey) && key === "y") {
        event.preventDefault();
        state.redo();
      } else if ((event.metaKey || event.ctrlKey) && key === "a" && state.project) {
        event.preventDefault();
        state.setSelection(state.project.notes.map((note) => note.id));
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteSelection();
      } else if (event.key === "Escape") {
        state.setSelection([]);
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 1 : state.snap ? state.snapBeats : 0.05;
        const pitch = event.shiftKey ? 12 : 1;
        if (event.key === "ArrowLeft") state.nudge(-step, 0);
        if (event.key === "ArrowRight") state.nudge(step, 0);
        if (event.key === "ArrowUp") state.nudge(0, pitch);
        if (event.key === "ArrowDown") state.nudge(0, -pitch);
      } else if (key === "[") {
        state.setZoom(state.zoomX / 1.15);
      } else if (key === "]") {
        state.setZoom(state.zoomX * 1.15);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    };
    const drop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    };
    const leave = () => setDragging(false);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragleave", leave);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragleave", leave);
    };
    // openFile is recreated each render and only needs the initial listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSample() {
    useEditor.getState().setBusy(true);
    try {
      const response = await fetch("/samples/chen-guang.musicxml");
      if (!response.ok) throw new Error(tr(useEditor.getState().locale, "示例谱没有找到", "Sample score missing"));
      const next = projectFromMusicXml(await response.text());
      next.sourceName = "chen-guang.musicxml";
      useEditor.getState().setProject(next);
    } catch (caught) {
      useEditor.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      useEditor.getState().setBusy(false);
    }
  }

  async function recognize(file: File, page: string | number = pdfPage) {
    useEditor.getState().setBusy(true);
    useEditor.getState().setError(null);
    const everyPage = page === "" || page === "all" || page === 0;
    setBusyLabel(
      tr(
        useEditor.getState().locale,
        everyPage ? "Audiveris 正在逐页读谱，多页会接成一条时间线" : "Audiveris 正在读这一页，通常要一分钟左右",
        everyPage ? "Audiveris is reading every page onto one timeline" : "Audiveris is reading this page, usually about a minute",
      ),
    );
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("page", everyPage ? "all" : String(page));
      const response = await fetch("/api/omr", { method: "POST", body });
      const data = (await response.json()) as OmrStatus & {
        ok?: boolean;
        musicxml?: string;
        musicxmls?: string[];
        metronome?: number | null;
        warnings?: string[];
        pages?: { label: string; href: string }[];
      };
      const xmls = data.musicxmls?.length ? data.musicxmls : data.musicxml ? [data.musicxml] : [];
      if (data.ok && xmls.length) {
        const next = projectFromOmrPages(xmls, { bpm: data.metronome ?? null });
        next.sourceName = file.name;
        next.pages = data.pages ?? [];
        next.warnings = [...(data.warnings ?? []), ...next.warnings];
        useEditor.getState().setProject(next);
        setShowPage(true);
      } else {
        setOmrStatus(data);
        setOmrOpen(true);
      }
    } catch (caught) {
      useEditor.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      window.clearInterval(timer);
      useEditor.getState().setBusy(false);
      setBusyLabel("");
    }
  }

  async function recognizeSample(url: string, name: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(name);
    const blob = await response.blob();
    await recognize(new File([blob], name, { type: blob.type || "image/png" }), 1);
  }

  async function openFile(file: File) {
    useEditor.getState().setBusy(true);
    useEditor.getState().setError(null);
    try {
      if (/\.(pdf|png|jpe?g|tif|tiff)$/i.test(file.name)) {
        useEditor.getState().setBusy(false);
        await recognize(file);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      useEditor.getState().setProject(importScoreBytes(file.name, bytes));
    } catch (caught) {
      useEditor.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      useEditor.getState().setBusy(false);
    }
  }

  async function play(selectionOnly: boolean) {
    const state = useEditor.getState();
    if (!state.project) return;
    if (engine.playing && !selectionOnly) {
      engine.pause();
      return;
    }
    const chosen = state.project.notes.filter((note) => state.selection.includes(note.id));
    if (selectionOnly && !chosen.length) return;
    const from = selectionOnly ? Math.min(...chosen.map((note) => note.startBeat)) : engine.playhead;
    engine.setMix(state.project.tracks);
    await engine.play(state.project, from, state.tempoScale, selectionOnly ? new Set(chosen.map((note) => note.id)) : undefined);
  }

  function exportAs(kind: "mid" | "xml" | "json") {
    const current = useEditor.getState().project;
    if (!current) return;
    const stem = safeFileStem(current.title || "choir");
    if (kind === "mid") {
      const midi = toMidi(current);
      downloadBlob(`${stem}.mid`, new Blob([new Uint8Array(midi)], { type: "audio/midi" }));
    } else if (kind === "xml") {
      downloadBlob(`${stem}.musicxml`, new Blob([toMusicXml(current)], { type: "application/vnd.recordare.musicxml+xml" }));
    } else {
      downloadBlob(`${stem}.choir.json`, new Blob([serializeProject(current)], { type: "application/json" }));
    }
  }

  const bpm = Math.round((project?.tempos[0]?.bpm ?? 120) * tempoScale);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-dvh flex-col bg-[#10131a] text-[#f3efe6]">
        <header className="flex flex-wrap items-center gap-2 border-b border-[#2a2f3c] px-3 py-2">
          <div className="mr-1 flex items-center gap-2">
            <Mark />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-wide">{tr(locale, "合唱分轨", "Choir Roll")}</div>
              <div className="text-[10px] tracking-[0.14em] text-[#d7a15e] uppercase">
                {tr(locale, "SATB 钢琴卷帘", "SATB piano roll")}
              </div>
            </div>
          </div>
          <Input
            aria-label={tr(locale, "曲名", "Title")}
            className="h-8 w-36 sm:w-52"
            value={project?.title ?? ""}
            onChange={(event) => useEditor.getState().setTitle(event.target.value)}
          />
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button variant="muted" size="sm" onClick={() => void loadSample()} disabled={busy}>
              {tr(locale, "示例「晨光」", "Sample")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => void recognizeSample("/samples/omr/abide-with-me.png", "abide-with-me.png").catch((error: unknown) => useEditor.getState().setError(String(error)))}
            >
              {tr(locale, "识别缩谱", "Scan closed")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() =>
                void recognizeSample("/samples/omr/gounod-daughters.png", "gounod-daughters.png").catch((error: unknown) =>
                  useEditor.getState().setError(String(error)),
                )
              }
            >
              {tr(locale, "识别开大谱", "Scan open")}
            </Button>
            <label className="flex items-center gap-1 text-[11px] text-[#9c968a]">
              PDF
              <Input
                aria-label={tr(locale, "PDF 页码，留空表示全部", "PDF page, empty for all")}
                inputMode="numeric"
                placeholder={tr(locale, "全部", "all")}
                value={pdfPage}
                onChange={(event) => setPdfPage(event.target.value.replace(/[^\d]/g, ""))}
                className="h-8 w-14"
              />
            </label>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FolderOpen className="h-3.5 w-3.5" />
              {tr(locale, "导入", "Import")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5" />
                  {tr(locale, "导出", "Export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => exportAs("mid")}>{tr(locale, "MIDI（每声部一轨，钢琴音色）", "MIDI, one piano track per voice")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportAs("xml")}>MusicXML</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportAs("json")}>{tr(locale, "工程 JSON", "Project JSON")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)} disabled={!project?.streams.length}>
              {tr(locale, "声部分配", "Assign")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => useEditor.getState().setLocale(locale === "zh" ? "en" : "zh")} aria-label="Language">
                  <Languages className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{locale === "zh" ? "English" : "中文"}</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label={tr(locale, "帮助", "Help")}>
              <CircleHelp className="h-4 w-4" />
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".musicxml,.xml,.mxl,.mid,.midi,.json,.pdf,.png,.jpg,.jpeg,.tif,.tiff"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void openFile(file);
            }}
          />
        </header>

        {error ? (
          <div className="flex items-center justify-between gap-3 bg-[#3a1d22] px-3 py-2 text-sm text-[#ffd0d0]">
            <span>{error}</span>
            <button type="button" className="underline" onClick={() => useEditor.getState().setError(null)}>
              {tr(locale, "关闭", "Dismiss")}
            </button>
          </div>
        ) : null}
        {project?.warnings.length ? (
          <div className="max-h-24 overflow-auto border-b border-[#3a3424] bg-[#2a2418] px-3 py-1.5 text-xs leading-5 text-[#f0d7a8]">
            {project.warnings.slice(0, 8).map((warning, index) => (
              <div key={`${index}-${warning}`}>{warning}</div>
            ))}
            {project.warnings.length > 8 ? <div>… {project.warnings.length - 8}</div> : null}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="max-h-[34vh] shrink-0 border-b border-[#2a2f3c] md:max-h-none md:w-[280px] md:overflow-y-auto md:border-r md:border-b-0">
            <TrackList />
          </aside>
          <main className="relative flex min-h-0 min-w-0 flex-1">
            <div className="relative min-w-0 flex-1">
              {project ? <PianoRoll /> : <Empty locale={locale} busy={busy} />}
            </div>
            {project?.pages?.length && showPage ? (
              <aside className="hidden w-[300px] shrink-0 overflow-auto border-l border-[#2a2f3c] bg-[#141821] p-2 lg:block">
                <div className="mb-2 flex items-center justify-between text-xs text-[#c7c1b6]">
                  <span>{tr(locale, "原谱对照", "Original page")}</span>
                  <button type="button" className="underline" onClick={() => setShowPage(false)}>
                    {tr(locale, "收起", "Hide")}
                  </button>
                </div>
                {project.pages.map((page) => (
                  <figure key={page.label}>
                    <figcaption className="mb-1 text-[11px] text-[#9c968a]">{page.label}</figcaption>
                    {/* The scan is the thing the user compares against the roll. */}
                    {/* Data URLs from the recognition API; next/image does not optimize those. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={page.href} alt={page.label} className="w-full bg-white" />
                  </figure>
                ))}
              </aside>
            ) : project?.pages?.length ? (
              <button
                type="button"
                className="absolute top-2 right-3 z-10 rounded-md bg-[#1c212c] px-2 py-1 text-xs text-[#f0d7a8]"
                onClick={() => setShowPage(true)}
              >
                {tr(locale, "原谱", "Page")}
              </button>
            ) : null}
            {busy ? (
              <div className="absolute inset-0 z-20 grid place-items-center bg-[#10131a]/80 px-6 text-center">
                <div>
                  <p className="text-lg">{busyLabel || tr(locale, "请稍等", "Working")}</p>
                  <p className="mt-2 text-sm tabular-nums text-[#d7a15e]">{elapsed}s</p>
                </div>
              </div>
            ) : null}
            {dragging ? (
              <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-[#d7a15e] bg-[#10131a]/80 text-sm">
                {tr(locale, "松开即可导入 MusicXML、MXL、MIDI 或工程", "Drop MusicXML, MXL, MIDI, or a project")}
              </div>
            ) : null}
          </main>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-[#2a2f3c] bg-[#161a22] px-3 py-2">
          <Transport onPlay={() => void play(false)} onPlaySelection={() => void play(true)} locale={locale} selectionCount={selection.length} />
          <div className="mx-1 hidden h-6 w-px bg-[#2e3342] sm:block" />
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete" disabled={!selection.length} onClick={() => useEditor.getState().deleteSelection()}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <label className="ml-1 flex items-center gap-2 text-xs text-[#c7c1b6]">
            <Switch checked={snap} onCheckedChange={(value) => useEditor.getState().setSnap(value)} />
            {tr(locale, "吸附", "Snap")}
          </label>
          <div className="flex overflow-hidden rounded-md border border-[#343846]">
            {[
              [1, "1/4"],
              [0.5, "1/8"],
              [0.25, "1/16"],
              [1 / 3, "1/8T"],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                className={`h-8 px-2 text-[11px] ${Math.abs(snapBeats - Number(value)) < 0.001 ? "bg-[#d7a15e] text-[#1a1208]" : "text-[#c7c1b6] hover:bg-white/5"}`}
                onClick={() => useEditor.getState().setSnapBeats(Number(value))}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex w-36 items-center gap-2">
            <span className="w-14 text-xs tabular-nums text-[#f0d7a8]">♩={bpm}</span>
            <Slider
              min={50}
              max={200}
              step={1}
              value={[Math.round(tempoScale * 100)]}
              aria-label={tr(locale, "播放速度", "Playback tempo")}
              onValueChange={([value]) => {
                const scale = value / 100;
                useEditor.getState().setTempoScale(scale);
                if (engine.playing && project) {
                  void engine.play(project, engine.currentBeat(), scale);
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-[#c7c1b6]">
            <Switch checked={follow} onCheckedChange={(value) => useEditor.getState().setFollow(value)} />
            {tr(locale, "跟随", "Follow")}
          </label>
          <div className="ml-auto flex items-center gap-1">
            <Select
              key={selection.join("|") || "none"}
              onValueChange={(role) => {
                if (role) useEditor.getState().moveSelection(role as Role);
              }}
              disabled={!selection.length}
            >
              <SelectTrigger className="h-8 w-40 text-xs" aria-label={tr(locale, "移动选中音符", "Move selected notes")}>
                <SelectValue placeholder={tr(locale, `移动 ${selection.length} 个音符`, `Move ${selection.length}`)} />
              </SelectTrigger>
              <SelectContent>
                {ALL_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {locale === "zh" ? ROLE_META[role].nameZh : ROLE_META[role].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => useEditor.getState().setZoom(useEditor.getState().zoomX / 1.15)}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => useEditor.getState().setZoom(useEditor.getState().zoomX * 1.15)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </div>
      <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} />
      <OmrDialog open={omrOpen} onOpenChange={setOmrOpen} status={omrStatus} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </TooltipProvider>
  );
}

function Transport({
  onPlay,
  onPlaySelection,
  locale,
  selectionCount,
}: {
  onPlay: () => void;
  onPlaySelection: () => void;
  locale: Locale;
  selectionCount: number;
}) {
  const playing = useEditor((s) => s.playing);
  const beat = useEditor((s) => s.displayBeat);
  const project = useEditor((s) => s.project);
  const where = project ? locateBeat(beat, project.measures.length ? project.measures : []) : null;
  const end = project ? projectEndBeat(project) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="default" size="icon" onClick={onPlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button
        variant="muted"
        size="icon"
        aria-label="Stop"
        onClick={() => {
          engine.stop();
        }}
      >
        <Square className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Start" onClick={() => engine.seek(0, useEditor.getState().project, useEditor.getState().tempoScale)}>
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" disabled={!selectionCount} onClick={onPlaySelection}>
        {tr(locale, `试听选区 ${selectionCount || ""}`.trim(), `Play ${selectionCount || "selection"}`)}
      </Button>
      <div className="min-w-[128px] text-xs tabular-nums text-[#c7c1b6]">
        {where
          ? tr(locale, `第 ${where.measure} 小节 · ${(where.beatInBar + 1).toFixed(2)} 拍`, `Bar ${where.measure} · ${(where.beatInBar + 1).toFixed(2)}`)
          : "—"}
        <span className="ml-2 text-[#7e7a72]">{end ? `${Math.max(0, beat).toFixed(2)}` : ""}</span>
      </div>
    </div>
  );
}

function Empty({ locale, busy }: { locale: Locale; busy: boolean }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="text-lg">{busy ? tr(locale, "正在读谱…", "Reading the score…") : tr(locale, "把谱放进来", "Drop a score")}</p>
        <p className="mt-2 max-w-md text-sm text-[#9c968a]">
          {tr(
            locale,
            "支持 MusicXML、压缩的 MXL，以及每声部一轨的 MIDI。共享谱表（女高女低一行、男高男低一行）会拆开。",
            "MusicXML, compressed MXL, and one-track-per-voice MIDI. Shared staves (SA on treble, TB on bass) are split apart.",
          )}
        </p>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#1c212c" />
      <rect x="7" y="6" width="10" height="3" rx="1" fill="#ff7b72" />
      <rect x="7" y="11" width="14" height="3" rx="1" fill="#f0c14a" />
      <rect x="7" y="16" width="12" height="3" rx="1" fill="#3ecfb2" />
      <rect x="7" y="21" width="8" height="2.5" rx="1" fill="#7aa2ff" />
    </svg>
  );
}
