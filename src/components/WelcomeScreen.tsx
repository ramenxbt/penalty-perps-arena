/**
 * Welcome / login entry. The first thing a player sees: brand, a one-line pitch, a clear
 * three-step explainer, and a single primary action (connect or enter). Keeps the start
 * focused so a newcomer immediately understands the loop before the terminal appears.
 */

import { Target, TrendingUp, Trophy } from "lucide-react";

const STEPS = [
  { icon: TrendingUp, title: "Trade", body: "Call Long or Short on a live crypto chart." },
  { icon: Target, title: "Earn shots", body: "Close in profit to earn open penalty shots." },
  { icon: Trophy, title: "Score", body: "Beat the keeper and climb the season ladder." },
];

export function WelcomeScreen(props: { ctaLabel: string; note: string; onCta: () => void }) {
  return (
    <main className="welcome-screen">
      <section className="welcome-card">
        <div className="welcome-brand">
          <div className="welcome-mark" aria-hidden="true">PP</div>
          <span className="eyebrow">Global Penalty Circuit</span>
        </div>

        <h1 className="welcome-title">Penalty Perps</h1>
        <p className="welcome-tagline">
          Read the market, earn your shots, bury the penalty. A paper trading game, no real funds.
        </p>

        <div className="welcome-steps">
          {STEPS.map((step, index) => (
            <div className="welcome-step" key={step.title}>
              <span className="welcome-step-num">{index + 1}</span>
              <step.icon size={20} />
              <strong>{step.title}</strong>
              <small>{step.body}</small>
            </div>
          ))}
        </div>

        <button className="primary-action full welcome-cta" type="button" onClick={props.onCta}>
          {props.ctaLabel}
        </button>
        <p className="welcome-note">{props.note}</p>
      </section>
    </main>
  );
}
