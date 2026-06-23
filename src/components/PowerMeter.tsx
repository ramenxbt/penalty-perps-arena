/**
 * Live "Shot Power" readout shown while a trade is open. Turns the hidden PnL-to-shots
 * tiers into a visible, growing bar so the player can watch their reward climb and chase
 * the next threshold. The big shots number re-mounts on change (keyed) to pop on a
 * tier cross. This is the dopamine of the trade: see what you would bank right now.
 */

import { RULES } from "../game/engine";

// Same mapping the hook uses for powerRatio, so ticks line up with the fill.
const POWER_MIN = -0.05;
const POWER_MAX = 0.1;
const toPct = (pnl: number) => ((pnl - POWER_MIN) / (POWER_MAX - POWER_MIN)) * 100;

// Threshold markers at each positive shot tier (1, 2, 3 shots).
const THRESHOLDS = RULES.tiers
  .filter((tier) => tier.minPnl >= 0)
  .map((tier) => ({ shots: tier.shots, left: toPct(tier.minPnl) }));

export function PowerMeter({
  shots,
  openness,
  powerRatio,
}: {
  shots: number;
  openness: number;
  powerRatio: number;
}) {
  const fillClass = shots >= 3 ? "tier-3" : shots === 2 ? "tier-2" : shots === 1 ? "tier-1" : "tier-0";

  return (
    <div className="power-block" role="group" aria-label={`Shot power: ${shots} shots ready`}>
      <div className="power-head">
        <span>Shot power</span>
        <strong key={shots} className={`power-shots ${fillClass}`}>
          {shots} {shots === 1 ? "SHOT" : "SHOTS"}
        </strong>
      </div>
      <div className="power-track">
        <span className={`power-fill ${fillClass}`} style={{ width: `${Math.round(powerRatio * 100)}%` }} />
        {THRESHOLDS.map((t) => (
          <span
            key={t.shots}
            className={"power-mark" + (shots >= t.shots ? " lit" : "")}
            style={{ left: `${t.left}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="power-foot">
        {shots > 0 ? `Net ${Math.round(openness * 100)}% open` : "Get green to earn a shot"}
      </div>
    </div>
  );
}
