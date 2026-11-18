import { midiName } from "@/lib/pitch";
import { isBlackKey } from "@/lib/pitch";
import { ensureMeasures, locateBeat, projectEndBeat } from "@/lib/timing";
import type { NoteEvent, ScoreProject } from "@/lib/types";
import { KEY_W, PITCH_MAX, PITCH_MIN, RULER_H, beatToX, rowTop, yToMidi } from "./geometry";

export interface DrawModel {
  project: ScoreProject;
  notes: NoteEvent[];
  selection: Set<string>;
  audible: Set<string>;
  playhead: number;
  zoomX: number;
  zoomY: number;
  scrollX: number;
  scrollY: number;
  locale: "zh" | "en";
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  hover: { x: number; y: number; text: string } | null;
}

export function drawRoll(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: DrawModel,
) {
  const { project, notes, zoomX, zoomY, scrollX, scrollY } = model;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#12141c";
  ctx.fillRect(0, 0, width, height);

  const endBeat = projectEndBeat(project);
  const measures = ensureMeasures(project, endBeat);
  const viewBeat0 = Math.max(0, (scrollX - 2) / zoomX);
  const viewBeat1 = (scrollX + width - KEY_W + 2) / zoomX;
  const midiTop = yToMidi(RULER_H, zoomY, scrollY) + 1;
  const midiBottom = yToMidi(height, zoomY, scrollY) - 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, RULER_H, Math.max(0, width - KEY_W), Math.max(0, height - RULER_H));
  ctx.clip();

  for (let midi = Math.min(PITCH_MAX, midiTop); midi >= Math.max(PITCH_MIN, midiBottom); midi--) {
    const y = rowTop(midi, zoomY, scrollY);
    ctx.fillStyle = isBlackKey(midi) ? "#161922" : "#1b1f2b";
    ctx.fillRect(KEY_W, y, width - KEY_W, zoomY);
    if (midi % 12 === 0) {
      ctx.fillStyle = "rgba(224, 181, 106, 0.05)";
      ctx.fillRect(KEY_W, y, width - KEY_W, zoomY);
    }
  }

  for (const measure of measures) {
    if (measure.startBeat > viewBeat1 || measure.startBeat + measure.lengthBeats < viewBeat0) continue;
    const beatLen = 4 / measure.beatType;
    let step = beatLen;
    while (step > 1 / 16 && zoomX * step > 78) step /= 2;
    const start = measure.startBeat;
    const stop = measure.startBeat + measure.lengthBeats;
    for (let beat = start; beat < stop - 1e-6; beat += step) {
      const x = beatToX(beat, zoomX, scrollX);
      const isBar = Math.abs(beat - start) < 1e-4;
      const isBeat = Math.abs((beat - start) / beatLen - Math.round((beat - start) / beatLen)) < 1e-3;
      ctx.beginPath();
      ctx.strokeStyle = isBar ? "rgba(224, 181, 106, 0.55)" : isBeat ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.045)";
      ctx.lineWidth = isBar ? 1.4 : 1;
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }
  const finalX = beatToX(endBeat, zoomX, scrollX);
  ctx.beginPath();
  ctx.strokeStyle = "rgba(224, 181, 106, 0.55)";
  ctx.moveTo(finalX, RULER_H);
  ctx.lineTo(finalX, height);
  ctx.stroke();

  const colors = new Map(project.tracks.map((track) => [track.id, track.color]));
  const paint = (note: NoteEvent, selected: boolean) => {
    const audible = model.audible.has(note.trackId);
    const x = beatToX(note.startBeat, zoomX, scrollX);
    const w = Math.max(2.5, note.durationBeats * zoomX - 1);
    const y = rowTop(note.midi, zoomY, scrollY) + 1;
    const h = Math.max(3, zoomY - 2);
    if (x + w < KEY_W || x > width || y > height || y + h < RULER_H) return;
    ctx.globalAlpha = audible ? 0.95 : 0.16;
    roundRect(ctx, x, y, w, h, Math.min(4, h / 2));
    ctx.fillStyle = colors.get(note.trackId) ?? "#ddd";
    ctx.fill();
    if (selected) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#fff8ea";
      ctx.stroke();
    }
    if (audible && note.lyric && w > 16 && h > 11) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1a120c";
      ctx.font = `600 ${Math.min(12, h - 2)}px "WenQuanYi Micro Hei", sans-serif`;
      ctx.fillText(note.lyric, x + 4, y + h - 3);
    }
    ctx.globalAlpha = 1;
  };

  for (const note of notes) {
    if (model.selection.has(note.id)) continue;
    paint(note, false);
  }
  for (const note of notes) {
    if (!model.selection.has(note.id)) continue;
    paint(note, true);
  }

  const playX = beatToX(model.playhead, zoomX, scrollX);
  if (playX >= KEY_W && playX <= width) {
    ctx.beginPath();
    ctx.strokeStyle = "#f3d7a2";
    ctx.lineWidth = 1.5;
    ctx.moveTo(playX, RULER_H);
    ctx.lineTo(playX, height);
    ctx.stroke();
  }

  if (model.box) {
    const x = Math.min(model.box.x0, model.box.x1);
    const y = Math.min(model.box.y0, model.box.y1);
    const w = Math.abs(model.box.x1 - model.box.x0);
    const h = Math.abs(model.box.y1 - model.box.y0);
    ctx.fillStyle = "rgba(224, 181, 106, 0.12)";
    ctx.strokeStyle = "rgba(243, 215, 162, 0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  ctx.restore();

  ctx.fillStyle = "#10131a";
  ctx.fillRect(0, 0, width, RULER_H);
  ctx.fillRect(0, 0, KEY_W, height);
  ctx.strokeStyle = "#2c3142";
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + 0.5);
  ctx.lineTo(width, RULER_H + 0.5);
  ctx.moveTo(KEY_W + 0.5, 0);
  ctx.lineTo(KEY_W + 0.5, height);
  ctx.stroke();

  ctx.font = `12px "WenQuanYi Micro Hei", sans-serif`;
  ctx.textBaseline = "middle";
  for (const measure of measures) {
    const x = beatToX(measure.startBeat, zoomX, scrollX);
    if (x < KEY_W - 4 || x > width) continue;
    ctx.fillStyle = "#e7e1d6";
    ctx.fillText(String(measure.index), x + 6, 16);
    const prev = measures[measure.index - 2];
    if (!prev || prev.beats !== measure.beats || prev.beatType !== measure.beatType) {
      ctx.fillStyle = "#d7a15e";
      ctx.fillText(`${measure.beats}/${measure.beatType}`, x + 22, 16);
    }
  }

  const active = new Map<number, string>();
  for (const note of notes) {
    if (!model.audible.has(note.trackId)) continue;
    if (model.playhead + 1e-4 >= note.startBeat && model.playhead < note.startBeat + note.durationBeats) {
      active.set(note.midi, colors.get(note.trackId) ?? "#f3d7a2");
    }
  }
  for (let midi = Math.min(PITCH_MAX, midiTop); midi >= Math.max(PITCH_MIN, midiBottom); midi--) {
    const y = rowTop(midi, zoomY, scrollY);
    const black = isBlackKey(midi);
    ctx.fillStyle = active.has(midi) ? active.get(midi)! : black ? "#232838" : "#d9d3c7";
    const inset = black ? 8 : 0;
    ctx.fillRect(0, y + 0.5, KEY_W - 8 - inset, Math.max(1, zoomY - 1));
    if (!black && zoomY >= 12 && midi % 12 === 0) {
      ctx.fillStyle = active.has(midi) ? "#1a1208" : "#1b1e27";
      ctx.font = `11px "WenQuanYi Micro Hei", sans-serif`;
      ctx.fillText(midiName(midi), 6, y + zoomY / 2);
    }
  }

  if (playX >= KEY_W && playX <= width) {
    ctx.beginPath();
    ctx.fillStyle = "#f3d7a2";
    ctx.moveTo(playX - 6, RULER_H - 1);
    ctx.lineTo(playX + 6, RULER_H - 1);
    ctx.lineTo(playX, RULER_H + 8);
    ctx.fill();
  }

  if (model.hover) {
    const text = model.hover.text;
    ctx.font = `12px "WenQuanYi Micro Hei", sans-serif`;
    const pad = 8;
    const tw = ctx.measureText(text).width;
    let x = model.hover.x + 12;
    let y = model.hover.y - 28;
    if (x + tw + pad * 2 > width) x = model.hover.x - tw - 16;
    if (y < 4) y = model.hover.y + 16;
    ctx.fillStyle = "rgba(18, 16, 14, 0.94)";
    ctx.strokeStyle = "rgba(224, 181, 106, 0.7)";
    roundRect(ctx, x, y, tw + pad * 2, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f6f1e7";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + pad, y + 11);
  }

  const where = locateBeat(Math.max(0, model.playhead), measures);
  ctx.fillStyle = "#9c968a";
  ctx.font = `11px "WenQuanYi Micro Hei", sans-serif`;
  ctx.textBaseline = "alphabetic";
  const label =
    model.locale === "zh"
      ? `第 ${where.measure} 小节 · 拍 ${(where.beatInBar + 1).toFixed(2)}`
      : `Bar ${where.measure} · beat ${(where.beatInBar + 1).toFixed(2)}`;
  ctx.fillText(label, KEY_W + 8, height - 8);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
