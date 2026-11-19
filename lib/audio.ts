import { isAudible } from "./tracks";
import { beatToSeconds, notesEndBeat, scaleTempos, secondsToBeat } from "./timing";
import type { NoteEvent, ScoreProject, TempoPoint, Track } from "./types";

type Listener = (beat: number, playing: boolean) => void;

/** requestAnimationFrame is absent outside the browser (tests, server render). */
function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return 0;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
}

interface LiveVoice {
  oscs: OscillatorNode[];
  gains: GainNode[];
}

/**
 * Piano-like Web Audio voice. Every choir part and the accompaniment
 * share this timbre so the export really is "each voice, played on piano".
 */
export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private trackGains = new Map<string, GainNode>();
  private voices: LiveVoice[] = [];
  private tempos: TempoPoint[] = [{ beat: 0, bpm: 120 }];
  private originTime = 0;
  private originSec = 0;
  private until = Number.POSITIVE_INFINITY;
  private frame = 0;
  private listeners = new Set<Listener>();
  playhead = 0;
  playing = false;

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener(this.playhead, this.playing);
  }

  private async context(): Promise<AudioContext> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === "suspended") {
      await Promise.race([
        this.ctx.resume().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);
    }
    return this.ctx;
  }

  private gainFor(id: string): GainNode {
    let node = this.trackGains.get(id);
    if (!node) {
      node = this.ctx!.createGain();
      node.connect(this.master!);
      this.trackGains.set(id, node);
    }
    return node;
  }

  setMix(tracks: Track[]) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const track of tracks) {
      const node = this.gainFor(track.id);
      const value = isAudible(track, tracks) ? track.volume : 0;
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(value, now, 0.02);
    }
  }

  currentBeat(): number {
    if (!this.playing || !this.ctx) return this.playhead;
    const elapsed = this.ctx.currentTime - this.originTime;
    if (elapsed < 0) return this.playhead;
    return secondsToBeat(this.originSec + elapsed, this.tempos);
  }

  async play(project: ScoreProject, fromBeat: number, tempoScale: number, onlyIds?: Set<string>) {
    const ctx = await this.context();
    this.stopVoices();
    this.tempos = scaleTempos(project.tempos, tempoScale);
    const startBeat = Math.max(0, fromBeat);
    const endBeat = onlyIds
      ? project.notes.reduce((max, note) => (onlyIds.has(note.id) ? Math.max(max, note.startBeat + note.durationBeats) : max), startBeat)
      : Math.max(startBeat + 0.5, notesEndBeat(project));
    this.until = endBeat + 0.02;
    this.playhead = startBeat;
    this.originSec = beatToSeconds(startBeat, this.tempos);
    this.originTime = ctx.currentTime + 0.06;
    this.playing = true;
    for (const note of project.notes) {
      if (onlyIds && !onlyIds.has(note.id)) continue;
      this.schedule(note);
    }
    this.emit();
    cancelFrame(this.frame);
    const tick = () => {
      if (!this.playing) return;
      const beat = this.currentBeat();
      this.playhead = beat;
      if (beat >= this.until) {
        this.playing = false;
        this.playhead = this.until;
        this.emit();
        return;
      }
      this.emit();
      this.frame = requestFrame(tick);
    };
    this.frame = requestFrame(tick);
  }

  pause() {
    if (!this.ctx) return;
    this.playhead = this.playing ? this.currentBeat() : this.playhead;
    this.playing = false;
    cancelFrame(this.frame);
    this.stopVoices();
    this.emit();
  }

  stop() {
    this.playing = false;
    this.playhead = 0;
    cancelFrame(this.frame);
    this.stopVoices();
    this.emit();
  }

  seek(beat: number, project: ScoreProject | null, tempoScale: number, onlyIds?: Set<string>) {
    const next = Math.max(0, beat);
    if (this.playing && project) {
      void this.play(project, next, tempoScale, onlyIds);
      return;
    }
    this.playhead = next;
    this.emit();
  }

  private schedule(note: NoteEvent) {
    const ctx = this.ctx;
    if (!ctx) return;
    const startSec = beatToSeconds(note.startBeat, this.tempos);
    const endSec = beatToSeconds(note.startBeat + note.durationBeats, this.tempos);
    if (endSec <= this.originSec) return;
    let when = this.originTime + (startSec - this.originSec);
    let duration = Math.max(0.06, endSec - startSec);
    if (when < ctx.currentTime) {
      duration -= ctx.currentTime - when;
      when = ctx.currentTime + 0.01;
      if (duration < 0.05) return;
    }
    this.trigger(note.trackId, when, note.midi, duration, Math.max(0.08, Math.min(1, (note.velocity || 90) / 110)));
  }

  private trigger(trackId: string, time: number, midi: number, duration: number, velocity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const dest = this.gainFor(trackId);
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(Math.min(7200, freq * 7 + 400), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(280, freq * 2.2), time + Math.min(0.4, duration));
    filter.connect(dest);

    const partials = [
      { ratio: 1, amp: 1, type: "triangle" as OscillatorType },
      { ratio: 2, amp: 0.34, type: "sine" as OscillatorType },
      { ratio: 3, amp: 0.16, type: "sine" as OscillatorType },
      { ratio: 4.01, amp: 0.07, type: "sine" as OscillatorType },
    ];
    const voice: LiveVoice = { oscs: [], gains: [] };
    const release = 0.35 + Math.max(0, (72 - midi) / 90);
    const stopAt = time + duration + release;
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(freq * partial.ratio, time);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 6, time);
      const gain = ctx.createGain();
      const peak = 0.1 * velocity * partial.amp * (midi > 84 ? 0.75 : 1);
      const attack = time + 0.007;
      const decay = time + Math.min(0.18, Math.max(0.03, duration * 0.35));
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), attack);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.38), Math.max(decay, attack + 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(time);
      osc.stop(stopAt + 0.02);
      voice.oscs.push(osc);
      voice.gains.push(gain);
    }
    this.voices.push(voice);
    const cleanup = () => {
      this.voices = this.voices.filter((item) => item !== voice);
    };
    voice.oscs[0]?.addEventListener("ended", cleanup);
  }

  private stopVoices() {
    const ctx = this.ctx;
    if (!ctx) {
      this.voices = [];
      return;
    }
    const now = ctx.currentTime;
    for (const voice of this.voices) {
      for (const gain of voice.gains) {
        try {
          gain.gain.cancelScheduledValues(now);
          const current = Math.max(0.0001, gain.gain.value || 0.0001);
          gain.gain.setValueAtTime(current, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        } catch {
          /* already stopped */
        }
      }
      for (const osc of voice.oscs) {
        try {
          osc.stop(now + 0.04);
        } catch {
          /* already stopped */
        }
      }
    }
    this.voices = [];
  }
}

export const engine = new PlaybackEngine();
