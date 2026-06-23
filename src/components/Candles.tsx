import { useEffect, useMemo, useRef, useState } from "react";
import { MarketAsset, formatMarketPrice } from "../game/markets";
import { MarketPoint } from "../game/types";

type Candle = { open: number; high: number; low: number; close: number; start: number };
type ChartSize = { width: number; height: number };

const CHART_HEIGHT = 220;
/** Fixed wall-clock candle interval. The user asked for ~15-second OHLC candles. */
const BUCKET_MS = 15000;
/** How many fat candles to keep on screen (latest is the live, still-forming one). */
const VISIBLE_CANDLES = 14;
const PRICE_LABEL_GUTTER = 58;

const UP = "#2fd07a";
const DOWN = "#ff5247";
const UP_RGB = "47, 208, 122";
const DOWN_RGB = "255, 82, 71";

/**
 * Bucket ticks into fixed 15s wall-clock OHLC candles. Fewer, fatter candles read as bars,
 * not lines. The final candle is the live, still-forming one (its close tracks the latest
 * tick) and is what the rAF loop animates as the "pressure" candle.
 */
function buildCandles(points: MarketPoint[]): Candle[] {
  if (points.length < 2) return [];
  let ordered = points;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].time < points[index - 1].time) {
      ordered = [...points].sort((a, b) => a.time - b.time);
      break;
    }
  }
  const buckets = new Map<number, Candle>();
  ordered.forEach((point) => {
    const start = Math.floor(point.time / BUCKET_MS) * BUCKET_MS;
    const current = buckets.get(start);
    if (!current) {
      buckets.set(start, { open: point.value, high: point.value, low: point.value, close: point.value, start });
      return;
    }
    current.high = Math.max(current.high, point.value);
    current.low = Math.min(current.low, point.value);
    current.close = point.value;
  });
  return [...buckets.values()].sort((a, b) => a.start - b.start).slice(-VISIBLE_CANDLES);
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export function Candles({
  points,
  entryPrice,
  asset,
  pnlPct,
}: {
  points: MarketPoint[];
  entryPrice: number | null;
  asset: MarketAsset;
  /** Live PnL while a position is open (null when flat). Colors the chart by win/loss. */
  pnlPct: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 320, height: CHART_HEIGHT });

  const candles = useMemo<Candle[]>(() => buildCandles(points), [points]);

  // Live data the rAF loop reads each frame without re-subscribing. Keeps one persistent loop.
  const liveValue = points[points.length - 1]?.value ?? null;
  const frameRef = useRef({
    candles,
    entryPrice,
    asset,
    pnlPct,
    size,
    liveValue,
    // Eased animation state, mutated inside the loop only.
    animClose: liveValue ?? 0,
    velocity: 0, // smoothed price velocity (per second), drives pressure direction + intensity
    pressure: 0, // eased 0..1 pressure magnitude
    pressureDir: 0, // eased signed direction -1..1
    lastTickValue: liveValue ?? 0,
    reduced: prefersReducedMotion(),
  });

  frameRef.current.candles = candles;
  frameRef.current.entryPrice = entryPrice;
  frameRef.current.asset = asset;
  frameRef.current.pnlPct = pnlPct;
  frameRef.current.size = size;
  frameRef.current.liveValue = liveValue;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const next = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!mql) return undefined;
    const onChange = () => {
      frameRef.current.reduced = mql.matches;
    };
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let raf = 0;
    let last = performance.now();
    let lastW = -1;
    let lastH = -1;

    const draw = (now: number) => {
      const state = frameRef.current;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const { width, height } = state.size;
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const targetW = Math.floor(width * ratio);
      const targetH = Math.floor(height * ratio);
      if (canvas.width !== targetW || canvas.height !== targetH || lastW !== width || lastH !== height) {
        canvas.width = targetW;
        canvas.height = targetH;
        lastW = width;
        lastH = height;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const series = state.candles;
      if (series.length < 1 || state.liveValue == null) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const reduced = state.reduced;
      const live = state.liveValue;

      // --- Animate the forming candle's close + pressure toward the live value ---
      if (reduced) {
        state.animClose = live;
        state.velocity = 0;
        state.pressure = 0;
        state.pressureDir = 0;
      } else {
        // Instantaneous velocity from the last seen tick value (per second), then smooth it.
        const rawVel = dt > 0 ? (live - state.lastTickValue) / dt : 0;
        // Reference scale for normalizing velocity into 0..1 pressure (% of price per second).
        const scale = Math.max(1e-6, Math.abs(live) * 0.6);
        const targetVel = rawVel;
        // Smooth velocity (exponential), framerate-independent.
        const velK = 1 - Math.exp(-dt * 6);
        state.velocity += (targetVel - state.velocity) * velK;

        // Ease the displayed close toward the live price (grows/shrinks smoothly).
        const closeK = 1 - Math.exp(-dt * 9);
        state.animClose += (live - state.animClose) * closeK;

        // Pressure magnitude + direction, eased.
        const normVel = Math.max(-1, Math.min(1, state.velocity / scale));
        const targetPressure = Math.min(1, Math.abs(normVel));
        const targetDir = state.velocity > 0 ? 1 : state.velocity < 0 ? -1 : 0;
        const pK = 1 - Math.exp(-dt * 5);
        state.pressure += (targetPressure - state.pressure) * pK;
        state.pressureDir += (targetDir - state.pressureDir) * (1 - Math.exp(-dt * 8));
      }
      state.lastTickValue = live;

      const chartWidth = Math.max(80, width - PRICE_LABEL_GUTTER);
      const chartHeight = height;

      // Use the eased close for the live candle so the whole chart breathes with it.
      const lastCandle = series[series.length - 1];
      const displayClose = reduced ? live : state.animClose;
      const liveHigh = Math.max(lastCandle.high, displayClose);
      const liveLow = Math.min(lastCandle.low, displayClose);

      // --- Price range (include entry + animated extremes so lines stay visible) ---
      let min = series[0].low;
      let max = series[0].high;
      for (const c of series) {
        min = Math.min(min, c.low);
        max = Math.max(max, c.high);
      }
      min = Math.min(min, liveLow, displayClose);
      max = Math.max(max, liveHigh, displayClose);
      if (state.entryPrice != null) {
        min = Math.min(min, state.entryPrice);
        max = Math.max(max, state.entryPrice);
      }
      const pad = Math.max(0.001, (max - min) * 0.12);
      min -= pad;
      max += pad;
      const range = Math.max(0.001, max - min);
      const y = (value: number) => chartHeight - ((value - min) / range) * chartHeight;

      const pnl = state.pnlPct;
      const winning = pnl != null && pnl >= 0;
      const losing = pnl != null && pnl < 0;
      const liveColor = winning ? UP : losing ? DOWN : state.asset.accent;

      // Win/loss wash behind everything.
      if (pnl != null) {
        const wash = ctx.createLinearGradient(0, 0, 0, chartHeight);
        const tint = winning ? UP_RGB : DOWN_RGB;
        wash.addColorStop(0, `rgba(${tint}, ${winning ? 0.14 : 0.05})`);
        wash.addColorStop(1, `rgba(${tint}, ${winning ? 0.05 : 0.14})`);
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, chartWidth, chartHeight);
      }

      // Minimal horizontal guides + right-gutter price labels.
      ctx.save();
      ctx.lineWidth = 1;
      ctx.font = "11px IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const guideValues = [max - pad * 0.5, (min + max) / 2, min + pad * 0.5];
      guideValues.forEach((value) => {
        const yy = Math.max(10, Math.min(chartHeight - 10, y(value)));
        const crispY = Math.round(yy) + 0.5;
        ctx.strokeStyle = "rgba(244, 244, 245, 0.05)";
        ctx.beginPath();
        ctx.moveTo(0, crispY);
        ctx.lineTo(chartWidth, crispY);
        ctx.stroke();
        ctx.fillStyle = "rgba(244, 244, 245, 0.4)";
        ctx.fillText(formatMarketPrice(value, state.asset), width - 8, crispY);
      });

      // --- Fat candles, packed tight to fill the width ---
      const slot = chartWidth / series.length;
      const bodyW = Math.max(8, slot * 0.8); // fat: ~80% of the slot
      const drawCandle = (open: number, high: number, low: number, close: number, cx: number, isLive: boolean) => {
        const up = close >= open;
        const color = up ? UP : DOWN;
        const bodyTop = y(Math.max(open, close));
        const bodyBottom = y(Math.min(open, close));
        const bodyHeight = Math.max(2, bodyBottom - bodyTop);

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = isLive ? 1 : 0.9;
        ctx.shadowColor = isLive ? color : "transparent";
        ctx.shadowBlur = isLive ? 14 : 0;
        // Wick.
        ctx.lineWidth = Math.max(1.5, bodyW * 0.14);
        ctx.beginPath();
        ctx.moveTo(cx, y(high));
        ctx.lineTo(cx, y(low));
        ctx.stroke();
        // Body.
        ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      };

      series.forEach((c, index) => {
        const cx = Math.round(index * slot + slot / 2) + 0.5;
        const isLive = index === series.length - 1;
        if (isLive) {
          drawCandle(c.open, liveHigh, liveLow, displayClose, cx, true);
        } else {
          drawCandle(c.open, c.high, c.low, c.close, cx, false);
        }
      });

      // --- LIVE PRESSURE: glowing aura + directional charge wedge on the forming candle ---
      const liveCx = (series.length - 1) * slot + slot / 2;
      const liveTop = y(Math.max(lastCandle.open, displayClose));
      const liveBottom = y(Math.min(lastCandle.open, displayClose));
      const dirUp = (reduced ? displayClose >= lastCandle.open : state.pressureDir >= 0);
      const pColor = dirUp ? UP : DOWN;
      const pRgb = dirUp ? UP_RGB : DOWN_RGB;
      const pressure = reduced ? 0 : state.pressure;

      if (!reduced && pressure > 0.01) {
        // Pulsing aura around the live candle, intensity scales with pressure.
        const pulse = 0.5 + 0.5 * Math.sin(now / 220);
        const auraR = bodyW * (1.1 + pressure * 1.6);
        const auraCy = (liveTop + liveBottom) / 2;
        const aura = ctx.createRadialGradient(liveCx, auraCy, bodyW * 0.3, liveCx, auraCy, auraR);
        const auraA = (0.12 + pressure * 0.4) * (0.7 + 0.3 * pulse);
        aura.addColorStop(0, `rgba(${pRgb}, ${auraA.toFixed(3)})`);
        aura.addColorStop(1, `rgba(${pRgb}, 0)`);
        ctx.fillStyle = aura;
        ctx.fillRect(liveCx - auraR, auraCy - auraR, auraR * 2, auraR * 2);

        // Directional charge fill: a thin vertical bar to the right of the live candle that
        // fills from the candle's mid toward the direction of pressure, length = intensity.
        const barX = Math.round(liveCx + bodyW / 2 + 4);
        const barW = 4;
        const chargeLen = (chartHeight * 0.18) * pressure;
        const baseY = auraCy;
        const tipY = dirUp ? baseY - chargeLen : baseY + chargeLen;
        const charge = ctx.createLinearGradient(0, baseY, 0, tipY);
        charge.addColorStop(0, `rgba(${pRgb}, ${(0.85 * (0.6 + 0.4 * pulse)).toFixed(3)})`);
        charge.addColorStop(1, `rgba(${pRgb}, 0)`);
        ctx.fillStyle = charge;
        ctx.fillRect(barX, Math.min(baseY, tipY), barW, Math.abs(chargeLen));

        // Directional wedge at the tip pointing the way price is being pushed.
        const wedge = 5 + pressure * 4;
        ctx.fillStyle = `rgba(${pRgb}, ${(0.9 * (0.6 + 0.4 * pulse)).toFixed(3)})`;
        ctx.beginPath();
        if (dirUp) {
          ctx.moveTo(barX + barW / 2, tipY - wedge);
          ctx.lineTo(barX + barW / 2 - wedge, tipY);
          ctx.lineTo(barX + barW / 2 + wedge, tipY);
        } else {
          ctx.moveTo(barX + barW / 2, tipY + wedge);
          ctx.lineTo(barX + barW / 2 - wedge, tipY);
          ctx.lineTo(barX + barW / 2 + wedge, tipY);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Entry line: gold, dashed, tagged.
      if (state.entryPrice != null) {
        const entryY = Math.round(y(state.entryPrice)) + 0.5;
        ctx.strokeStyle = "rgba(255, 197, 61, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, entryY);
        ctx.lineTo(chartWidth, entryY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(10, 11, 12, 0.85)";
        ctx.fillRect(2, entryY - 8, 46, 15);
        ctx.fillStyle = "#ffc53d";
        ctx.textAlign = "left";
        ctx.font = "700 10px IBM Plex Mono, ui-monospace, monospace";
        ctx.fillText("ENTRY", 6, entryY);
      }

      // Live price line + glowing marker dot, colored by win/loss. Tracks the latest tick value.
      const liveY = Math.round(y(live)) + 0.5;
      ctx.strokeStyle = liveColor;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, liveY);
      ctx.lineTo(chartWidth, liveY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = liveColor;
      ctx.shadowColor = liveColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(liveCx, liveY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Live price label chip on the right gutter.
      ctx.fillStyle = liveColor;
      ctx.fillRect(chartWidth + 2, liveY - 9, PRICE_LABEL_GUTTER - 4, 18);
      ctx.fillStyle = "#0a0b0c";
      ctx.font = "700 10px IBM Plex Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatMarketPrice(live, state.asset), width - 6, liveY);

      // Live PnL badge near the marker so the number reads straight off the chart.
      if (pnl != null) {
        const label = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`;
        ctx.font = "700 12px IBM Plex Mono, ui-monospace, monospace";
        const w = ctx.measureText(label).width + 12;
        const bx = Math.min(chartWidth - w - 4, Math.max(4, liveCx - w / 2));
        const by = Math.max(4, liveY - 26);
        ctx.fillStyle = liveColor;
        ctx.fillRect(bx, by, w, 18);
        ctx.fillStyle = "#0a0b0c";
        ctx.textAlign = "center";
        ctx.fillText(label, bx + w / 2, by + 9);
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const latest = points[points.length - 1]?.value;
  const ariaLabel = latest
    ? `${asset.displayPair} paper candles. Latest mark ${formatMarketPrice(latest, asset)}.`
    : `${asset.displayPair} paper candles loading.`;

  return <canvas ref={canvasRef} className="candles" height={CHART_HEIGHT} role="img" aria-label={ariaLabel} />;
}
