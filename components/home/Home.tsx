"use client";

import { ArrowRight, FilePlus2, FolderOpen, Languages, Music4, ScanLine, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BusyOverlay } from "@/components/ui/busy-overlay";
import { OmrDialog } from "@/components/editor/Dialogs";
import { ACCEPT, importScoreFile, loadSampleProject } from "@/lib/importer";
import { STORAGE_KEY, blankProject, deserializeProject, projectSummary } from "@/lib/project";
import { hydrateLocale, useEditor, type Locale } from "@/lib/store";

function tr(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

interface Recent {
  title: string;
  notes: number;
  sourceName?: string;
}

export function Home() {
  const router = useRouter();
  const locale = useEditor((s) => s.locale);
  const busy = useEditor((s) => s.busy);
  const omrStatus = useEditor((s) => s.omrStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState("");

  useEffect(() => {
    hydrateLocale();
    // Read the saved project after paint: localStorage is not available during render.
    const id = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setRecent(projectSummary(saved));
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const openEditor = () => router.push("/editor");

  const startBlank = () => {
    useEditor.getState().setProject(blankProject(tr(locale, "未命名", "Untitled")));
    openEditor();
  };

  const continueLast = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      useEditor.getState().setProject(deserializeProject(saved));
      openEditor();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setRecent(null);
    }
  };

  const openSample = async () => {
    await loadSampleProject();
    if (useEditor.getState().project) openEditor();
  };

  const takeFile = async (file: File | undefined | null) => {
    if (!file) return;
    await importScoreFile(file, page);
    if (useEditor.getState().project) openEditor();
  };

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
      void takeFile(event.dataTransfer?.files?.[0]);
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
    // takeFile closes over `page`; the listener is rebound when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="relative min-h-dvh bg-[#10131a] text-[#f3efe6]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_20%_0%,rgba(215,161,94,0.16),transparent),radial-gradient(50%_90%_at_80%_0%,rgba(122,162,255,0.12),transparent)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6">
        <header className="flex items-center gap-3">
          <Mark />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">{tr(locale, "合唱分轨", "Choir Roll")}</div>
            <div className="text-[10px] tracking-[0.14em] text-[#d7a15e] uppercase">
              {tr(locale, "SATB 钢琴卷帘", "SATB piano roll")}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="Language"
            onClick={() => useEditor.getState().setLocale(locale === "zh" ? "en" : "zh")}
          >
            <Languages className="h-4 w-4" />
          </Button>
        </header>

        <main className="flex flex-1 flex-col justify-center py-12">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            {tr(locale, "把合唱谱摊在一条不断的时间线上", "Lay a choral score onto one unbroken timeline")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#c7c1b6]">
            {tr(
              locale,
              "导入 MusicXML、MIDI 或扫描件，SATB 与钢琴伴奏会自动分轨。卷帘只按拍走，不按小节切，换拍也不会错位；双击放音块，右键删音块。",
              "Import MusicXML, MIDI, or a scan and the SATB parts split themselves. The roll counts beats, not bars, so a meter change never shifts your notes. Double-click to add a note, right-click to remove one.",
            )}
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Action
              icon={<FilePlus2 className="h-5 w-5" />}
              title={tr(locale, "新建空白谱", "New blank score")}
              hint={tr(locale, "六条空轨，直接从卷帘上动手", "Six empty tracks, draw straight into the roll")}
              onClick={startBlank}
              disabled={busy}
              primary
            />
            <Action
              icon={<FolderOpen className="h-5 w-5" />}
              title={tr(locale, "打开谱面文件", "Open a score file")}
              hint="MusicXML / MXL / MIDI / 工程 JSON"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            />
            <Action
              icon={<ScanLine className="h-5 w-5" />}
              title={tr(locale, "识别扫描件", "Recognize a scan")}
              hint={tr(locale, "PDF 或图片，跑本地 Audiveris", "PDF or image, local Audiveris")}
              onClick={() => scanRef.current?.click()}
              disabled={busy}
            />
            <Action
              icon={<Sparkles className="h-5 w-5" />}
              title={tr(locale, "示例「晨光」", "Sample “Morning Light”")}
              hint={tr(locale, "带转调的 SATB，先看效果", "An SATB piece with a key change")}
              onClick={() => void openSample()}
              disabled={busy}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#8d877c]">
            <span>{tr(locale, "扫描件的页码", "Page of the scan")}</span>
            <input
              inputMode="numeric"
              value={page}
              onChange={(event) => setPage(event.target.value.replace(/[^\d]/g, ""))}
              placeholder={tr(locale, "全部", "all")}
              aria-label={tr(locale, "扫描件页码，留空表示全部", "Scan page, empty for all")}
              className="h-7 w-14 rounded-md border border-[#343846] bg-[#161a22] px-2 text-[11px] text-[#f3efe6] outline-none focus:border-[#d7a15e]"
            />
            <span>{tr(locale, "留空会逐页读完整份谱。", "Leave empty to read every page.")}</span>
          </div>

          {recent ? (
            <button
              type="button"
              onClick={continueLast}
              disabled={busy}
              className="mt-6 flex w-full items-center gap-3 rounded-xl border border-[#2e3342] bg-[#141821] p-3 text-left transition hover:border-[#d7a15e]/60 disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#1c212c] text-[#d7a15e]">
                <Music4 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {tr(locale, "继续上次编辑", "Continue where you left off")}
                  <span className="ml-2 font-normal text-[#d7a15e]">{recent.title}</span>
                </span>
                <span className="block truncate text-[11px] text-[#9c968a]">
                  {recent.notes} {tr(locale, "个音符", "notes")}
                  {recent.sourceName ? ` · ${recent.sourceName}` : ""}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#9c968a]" />
            </button>
          ) : null}
        </main>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#232833] pt-3 text-[11px] text-[#7e7a72]">
          <span>{tr(locale, "按拍连续的钢琴卷帘，小节线已去掉。", "A beat-continuous roll with no barlines.")}</span>
          <span>{tr(locale, "双击空处放音块 · 右键删音块 · 空格播放", "Double-click adds · right-click deletes · space plays")}</span>
        </footer>
      </div>

      <input
        ref={fileRef}
        type="file"
        hidden
        accept={ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void takeFile(file);
        }}
      />
      <input
        ref={scanRef}
        type="file"
        hidden
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void takeFile(file);
        }}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-4 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-[#d7a15e] bg-[#10131a]/85 text-sm">
          {tr(locale, "松开即可导入 MusicXML、MXL、MIDI、PDF 或工程", "Drop MusicXML, MXL, MIDI, PDF, or a project")}
        </div>
      ) : null}
      <BusyOverlay />
      <OmrDialog open={!!omrStatus} onOpenChange={(open) => !open && useEditor.getState().setOmrStatus(null)} status={omrStatus} />
    </div>
  );
}

function Action({
  icon,
  title,
  hint,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? "border-[#d7a15e]/70 bg-[#d7a15e]/10 hover:bg-[#d7a15e]/15"
          : "border-[#2e3342] bg-[#141821] hover:border-[#d7a15e]/60"
      }`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${primary ? "bg-[#d7a15e] text-[#1a1208]" : "bg-[#1c212c] text-[#d7a15e]"}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-[#9c968a]">{hint}</span>
      </span>
    </button>
  );
}

function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#1c212c" />
      <rect x="7" y="6" width="10" height="3" rx="1" fill="#ff7b72" />
      <rect x="7" y="11" width="14" height="3" rx="1" fill="#f0c14a" />
      <rect x="7" y="16" width="12" height="3" rx="1" fill="#3ecfb2" />
      <rect x="7" y="21" width="8" height="2.5" rx="1" fill="#7aa2ff" />
    </svg>
  );
}
