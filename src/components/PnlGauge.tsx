/**
 * Semicircular PnL dial, inspired by Roach Racing Club's position multiplier.
 * The lit arc tracks the magnitude of live (or realized) PnL; color is green in
 * profit, red in loss, muted when flat. Center reads the signed PnL % and leverage.
 */
export function PnlGauge({
  pnlPct,
  active,
  subLabel,
}: {
  pnlPct: number;
  active: boolean;
  subLabel: string;
}) {
  const FULL_SCALE = 0.12; // ~0.12% PnL fills the dial (raw moves, no leverage).
  const ratio = Math.max(0, Math.min(1, Math.abs(pnlPct) / FULL_SCALE));
  const TICKS = 28;
  const lit = Math.round(ratio * TICKS);

  const color = !active ? "#71717a" : pnlPct > 0 ? "#b7ff4a" : pnlPct < 0 ? "#ff5370" : "#6dd6ff";
  const cx = 100;
  const cy = 104;
  const rInner = 64;
  const rOuter = 84;

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
            stroke={t.on ? color : "#2b2d30"}
            strokeWidth={3}
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
