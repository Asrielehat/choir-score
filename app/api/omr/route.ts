import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { extractMxl } from "@/lib/mxl";
import { omrUnavailable } from "@/lib/omr";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    noteZh: "使用 Audiveris 5 把扫描页转成 MusicXML，再按合唱总谱拆成女高、女低、男高、男低和钢琴。",
    noteEn: "Audiveris 5 turns a scanned page into MusicXML, then the choir layout splits SATB and piano.",
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

  const requestedPage = Math.max(1, Number(form?.get("page") || 1) || 1);
  const dir = await mkdtemp(join(tmpdir(), "choir-omr-"));
  const safeName = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "score.bin";
  const input = join(dir, safeName);
  const outdir = join(dir, "out");
  await writeFile(input, Buffer.from(await file.arrayBuffer()));

  try {
    const image = await rasterize(input, file.name, requestedPage, dir);
    const preview = await previewJpeg(image);
    const stderr = await run(engine, ["-batch", "-transcribe", "-export", "-swap", "-output", outdir, image], 240_000);
    const produced = await findScore(outdir);
    if (!produced) {
      return NextResponse.json(
        {
          ok: false,
          code: "omr_failed",
          messageZh: "Audiveris 跑完了，但没有导出 MusicXML。扫描太淡、页码不对，或这一页不是乐谱。",
          messageEn: "Audiveris finished without MusicXML. The scan may be faint, or this page is not music.",
          stderr: stderr.slice(-2000),
        },
        { status: 502 },
      );
    }
    const bytes = await readFile(produced);
    const musicxml = produced.toLowerCase().endsWith(".mxl") ? extractMxl(bytes) : bytes.toString("utf8");
    const warnings = stderr.includes("too long")
      ? ["Audiveris 报告有小节时值偏长，导入时会裁到小节线，不把后面的音乐往后推。"]
      : [];
    if (stderr.includes("supported languages is empty") || stderr.includes("Missing support")) {
      warnings.push("没有可用的文字识别语言包，歌词可能是空的。安装 tesseract-ocr-eng 后重试。");
    }
    return NextResponse.json({
      ok: true,
      engine: "audiveris",
      musicxml,
      filename: file.name,
      warnings,
      pages: preview
        ? [{ label: file.name.toLowerCase().endsWith(".pdf") ? `第 ${requestedPage} 页` : file.name, href: preview }]
        : [],
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

async function rasterize(input: string, filename: string, page: number, dir: string): Promise<string> {
  if (!filename.toLowerCase().endsWith(".pdf")) return input;
  const prefix = join(dir, "page");
  await run("pdftoppm", ["-f", String(page), "-l", String(page), "-png", "-r", "300", input, prefix], 60_000);
  const pngs = (await readdir(dir)).filter((name) => name.startsWith("page") && name.endsWith(".png"));
  if (!pngs.length) throw new Error(`PDF 里没有第 ${page} 页。`);
  return join(dir, pngs[0]);
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
