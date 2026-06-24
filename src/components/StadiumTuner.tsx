/**
 * Dev-only on-screen placement panel for the GLB stadium. Rendered only when the URL has
 * ?tune. Drag the sliders and watch the stadium move live in the arena; the readout at the
 * bottom is the exact transform to bake into Stadium.ts (then this panel comes out).
 *
 * It talks to the stadium through window.__ppStadium, which Stadium.ts exposes once the GLB
 * has loaded (so enter a match first).
 */
import { useEffect, useState } from "react";

type T = { s: number; x: number; y: number; z: number; ry: number };
type Bridge = { set: (s: number, x: number, y: number, z: number, ry: number) => void; get: () => T };

function bridge(): Bridge | null {
  return (window as unknown as { __ppStadium?: Bridge }).__ppStadium ?? null;
}

export function StadiumTuner() {
  const [t, setT] = useState<T>({ s: 0.35, x: 0, y: 0, z: -4, ry: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      const b = bridge();
      if (b) {
        setReady(true);
        setT(b.get());
      }
    };
    sync();
    window.addEventListener("pp-stadium-ready", sync);
    const id = window.setInterval(sync, 600);
    return () => {
      window.removeEventListener("pp-stadium-ready", sync);
      window.clearInterval(id);
    };
  }, []);

  const apply = (next: T) => {
    setT(next);
    bridge()?.set(next.s, next.x, next.y, next.z, next.ry);
  };

  const row = (label: string, key: keyof T, min: number, max: number, step: number) => (
    <label className="tuner-row">
      <span>
        {label} <b>{t[key].toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={t[key]}
        onChange={(e) => apply({ ...t, [key]: parseFloat(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="stadium-tuner">
      <strong>STADIUM TUNER</strong>
      {!ready ? (
        <p>Enter a match to load the stadium, then drag.</p>
      ) : (
        <>
          {row("Scale", "s", 0.05, 4, 0.005)}
          {row("X (left/right)", "x", -150, 150, 0.5)}
          {row("Y (up/down)", "y", -60, 60, 0.25)}
          {row("Z (fwd/back)", "z", -150, 150, 0.5)}
          {row("Rotate", "ry", -3.15, 3.15, 0.02)}
          <code>
            scale={t.s.toFixed(3)} pos=({t.x.toFixed(1)}, {t.y.toFixed(2)}, {t.z.toFixed(1)}) rotY={t.ry.toFixed(3)}
          </code>
        </>
      )}
    </div>
  );
}
