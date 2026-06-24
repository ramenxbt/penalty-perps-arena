/**
 * Semicircular PnL dial, inspired by Roach Racing Club's position multiplier.
 * The lit arc tracks the magnitude of live (or realized) PnL; color is pitch green in
 * profit, red in loss, teal when flat. Center reads the signed PnL % and leverage.
 *
 * Full-scale is derived from RULES.tiers (GAUGE_FULL_SCALE), so the dial, the power meter,
 * and the shot thresholds all speak the same +4 / +15 / +40 scale and a tiny move never
 * pins the dial to full. Tier markers show where each shot is earned.
 */
import { GAUGE_FULL_SCALE, SHOT_TIERS } from "../game/engine";

export function PnlGauge({
  pnlPct,
  active,
  subLabel,
}: {
  pnlPct: number;
  active: boolean;
  subLabel: string;
}) {
  const ratio = Math.max(0, Math.min(1, Math.abs(pnlPct) / GAUGE_FULL_SCALE));
  const TICKS = 28;
  const lit = Math.round(ratio * TICKS);

  const color = !active
    ? "var(--text-dim)"
    : pnlPct > 0
      ? "var(--green)"
      : pnlPct < 0
        ? "var(--red)"
        : "var(--cyan)";
  const cx = 100;
  const cy = 104;
  const rInner = 64;
  const rOuter = 84;
  const rTier = 90;

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = Math.PI - (i / (TICKS - 1)) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      key: i,
      x1: cx + rInner * cos,
      y1: cy - rInner * sin,
      x2: cx + rOuter * cos,
      y2: cy - rOuter * sin,
      on: active && i < lit,
    };
  });

  // Tier markers along the arc at each shot threshold, so the dial shows where shots land.
  const tierMarks = SHOT_TIERS.map((tier) => {
    const tierRatio = Math.max(0, Math.min(1, tier.minPnl / GAUGE_FULL_SCALE));
    const angle = Math.PI - tierRatio * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      key: tier.minPnl,
      reached: active && pnlPct >= tier.minPnl,
      x1: cx + rInner * cos,
      y1: cy - rInner * sin,
      x2: cx + rTier * cos,
      y2: cy - rTier * sin,
    };
  });

  const label = active ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "FLAT";

  return (
    <div className="gauge">
      <svg viewBox="0 0 200 116" role="img" aria-label={`PnL ${label}`}>
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.on ? color : "var(--line)"}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
        {tierMarks.map((m) => (
          <line
            key={m.key}
            x1={m.x1}
            y1={m.y1}
            x2={m.x2}
            y2={m.y2}
            className={"gauge-tier" + (m.reached ? " reached" : "")}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
        <text x={cx} y={cy - 26} className="gauge-mult" textAnchor="middle" fill={color}>
          {label}
        </text>
        <text x={cx} y={cy - 8} className="gauge-sub" textAnchor="middle">
          {subLabel}
        </text>
      </svg>
    </div>
  );
}
