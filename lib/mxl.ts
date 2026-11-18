import { strFromU8, unzipSync } from "fflate";

/** Pull the root MusicXML document out of a compressed .mxl package. */
export function extractMxl(data: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error("无法解压 MXL（它应该是一个 zip 包）。");
  }
  const names = Object.keys(files);
  const containerName = names.find((name) => name.toLowerCase().endsWith("meta-inf/container.xml"));
  if (containerName) {
    const container = strFromU8(files[containerName]);
    const match = container.match(/full-path\s*=\s*"([^"]+)"/i);
    if (match) {
      const wanted = match[1].replace(/^\.\//, "");
      const hit = names.find((name) => name === wanted || name.endsWith(`/${wanted}`) || name.endsWith(wanted));
      if (hit) return strFromU8(files[hit]);
    }
  }
  const score = names.find((name) => {
    const lower = name.toLowerCase();
    return (lower.endsWith(".xml") || lower.endsWith(".musicxml")) && !lower.includes("meta-inf") && !lower.endsWith("container.xml");
  });
  if (!score) throw new Error("MXL 里没有找到 MusicXML。");
  return strFromU8(files[score]);
}
