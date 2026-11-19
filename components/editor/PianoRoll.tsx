"use client";

import { useEffect, useRef, useState } from "react";
import { engine } from "@/lib/audio";
import { midiName, pitchRangeLabel } from "@/lib/pitch";
import { useEditor } from "@/lib/store";
import { audibleTrackIds } from "@/lib/tracks";
import { rollLength, snapBeat } from "@/lib/timing";
import { ROLE_META, type NoteEvent } from "@/lib/types";
import { drawRoll } from "./drawRoll";
import {
  KEY_W,
  PITCH_MAX,
  RULER_H,
  beatToX,
  contentHeight,
  hitTestNote,
  xToBeat,
  yToMidi,
  yToMidiFloat,
} from "./geometry";

interface DragMove {
  kind: "move" | "resize-start" | "resize-end";
  ids: string[];
  originX: number;
  originY: number;
  originals: Map<string, NoteEvent>;
  anchorId: string;
  changed: boolean;
}
interface DragBox {
  kind: "box";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: string[];
}
interface DragSeek {
  kind: "seek";
}

export function PianoRoll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 800, h: 480 });
  const [size, setSize] = useState({ w: 800, h: 480 });
  const dragRef = useRef<DragMove | DragBox | DragSeek | null>(null);
  const previewRef = useRef<NoteEvent[] | null>(null);
  const boxSelRef = useRef<string[] | null>(null);
  const hoverRef = useRef<{ x: number; y: number; text: string } | null>(null);
  const fitted = useRef("");

  const loadToken = useEditor((s) => s.loadToken);

  const draw = () => {
    const canvas = canvasRef.current;
    const project = useEditor.getState().project;
    if (!canvas || !project) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = sizeRef.current;
    const state = useEditor.getState();
    const notes = previewRef.current ?? project.notes;
    const selection = new Set(boxSelRef.current ?? state.selection);
    const audible = audibleTrackIds(project);
    const drag = dragRef.current;
    drawRoll(ctx, w, h, {
      project,
      notes,
      selection,
      audible,
      playhead: engine.currentBeat(),
      zoomX: state.zoomX,
      zoomY: state.zoomY,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      locale: state.locale,
      grid: state.snapBeats > 0 ? state.snapBeats : 0.25,
      box: drag && drag.kind === "box" ? drag : null,
      hover: hoverRef.current,
    });
  };

  const resize = () => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };
    setSize((prev) => (prev.w === rect.width && prev.h === rect.height ? prev : { w: rect.width, h: rect.height }));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    draw();
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(wrap);
    resize();
    return () => observer.disconnect();
    // resize is recreated each render and only needs to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const state = useEditor.getState();
      if (engine.playing && state.follow && state.project) {
        const beat = engine.currentBeat();
        const view = Math.max(1, sizeRef.current.w - KEY_W);
        const x = beatToX(beat, state.zoomX, state.scrollX);
        if (x > KEY_W + view * 0.78 || x < KEY_W + view * 0.08) {
          state.setScroll(Math.max(0, beat * state.zoomX - view * 0.28), state.scrollY);
        }
      }
      draw();
      if (engine.playing) frame = requestAnimationFrame(loop);
    };
    const unsubStore = useEditor.subscribe(() => {
      if (!engine.playing) draw();
    });
    const unsubEngine = engine.on(() => {
      if (engine.playing) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(loop);
      } else {
        draw();
      }
    });
    draw();
    return () => {
      cancelAnimationFrame(frame);
      unsubStore();
      unsubEngine();
    };
  }, []);

  useEffect(() => {
    if (!loadToken) return;
    if (fitted.current === String(loadToken)) return;
    fitted.current = String(loadToken);
    const id = requestAnimationFrame(() => {
      const project = useEditor.getState().project;
      const { w, h } = sizeRef.current;
      if (!project || w < 80) return;
      const end = rollLength(project);
      const span = Math.max(8, Math.min(end, 16));
      const zoomX = Math.min(120, Math.max(36, (w - KEY_W - 32) / span));
      const midis = project.notes.map((note) => note.midi);
      const maxM = midis.length ? Math.max(...midis) : 72;
      const minM = midis.length ? Math.min(...midis) : 48;
      const zoomY = Math.min(16, Math.max(11, (h - RULER_H - 36) / Math.max(16, maxM - minM + 8)));
      const scrollY = Math.max(0, (PITCH_MAX - (maxM + 4)) * zoomY);
      useEditor.getState().setZoom(zoomX, zoomY);
      useEditor.getState().setScroll(0, scrollY);
      draw();
    });
    return () => cancelAnimationFrame(id);
  }, [loadToken]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = useEditor.getState();
      const rect = wrap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const beat = xToBeat(x, state.zoomX, state.scrollX);
        const next = Math.min(280, Math.max(18, state.zoomX * (event.deltaY < 0 ? 1.08 : 0.92)));
        const scrollX = beat * next - (x - KEY_W);
        state.setZoom(next);
        state.setScroll(scrollX, state.scrollY);
      } else if (event.altKey) {
        const midi = yToMidiFloat(y, state.zoomY, state.scrollY);
        const next = Math.min(28, Math.max(8, state.zoomY * (event.deltaY < 0 ? 1.08 : 0.92)));
        const scrollY = (PITCH_MAX - midi) * next - (y - RULER_H);
        state.setZoom(state.zoomX, next);
        state.setScroll(state.scrollX, scrollY);
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        if (engine.playing) state.setFollow(false);
        state.setScroll(state.scrollX + (event.shiftKey ? event.deltaY : event.deltaX), state.scrollY);
      } else {
        state.setScroll(state.scrollX, state.scrollY + event.deltaY);
      }
      draw();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  const pointerPos = (event: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const project = useEditor.getState().project;
    if (!project) return;
    wrapRef.current?.focus();
    const { x, y } = pointerPos(event);
    // Synthetic or already-released pointers make this throw; the drag still works without capture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer is not active */
    }
    const state = useEditor.getState();
    if (y <= RULER_H && x >= KEY_W) {
      const beat = Math.max(0, xToBeat(x, state.zoomX, state.scrollX));
      engine.seek(beat, project, state.tempoScale);
      dragRef.current = { kind: "seek" };
      draw();
      return;
    }
    if (x < KEY_W) return;
    const notes = project.notes;
    const audible = audibleTrackIds(project);
    const hit = hitTestNote(
      x,
      y,
      notes,
      new Set(state.selection),
      state.zoomX,
      state.zoomY,
      state.scrollX,
      state.scrollY,
      audible,
    );
    if (hit) {
      const track = project.tracks.find((item) => item.id === notes.find((note) => note.id === hit.id)?.trackId);
      if (track) state.setActiveTrack(track.role);
      let ids = state.selection;
      if (event.shiftKey) {
        ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id];
        state.setSelection(ids);
        dragRef.current = null;
        draw();
        return;
      }
      if (!ids.includes(hit.id)) {
        ids = [hit.id];
        state.setSelection(ids);
      }
      const originals = new Map(notes.filter((note) => ids.includes(note.id)).map((note) => [note.id, { ...note }]));
      dragRef.current = {
        kind: hit.edge === "left" ? "resize-start" : hit.edge === "right" ? "resize-end" : "move",
        ids,
        originX: x,
        originY: y,
        originals,
        anchorId: hit.id,
        changed: false,
      };
      return;
    }
    dragRef.current = {
      kind: "box",
      x0: x,
      y0: y,
      x1: x,
      y1: y,
      base: event.shiftKey ? state.selection : [],
    };
    if (!event.shiftKey) state.setSelection([]);
    boxSelRef.current = event.shiftKey ? state.selection : [];
    draw();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const project = useEditor.getState().project;
    if (!project) return;
    const { x, y } = pointerPos(event);
    const state = useEditor.getState();
    const drag = dragRef.current;
    if (!drag) {
      const hit = hitTestNote(
        x,
        y,
        project.notes,
        new Set(state.selection),
        state.zoomX,
        state.zoomY,
        state.scrollX,
        state.scrollY,
        audibleTrackIds(project),
      );
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = y <= RULER_H ? "text" : hit ? (hit.edge === "body" ? "grab" : "ew-resize") : "default";
      }
      if (hit && y > RULER_H) {
        const note = project.notes.find((item) => item.id === hit.id);
        const track = project.tracks.find((item) => item.id === note?.trackId);
        if (note && track) {
          const meta = ROLE_META[track.role];
          const name = state.locale === "zh" ? meta.nameZh : meta.name;
          hoverRef.current = {
            x,
            y,
            text: `${midiName(note.midi)}  ${note.lyric ?? "—"}  ${name}  ${note.startBeat.toFixed(2)}–${(note.startBeat + note.durationBeats).toFixed(2)}`,
          };
        }
      } else hoverRef.current = null;
      draw();
      return;
    }
    if (drag.kind === "seek") {
      engine.seek(Math.max(0, xToBeat(x, state.zoomX, state.scrollX)), project, state.tempoScale);
      draw();
      return;
    }
    if (drag.kind === "box") {
      drag.x1 = x;
      drag.y1 = y;
      const b0 = xToBeat(Math.min(drag.x0, x), state.zoomX, state.scrollX);
      const b1 = xToBeat(Math.max(drag.x0, x), state.zoomX, state.scrollX);
      const m0 = Math.min(yToMidi(drag.y0, state.zoomY, state.scrollY), yToMidi(y, state.zoomY, state.scrollY));
      const m1 = Math.max(yToMidi(drag.y0, state.zoomY, state.scrollY), yToMidi(y, state.zoomY, state.scrollY));
      const audible = audibleTrackIds(project);
      const hitIds = project.notes
        .filter(
          (note) =>
            audible.has(note.trackId) &&
            note.startBeat < b1 &&
            note.startBeat + note.durationBeats > b0 &&
            note.midi >= m0 &&
            note.midi <= m1,
        )
        .map((note) => note.id);
      boxSelRef.current = [...new Set([...drag.base, ...hitIds])];
      draw();
      return;
    }
    const anchor = drag.originals.get(drag.anchorId);
    if (!anchor) return;
    const originBeat = xToBeat(drag.originX, state.zoomX, state.scrollX);
    const beat = xToBeat(x, state.zoomX, state.scrollX);
    const raw = beat - originBeat;
    const minDur = state.snap ? state.snapBeats : 1 / 32;
    let next = project.notes.map((note) => {
      const original = drag.originals.get(note.id);
      if (!original) return note;
      if (drag.kind === "move") {
        const desired = anchor.startBeat + raw;
        const snapped = snapBeat(desired, state.snapBeats, state.snap);
        let delta = snapped - anchor.startBeat;
        const earliest = Math.min(...[...drag.originals.values()].map((item) => item.startBeat));
        if (earliest + delta < 0) delta = -earliest;
        const dMidi = Math.round(yToMidiFloat(y, state.zoomY, state.scrollY) - yToMidiFloat(drag.originY, state.zoomY, state.scrollY));
        return {
          ...original,
          startBeat: original.startBeat + delta,
          midi: Math.max(0, Math.min(127, original.midi + dMidi)),
        };
      }
      if (drag.kind === "resize-end") {
        const end = snapBeat(original.startBeat + original.durationBeats + raw, state.snapBeats, state.snap);
        return { ...original, durationBeats: Math.max(minDur, end - original.startBeat) };
      }
      let start = snapBeat(original.startBeat + raw, state.snapBeats, state.snap);
      const end = original.startBeat + original.durationBeats;
      if (start < 0) start = 0;
      if (end - start < minDur) start = end - minDur;
      return { ...original, startBeat: start, durationBeats: end - start };
    });
    // Keep notes that were not part of the drag identical to the project, and edited ones replaced.
    const edited = new Map(next.filter((note) => drag.originals.has(note.id)).map((note) => [note.id, note]));
    next = project.notes.map((note) => edited.get(note.id) ?? note);
    previewRef.current = next;
    drag.changed = true;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = drag.kind === "move" ? "grabbing" : "ew-resize";
    draw();
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === "box") {
      useEditor.getState().setSelection(boxSelRef.current ?? drag.base);
      boxSelRef.current = null;
    } else if (drag.kind !== "seek" && drag.changed && previewRef.current) {
      useEditor.getState().updateNotes(previewRef.current, true);
    }
    previewRef.current = null;
    boxSelRef.current = null;
    draw();
  };

  /** Double-click empty space to draw a note into the active track. */
  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    const project = state.project;
    if (!project) return;
    const { x, y } = pointerPos(event);
    if (x < KEY_W || y <= RULER_H) return;
    const audible = audibleTrackIds(project);
    const hit = hitTestNote(
      x,
      y,
      project.notes,
      new Set(state.selection),
      state.zoomX,
      state.zoomY,
      state.scrollX,
      state.scrollY,
      audible,
    );
    if (hit) return;
    const raw = xToBeat(x, state.zoomX, state.scrollX);
    const step = state.snap && state.snapBeats > 0 ? state.snapBeats : 1;
    const startBeat = state.snap ? snapBeat(raw, step, true) : Math.max(0, raw);
    state.addNote({
      trackId: state.activeTrack,
      midi: yToMidi(y, state.zoomY, state.scrollY),
      startBeat,
      durationBeats: state.snap ? step : 0.5,
    });
    dragRef.current = null;
    draw();
  };

  /** Right-click a note to remove it. Muted tracks are ignored, same as selection. */
  const onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    const project = state.project;
    if (!project) return;
    const { x, y } = pointerPos(event);
    if (x < KEY_W || y <= RULER_H) return;
    event.preventDefault();
    const hit = hitTestNote(
      x,
      y,
      project.notes,
      new Set(state.selection),
      state.zoomX,
      state.zoomY,
      state.scrollX,
      state.scrollY,
      audibleTrackIds(project),
    );
    if (!hit) return;
    state.setSelection([]);
    state.deleteNotes([hit.id]);
    draw();
  };

  const project = useEditor((s) => s.project);
  const locale = useEditor((s) => s.locale);
  const zoomX = useEditor((s) => s.zoomX);
  const scrollX = useEditor((s) => s.scrollX);
  const zoomY = useEditor((s) => s.zoomY);
  const scrollY = useEditor((s) => s.scrollY);
  const end = project ? rollLength(project) : 16;
  const viewW = Math.max(1, size.w - KEY_W);
  const contentW = end * zoomX;
  const maxX = Math.max(0, contentW - viewW);
  const thumbW = Math.max(28, maxX ? (viewW / contentW) * viewW : viewW);
  const thumbX = maxX ? (scrollX / maxX) * (viewW - thumbW) : 0;
  const contentH = contentHeight(zoomY);
  const viewH = Math.max(1, size.h - RULER_H);
  const maxY = Math.max(0, contentH - viewH);
  const thumbH = Math.max(28, maxY ? (viewH / contentH) * viewH : viewH);
  const thumbY = maxY ? (scrollY / maxY) * (viewH - thumbH) : 0;

  return (
    <div ref={wrapRef} className="relative h-full min-h-[280px] w-full overflow-hidden bg-[#12141c] outline-none" tabIndex={0}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          if (!dragRef.current) {
            hoverRef.current = null;
            draw();
          }
        }}
      />
      <div className="pointer-events-none absolute bottom-1 left-[62px] right-3 h-2 rounded-full bg-white/5">
        <div
          className="pointer-events-auto h-full rounded-full bg-white/30"
          style={{ width: thumbW, transform: `translateX(${thumbX}px)` }}
          onPointerDown={(event) => {
            event.stopPropagation();
            const start = event.clientX;
            const origin = useEditor.getState().scrollX;
            const move = (ev: PointerEvent) => {
              const dx = ev.clientX - start;
              const ratio = maxX / Math.max(1, viewW - thumbW);
              useEditor.getState().setScroll(origin + dx * ratio, useEditor.getState().scrollY);
              if (engine.playing) useEditor.getState().setFollow(false);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      </div>
      <div className="pointer-events-none absolute top-9 right-1 bottom-4 w-2 rounded-full bg-white/5">
        <div
          className="pointer-events-auto w-full rounded-full bg-white/30"
          style={{ height: thumbH, transform: `translateY(${thumbY}px)` }}
          onPointerDown={(event) => {
            event.stopPropagation();
            const start = event.clientY;
            const origin = useEditor.getState().scrollY;
            const move = (ev: PointerEvent) => {
              const dy = ev.clientY - start;
              const ratio = maxY / Math.max(1, viewH - thumbH);
              useEditor.getState().setScroll(useEditor.getState().scrollX, origin + dy * ratio);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      </div>
      {project && project.notes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[#9c968a]">
          {locale === "zh" ? "双击空白处添加音块" : "Double-click to add a note"}
        </div>
      ) : null}
      <span className="sr-only">{project ? pitchRangeLabel(project.notes.map((note) => note.midi)) : ""}</span>
    </div>
  );
}
