import { useEffect, useMemo, useRef, useState } from "react";
import { MarketAsset, formatMarketPrice } from "../game/markets";
import { MarketPoint } from "../game/types";

type Candle = { open: number; high: number; low: number; close: number };
type ChartSize = { width: number; height: number };

const CHART_HEIGHT = 150;
const TARGET_CANDLES = 34;
const PRICE_LABEL_GUTTER = 52;

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
      buckets.set(bucket, {
        open: point.value,
        high: point.value,
        low: point.value,
        close: point.value,
      });
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
}: {
  points: MarketPoint[];
  entryPrice: number | null;
  asset: MarketAsset;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 320, height: CHART_HEIGHT });

  const candles = useMemo<Candle[]>(() => {
    return buildCandles(points, TARGET_CANDLES);
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const next = {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      setSize((current) => {
        if (current.width === next.width && current.height === next.height) return current;
        return next;
      });
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
    let min = entryPrice ?? candles[0].low;
    let max = entryPrice ?? candles[0].high;
    for (const candle of candles) {
      min = Math.min(min, candle.low);
      max = Math.max(max, candle.high);
    }
    const pad = Math.max(0.001, (max - min) * 0.12);
    min -= pad;
    max += pad;
    const range = Math.max(0.001, max - min);
    const y = (value: number) => chartHeight - ((value - min) / range) * chartHeight;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(244, 244, 245, 0.06)";
    ctx.fillStyle = "rgba(244, 244, 245, 0.48)";
    ctx.font = "10px IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const gridValues = [max - pad, (min + max) / 2, min + pad];
    gridValues.forEach((value) => {
      const yy = Math.max(10, Math.min(chartHeight - 10, y(value)));
      ctx.beginPath();
      const crispY = Math.round(yy) + 0.5;
      ctx.moveTo(0, crispY);
      ctx.lineTo(chartWidth, crispY);
      ctx.stroke();
      ctx.fillText(formatMarketPrice(value, asset), size.width - 8, crispY);
    });

    const slot = chartWidth / candles.length;
    const bodyW = Math.max(3, Math.min(12, slot * 0.58));

    candles.forEach((c, index) => {
      const cx = Math.round(index * slot + slot / 2) + 0.5;
      const up = c.close >= c.open;
      const color = up ? asset.accent : "#ff5370";
      const bodyTop = y(Math.max(c.open, c.close));
      const bodyBottom = y(Math.min(c.open, c.close));
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.94;
      ctx.beginPath();
      ctx.moveTo(cx, y(c.high));
      ctx.lineTo(cx, y(c.low));
      ctx.stroke();
      ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
    });

    if (entryPrice != null && entryPrice >= min && entryPrice <= max) {
      const entryY = y(entryPrice);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(109, 214, 255, 0.78)";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(0, entryY);
      ctx.lineTo(chartWidth, entryY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(109, 214, 255, 0.9)";
      ctx.textAlign = "right";
      ctx.fillText(formatMarketPrice(entryPrice, asset), size.width - 8, entryY);
    }

    ctx.restore();
  }, [asset, candles, entryPrice, size.height, size.width]);

  const latest = points[points.length - 1]?.value;
  const ariaLabel = latest
    ? `${asset.displayPair} paper candles. Latest mark ${formatMarketPrice(latest, asset)}.`
    : `${asset.displayPair} paper candles loading.`;

  return (
    <canvas
      ref={canvasRef}
      className="candles"
      height={CHART_HEIGHT}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
