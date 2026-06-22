/**
 * Device-aware quality tiers. Everything performance-sensitive (pixel ratio, shadows,
 * crowd density, particle budget) reads from one QualitySettings object so the whole
 * scene scales from a low-end phone to a desktop without per-call guards.
 */

export type QualityTier = "low" | "medium" | "high";

export type QualitySettings = {
  tier: QualityTier;
  isMobile: boolean;
  /** Hard cap on renderer pixel ratio (the biggest single perf lever). */
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** Crowd: concentric instanced rings x seats per ring. */
  seatRings: number;
  seatsPerRing: number;
  /** Pooled particle budget for goal celebrations. */
  particleCount: number;
  /** Enable the cheap additive-glow "bloom" pass. */
  glow: boolean;
};

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const ua = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return coarse || ua;
}

const PRESETS: Record<QualityTier, Omit<QualitySettings, "tier" | "isMobile">> = {
  low: {
    pixelRatioCap: 1.5,
    shadows: false,
    shadowMapSize: 1024,
    antialias: false,
    seatRings: 2,
    seatsPerRing: 48,
    particleCount: 48,
    glow: false,
  },
  medium: {
    pixelRatioCap: 1.75,
    shadows: true,
    shadowMapSize: 1024,
    antialias: true,
    seatRings: 3,
    seatsPerRing: 72,
    particleCount: 96,
    glow: true,
  },
  high: {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    antialias: true,
    seatRings: 4,
    seatsPerRing: 96,
    particleCount: 160,
    glow: true,
  },
};

export function detectQuality(): QualitySettings {
  const mobile = isMobileDevice();
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;

  let tier: QualityTier;
  if (mobile) tier = cores >= 8 ? "medium" : "low";
  else tier = cores >= 8 ? "high" : "medium";

  return { tier, isMobile: mobile, ...PRESETS[tier] };
}

/** One step down, for the adaptive fallback when frame time runs long. */
export function downgrade(settings: QualitySettings): QualitySettings {
  const order: QualityTier[] = ["high", "medium", "low"];
  const next = order[Math.min(order.length - 1, order.indexOf(settings.tier) + 1)];
  if (next === settings.tier) return settings;
  return { tier: next, isMobile: settings.isMobile, ...PRESETS[next] };
}
