import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { readMetronomeBpm } from "@/lib/metronome";
import { extractMxl } from "@/lib/mxl";
import { omrUnavailable } from "@/lib/omr";

export const runtime = "nodejs";
export const maxDuration = 600;

const AUDIVERIS_CANDIDATES = ["/opt/audiveris/bin/Audiveris", "/usr/bin/audiveris"];
const TESS_PREFIX =
  process.env.TESSDATA_PREFIX ||
  (exists("/opt/audiveris/tessdata/eng.traineddata")
    ? "/opt/audiveris/tessdata/"
    : "/usr/share/tesseract-ocr/5/tessdata/");

export function GET() {
  const engine = resolveEngine();
  if (!engine) return NextResponse.json(omrUnavailable(), { status: 501 });
  return NextResponse.json({
    ok: true,
    engine: "audiveris",
    command: engine,
    accepts: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
    returns: "application/vnd.recordare.musicxml+xml",
    noteZh: "使用 Audiveris 5 把每一页转成 MusicXML，再接成一条时间线，拆成女高、女低、男高、男低、钢琴和大提琴。",
    noteEn: "Audiveris 5 turns each page into MusicXML, then the pages join onto one timeline as SATB, piano, and cello.",
  });
}

export async function POST(request: Request) {
  const engine = resolveEngine();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const filename = file instanceof File ? file.name : null;
  if (!engine) return NextResponse.json(omrUnavailable(filename), { status: 501 });
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, messageZh: "没有上传文件。", messageEn: "No file uploaded." }, { status: 400 });
  }

  const pageSpec = String(form?.get("page") ?? "all");
  const dir = await mkdtemp(join(tmpdir(), "choir-omr-"));
  const safeName = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "score.bin";
  const input = join(dir, safeName);
  await writeFile(input, Buffer.from(await file.arrayBuffer()));

  try {
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const total = isPdf ? await pdfPageCount(input) : 1;
    const pages = pageList(pageSpec, total);
    const musicxmls: string[] = [];
    const previews: { label: string; href: string }[] = [];
    const warnings: string[] = [];
    let metronome: number | null = null;
    for (const page of pages) {
      const image = await rasterize(input, file.name, page, dir);
      if (metronome == null && page === pages[0]) metronome = await headerMetronome(image);
      const preview = await previewJpeg(image);
      if (preview) previews.push({ label: isPdf ? `第 ${page} 页` : file.name, href: preview });
      const outdir = join(dir, `out-${page}`);
      const languages = exists("/opt/audiveris/tessdata/chi_sim.traineddata") ? "chi_sim+eng" : "eng";
      const stderr = await run(
        engine,
        [
          "-batch",
          "-transcribe",
          "-export",
          "-swap",
          "-constant",
          `org.audiveris.omr.text.Language.defaultSpecification=${languages}`,
          "-output",
          outdir,
          image,
        ],
        240_000,
      );
      const produced = await findScore(outdir);
      if (!produced) {
        warnings.push(`第 ${page} 页没有导出 MusicXML，已跳过。`);
        continue;
      }
      const bytes = await readFile(produced);
      musicxmls.push(produced.toLowerCase().endsWith(".mxl") ? extractMxl(bytes) : bytes.toString("utf8"));
      if (stderr.includes("too long")) {
        warnings.push(`第 ${page} 页有小节时值偏长，导入时会裁到小节线，不把后面的音乐往后推。`);
      }
      if (stderr.includes("supported languages is empty") || stderr.includes("Missing support")) {
        warnings.push("没有可用的文字识别语言包，歌词可能是空的。安装 tesseract-ocr-eng 后重试。");
      }
    }
    if (!musicxmls.length) {
      return NextResponse.json(
        {
          ok: false,
          code: "omr_failed",
          messageZh: "Audiveris 跑完了，但没有导出 MusicXML。扫描太淡、页码不对，或这几页不是乐谱。",
          messageEn: "Audiveris finished without MusicXML. The scan may be faint, or these pages are not music.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      engine: "audiveris",
      musicxml: musicxmls[0],
      musicxmls,
      metronome,
      filename: file.name,
      warnings,
      pages: previews,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        code: "omr_failed",
        messageZh: `识别失败：${message}`,
        messageEn: `Recognition failed: ${message}`,
      },
      { status: 502 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function exists(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveEngine(): string | null {
  if (process.env.OMR_COMMAND && process.env.OMR_COMMAND !== "audiveris") {
    return process.env.OMR_COMMAND;
  }
  for (const candidate of AUDIVERIS_CANDIDATES) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try the next location */
    }
  }
  return process.env.OMR_COMMAND || null;
}

function pageList(spec: string, total: number): number[] {
  const text = spec.trim().toLowerCase();
  const capped = Math.min(Math.max(total, 1), 16);
  if (!text || text === "all" || text === "0") {
    return Array.from({ length: capped }, (_, index) => index + 1);
  }
  const page = Math.max(1, Math.min(capped, Number(text) || 1));
  return [page];
}

async function pdfPageCount(file: string): Promise<number> {
  const log = await run("pdfinfo", [file], 20_000);
  const match = log.match(/Pages:\s+(\d+)/);
  return match ? Math.max(1, Number(match[1])) : 1;
}

async function headerMetronome(image: string): Promise<number | null> {
  const header = `${image}.header.png`;
  try {
    // The metronome often sits under a title block, below the top sixth of the page.
    await run("ffmpeg", ["-y", "-i", image, "-vf", "crop=iw:ih/4:0:0", header], 20_000);
    const text = await run("tesseract", [header, "stdout", "-l", "eng", "--psm", "6"], 20_000);
    return readMetronomeBpm(text);
  } catch {
    return null;
  }
}

async function rasterize(input: string, filename: string, page: number, dir: string): Promise<string> {
  if (!filename.toLowerCase().endsWith(".pdf")) return input;
  const folder = join(dir, `raster-${page}`);
  await mkdir(folder, { recursive: true });
  const prefix = join(folder, "img");
  await run("pdftoppm", ["-f", String(page), "-l", String(page), "-png", "-r", "300", input, prefix], 60_000);
  const pngs = (await readdir(folder)).filter((name) => name.startsWith("img") && name.endsWith(".png"));
  if (!pngs.length) throw new Error(`PDF 里没有第 ${page} 页。`);
  return join(folder, pngs[0]);
}

async function previewJpeg(image: string): Promise<string | null> {
  const target = `${image}.preview.jpg`;
  try {
    await run("ffmpeg", ["-y", "-i", image, "-vf", "scale=760:-1", "-q:v", "6", target], 30_000);
    const bytes = await readFile(target);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TESSDATA_PREFIX: TESS_PREFIX, JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || "-Xmx2200m" },
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("识别超时。请改传单页，或把 PDF 页码指到有谱的那一页。"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const log = `${stdout}\n${stderr}`;
      if (code === 0 || log.includes("exported to")) resolve(log);
      else reject(new Error((stderr || stdout).trim().slice(-500) || `exit ${code}`));
    });
  });
}

async function findScore(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findScore(path);
      if (nested) files.push(nested);
    } else if (/\.(musicxml|xml|mxl)$/i.test(entry.name) && !/container\.xml$/i.test(entry.name)) {
      files.push(path);
    }
  }
  return files.find((file) => file.endsWith(".mxl")) ?? files[0] ?? null;
}
