import type { OmrStatus } from "./omr";
import { importScoreBytes, projectFromMusicXml, projectFromOmrPages } from "./project";
import { useEditor } from "./store";

export const SCAN_RE = /\.(pdf|png|jpe?g|tif|tiff)$/i;
export const SCORE_RE = /\.(musicxml|xml|mxl|mid|midi|json)$/i;
export const ACCEPT = ".musicxml,.xml,.mxl,.mid,.midi,.json,.pdf,.png,.jpg,.jpeg,.tif,.tiff";

export const SAMPLE_URL = "/samples/chen-guang.musicxml";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tr(zh: string, en: string): string {
  return useEditor.getState().locale === "zh" ? zh : en;
}

/** The built-in demo piece. */
export async function loadSampleProject(): Promise<void> {
  const store = useEditor.getState();
  store.setError(null);
  store.setBusy(true, tr("正在载入示例…", "Loading the sample…"));
  try {
    const response = await fetch(SAMPLE_URL);
    if (!response.ok) throw new Error(tr("示例谱没有找到", "The sample score is missing"));
    const next = projectFromMusicXml(await response.text());
    next.sourceName = "chen-guang.musicxml";
    useEditor.getState().setProject(next);
  } catch (error) {
    useEditor.getState().setError(message(error));
  } finally {
    useEditor.getState().setBusy(false);
  }
}

/**
 * Send a page through Audiveris. The API answers with one MusicXML per page,
 * and the pages are joined onto a single beat timeline.
 */
async function recognizeScan(file: File, page: string): Promise<void> {
  const everyPage = !page || page === "all" || page === "0";
  const store = useEditor.getState();
  store.setBusy(
    true,
    everyPage
      ? tr("Audiveris 正在逐页读谱，多页会接成一条时间线", "Audiveris is reading every page onto one timeline")
      : tr("Audiveris 正在读这一页，通常一分钟左右", "Audiveris is reading this page, usually about a minute"),
  );
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
      useEditor.getState().setOmrStatus(null);
      useEditor.getState().setProject(next);
    } else {
      useEditor.getState().setOmrStatus(data);
    }
  } catch (error) {
    useEditor.getState().setError(message(error));
  } finally {
    useEditor.getState().setBusy(false);
  }
}

/** One entry point for the home screen and the editor: a scan goes through OMR, a score is parsed. */
export async function importScoreFile(file: File, page = ""): Promise<void> {
  const store = useEditor.getState();
  store.setError(null);
  if (SCAN_RE.test(file.name)) {
    await recognizeScan(file, page);
    return;
  }
  store.setBusy(true, tr("正在读取谱面…", "Reading the score…"));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    useEditor.getState().setProject(importScoreBytes(file.name, bytes));
  } catch (error) {
    useEditor.getState().setError(message(error));
  } finally {
    useEditor.getState().setBusy(false);
  }
}
