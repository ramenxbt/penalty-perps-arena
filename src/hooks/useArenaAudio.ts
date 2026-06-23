import { useCallback, useEffect, useRef, useState } from "react";
import { RoundOutcome, RoundPhase, Shooter } from "../game/types";
import { arrangeShooters, SHOT_BEAT_MS, visibleVolleyAttempts, VOLLEY_LEAD_IN_MS } from "../game/volley";

const STORAGE_KEY = "penalty-perps-audio";

type ToneOptions = {
  frequency: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
  delay?: number;
};

function readAudioPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeAudioPreference(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Browsers can block storage in privacy-restricted contexts; audio still works for the session.
  }
}

export function useArenaAudio(phase: RoundPhase, outcome: RoundOutcome | null, shooters: Shooter[]) {
  const [enabled, setEnabled] = useState(readAudioPreference);
  const contextRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<number[]>([]);
  const lastPhaseRef = useRef<RoundPhase>(phase);
  const lastOutcomeRef = useRef<RoundOutcome | null>(null);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const getContext = useCallback(() => {
    if (!enabled) return null;
    const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      contextRef.current ??= new AudioCtor();
      void contextRef.current.resume().catch(() => {});
      return contextRef.current;
    } catch {
      return null;
    }
  }, [enabled]);

  const tone = useCallback(
    ({ frequency, duration, gain = 0.08, type = "sine", delay = 0 }: ToneOptions) => {
      const ctx = getContext();
      if (!ctx) return;
      const start = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.04);
    },
    [getContext],
  );

  const noise = useCallback(
    (duration: number, gain = 0.04, delay = 0) => {
      const ctx = getContext();
      if (!ctx) return;
      const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
      }
      const source = ctx.createBufferSource();
      const envelope = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const start = ctx.currentTime + delay;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(950, start);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(gain, start + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(ctx.destination);
      source.start(start);
      source.stop(start + duration + 0.04);
    },
    [getContext],
  );

  const playWhistle = useCallback(() => {
    tone({ frequency: 1080, duration: 0.08, gain: 0.055, type: "triangle" });
    tone({ frequency: 860, duration: 0.12, gain: 0.045, type: "triangle", delay: 0.09 });
  }, [tone]);

  const playClose = useCallback(() => {
    tone({ frequency: 92, duration: 0.14, gain: 0.11, type: "sine" });
    tone({ frequency: 148, duration: 0.09, gain: 0.055, type: "square", delay: 0.03 });
  }, [tone]);

  // A bright rising blip when the player crosses into a higher shot tier.
  const playTick = useCallback(() => {
    tone({ frequency: 660, duration: 0.06, gain: 0.05, type: "square" });
    tone({ frequency: 990, duration: 0.08, gain: 0.045, type: "square", delay: 0.05 });
  }, [tone]);

  const setAudioEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    writeAudioPreference(next);
    if (!next) void contextRef.current?.suspend().catch(() => {});
  }, []);

  useEffect(() => {
    clearTimers();
    if (!enabled || phase !== "resolving" || lastPhaseRef.current === "resolving") {
      lastPhaseRef.current = phase;
      return;
    }

    visibleVolleyAttempts(arrangeShooters(shooters)).forEach((attempt, index) => {
      const timer = window.setTimeout(() => {
        if (attempt.noKick) {
          tone({ frequency: 110, duration: 0.16, gain: 0.035, type: "sawtooth" });
          return;
        }
        tone({ frequency: 76, duration: 0.09, gain: 0.13, type: "sine" });
        tone({ frequency: attempt.scored ? 520 : 220, duration: 0.14, gain: 0.035, type: "triangle", delay: 0.08 });
        if (attempt.scored) noise(0.32, 0.035, 0.12);
      }, VOLLEY_LEAD_IN_MS + index * SHOT_BEAT_MS);
      timersRef.current.push(timer);
    });
    lastPhaseRef.current = phase;
  }, [clearTimers, enabled, noise, phase, shooters, tone]);

  useEffect(() => {
    if (!enabled || phase !== "settled" || !outcome || lastOutcomeRef.current === outcome) return;
    lastOutcomeRef.current = outcome;
    if (outcome.goals > 0) {
      noise(0.85, 0.065);
      tone({ frequency: 392, duration: 0.11, gain: 0.045, type: "triangle" });
      tone({ frequency: 587, duration: 0.16, gain: 0.045, type: "triangle", delay: 0.12 });
      tone({ frequency: 784, duration: 0.2, gain: 0.04, type: "triangle", delay: 0.28 });
    } else {
      tone({ frequency: 180, duration: 0.18, gain: 0.055, type: "sine" });
      tone({ frequency: 130, duration: 0.22, gain: 0.04, type: "sine", delay: 0.12 });
    }
  }, [enabled, noise, outcome, phase, tone]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    enabled,
    setEnabled: setAudioEnabled,
    unlock: getContext,
    playWhistle,
    playClose,
    playTick,
  };
}
