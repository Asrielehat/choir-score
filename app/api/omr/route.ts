import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { extractMxl } from "@/lib/mxl";
import { omrUnavailable } from "@/lib/omr";

export const runtime = "nodejs";

export function GET() {
  const command = process.env.OMR_COMMAND;
  if (!command) return NextResponse.json(omrUnavailable(), { status: 501 });
  return NextResponse.json({
    ok: true,
    command,
    args: process.env.OMR_ARGS ?? "-batch,-export,-output,{outdir},{input}",
    accepts: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
    returns: "application/vnd.recordare.musicxml+xml",
  });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const filename = file instanceof File ? file.name : null;
  const command = process.env.OMR_COMMAND;
  if (!command) {
    return NextResponse.json(omrUnavailable(filename), { status: 501 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, messageZh: "没有上传文件。", messageEn: "No file uploaded." }, { status: 400 });
  }

  const dir = await mkdtemp(join(tmpdir(), "choir-omr-"));
  const safeName = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "score.bin";
  const input = join(dir, safeName);
  const outdir = join(dir, "out");
  await writeFile(input, Buffer.from(await file.arrayBuffer()));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outdir);

  const argTemplate = (process.env.OMR_ARGS ?? "-batch,-export,-output,{outdir},{input}").split(",");
  const args = argTemplate.map((arg) => arg.replaceAll("{outdir}", outdir).replaceAll("{input}", input).replaceAll("{dir}", dir));

  try {
    const stderr = await run(command, args);
    const produced = await findScore(outdir);
    if (!produced) {
      return NextResponse.json(
        {
          ok: false,
          code: "omr_failed",
          messageZh: "引擎跑完了，但没有找到 MusicXML。",
          messageEn: "The engine finished without a MusicXML file.",
          stderr: stderr.slice(-2000),
        },
        { status: 502 },
      );
    }
    const bytes = await readFile(produced);
    const musicxml = produced.toLowerCase().endsWith(".mxl") ? extractMxl(bytes) : bytes.toString("utf8");
    return NextResponse.json({ ok: true, musicxml, filename: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        code: "omr_failed",
        messageZh: `OMR 失败：${message}`,
        messageEn: `OMR failed: ${message}`,
      },
      { status: 502 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("超时（120 秒）"));
    }, 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim().slice(-500) || `exit ${code}`));
    });
  });
}

async function findScore(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findScore(path);
      if (nested) return nested;
    } else if (/\.(musicxml|xml|mxl)$/i.test(entry.name) && !/container\.xml$/i.test(entry.name)) {
      return path;
    }
  }
  return null;
}
