/**
 * Live "Shot Power" readout shown while a trade is open. Turns the hidden PnL-to-shots
 * tiers into a visible, growing bar so the player can watch their reward climb and chase
 * the next threshold. The big shots number re-mounts on change (keyed) to pop on a
 * tier cross. This is the dopamine of the trade: see what you would bank right now.
 *
 * Every number here is read from RULES.tiers via the shared scale (powerRatioFor, SHOT_TIERS,
 * LOSS_EARNS_SHOT), so the meter, the dial, and the shot thresholds speak one +4 / +15 / +40
 * scale and the foot copy can never drift from the actual rules.
 */

import { LOSS_EARNS_SHOT, SHOT_TIERS, powerRatioFor } from "../game/engine";

// Threshold markers at each positive shot tier (1, 2, 3 shots), positioned on the shared scale.
const THRESHOLDS = SHOT_TIERS.map((tier) => ({ shots: tier.shots, left: powerRatioFor(tier.minPnl) * 100 }));

const ordinal = (n: number): string => {
  if (n === 1) return "first";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
};

/** Accurate next-tier guidance, sourced from RULES.tiers via SHOT_TIERS. */
function footCopy(shots: number, openness: number): string {
  if (shots > 0) return `Net ${Math.round(openness * 100)}% open`;
  const next = SHOT_TIERS[0];
  if (next) {
    const tail = LOSS_EARNS_SHOT ? ". A small loss still earns one long shot." : "";
    return `Reach +${next.minPnl}% for your ${ordinal(next.shots)} shot${tail}`;
  }
  return LOSS_EARNS_SHOT ? "A small loss still earns one long shot." : "Get into profit to earn a shot";
}

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
      <div className="power-foot">{footCopy(shots, openness)}</div>
    </div>
  );
}
