import { useEffect, useMemo, useRef, useState } from "react";
import { MarketAsset, formatMarketPrice } from "../game/markets";
import { MarketPoint } from "../game/types";

type Candle = { open: number; high: number; low: number; close: number };
type ChartSize = { width: number; height: number };

const CHART_HEIGHT = 220;
const TARGET_CANDLES = 48;
const PRICE_LABEL_GUTTER = 58;

const UP = "#2fd07a";
const DOWN = "#ff5247";

function buildCandles(points: MarketPoint[], target: number): Candle[] {
  if (points.length < 2) return [];
  let ordered = points;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].time < points[index - 1].time) {
      ordered = [...points].sort((a, b) => a.time - b.time);
      break;
    }
  }
  const firstTime = ordered[0]?.time ?? 0;
  const lastTime = ordered[ordered.length - 1]?.time ?? firstTime;
  const bucketMs = Math.max(1, Math.ceil((lastTime - firstTime + 1) / target));
  const buckets = new Map<number, Candle>();

  ordered.forEach((point) => {
    const bucket = Math.floor((point.time - firstTime) / bucketMs);
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { open: point.value, high: point.value, low: point.value, close: point.value });
      return;
    }
    current.high = Math.max(current.high, point.value);
    current.low = Math.min(current.low, point.value);
    current.close = point.value;
  });

  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, candle]) => candle).slice(-target);
}

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

  const candles = useMemo<Candle[]>(() => buildCandles(points, TARGET_CANDLES), [points]);

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (candles.length < 2) return;

    const chartWidth = Math.max(80, size.width - PRICE_LABEL_GUTTER);
    const chartHeight = size.height;
    const current = candles[candles.length - 1].close;

    // Range includes the entry and the live price so both lines are always visible.
    let min = candles[0].low;
    let max = candles[0].high;
    for (const candle of candles) {
      min = Math.min(min, candle.low);
      max = Math.max(max, candle.high);
    }
    if (entryPrice != null) {
      min = Math.min(min, entryPrice);
      max = Math.max(max, entryPrice);
    }
    const pad = Math.max(0.001, (max - min) * 0.1);
    min -= pad;
    max += pad;
    const range = Math.max(0.001, max - min);
    const y = (value: number) => chartHeight - ((value - min) / range) * chartHeight;

    const winning = pnlPct != null && pnlPct >= 0;
    const losing = pnlPct != null && pnlPct < 0;
    const liveColor = winning ? UP : losing ? DOWN : asset.accent;

    // Win/loss wash: a soft vertical tint so the whole chart reads green when you are up,
    // red when you are down. Subtle, behind everything.
    if (pnlPct != null) {
      const wash = ctx.createLinearGradient(0, 0, 0, chartHeight);
      const tint = winning ? "47, 208, 122" : "255, 82, 71";
      wash.addColorStop(0, `rgba(${tint}, ${winning ? 0.14 : 0.05})`);
      wash.addColorStop(1, `rgba(${tint}, ${winning ? 0.05 : 0.14})`);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, chartWidth, chartHeight);
    }

    // Minimal horizontal guides (no busy grid) + right-gutter price labels.
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
      ctx.fillText(formatMarketPrice(value, asset), size.width - 8, crispY);
    });

    // Candles: packed tight to fill the width, with a soft glow on the most recent one.
    const slot = chartWidth / candles.length;
    const bodyW = Math.max(3, Math.min(18, slot * 0.7));
    candles.forEach((c, index) => {
      const cx = Math.round(index * slot + slot / 2) + 0.5;
      const up = c.close >= c.open;
      const color = up ? UP : DOWN;
      const bodyTop = y(Math.max(c.open, c.close));
      const bodyBottom = y(Math.min(c.open, c.close));
      const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
      const isLatest = index === candles.length - 1;

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = isLatest ? 1 : 0.92;
      ctx.shadowColor = isLatest ? color : "transparent";
      ctx.shadowBlur = isLatest ? 12 : 0;
      // Wick.
      ctx.lineWidth = Math.max(1, bodyW * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx, y(c.high));
      ctx.lineTo(cx, y(c.low));
      ctx.stroke();
      // Body.
      ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    // Entry line: gold, dashed, tagged. The gap between this and the live line IS the profit.
    if (entryPrice != null) {
      const entryY = Math.round(y(entryPrice)) + 0.5;
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

    // Live price line + glowing marker dot, colored by win/loss.
    const liveY = Math.round(y(current)) + 0.5;
    const lastX = (candles.length - 1) * slot + slot / 2;
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
    ctx.arc(lastX, liveY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Live price label chip on the right gutter.
    ctx.fillStyle = liveColor;
    ctx.fillRect(chartWidth + 2, liveY - 9, PRICE_LABEL_GUTTER - 4, 18);
    ctx.fillStyle = "#0a0b0c";
    ctx.font = "700 10px IBM Plex Mono, ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatMarketPrice(current, asset), size.width - 6, liveY);

    // Live PnL badge near the marker so the number is read straight off the chart.
    if (pnlPct != null) {
      const label = `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
      ctx.font = "700 12px IBM Plex Mono, ui-monospace, monospace";
      const w = ctx.measureText(label).width + 12;
      const bx = Math.min(chartWidth - w - 4, Math.max(4, lastX - w / 2));
      const by = Math.max(4, liveY - 26);
      ctx.fillStyle = liveColor;
      ctx.fillRect(bx, by, w, 18);
      ctx.fillStyle = "#0a0b0c";
      ctx.textAlign = "center";
      ctx.fillText(label, bx + w / 2, by + 9);
    }

    ctx.restore();
  }, [asset, candles, entryPrice, pnlPct, size.height, size.width]);

  const latest = points[points.length - 1]?.value;
  const ariaLabel = latest
    ? `${asset.displayPair} paper candles. Latest mark ${formatMarketPrice(latest, asset)}.`
    : `${asset.displayPair} paper candles loading.`;

  return <canvas ref={canvasRef} className="candles" height={CHART_HEIGHT} role="img" aria-label={ariaLabel} />;
}
