/**
 * Stadium jumbotron / scoreboard. A dark rounded LED panel that hangs above-and-behind
 * the goal (the goal front line is z = -8.6, crowd behind it) and faces +Z toward the
 * camera at ~(0, 3.7, 11.6). The face is a single CanvasTexture drawn in 2D, so there are
 * no image assets and it stays crisp; the canvas is only redrawn inside update() when a
 * displayed value actually changes. A thin truss/hanger makes it read as mounted, not
 * floating, and an additive glow plate gives the soft LED bloom under ACES tone mapping.
 */

import * as THREE from "three";

export type ScoreboardData = {
  score: number;
  rounds: number; // rounds left today
  roundsMax: number;
  streak: number;
  market: string; // e.g. "SOL/USD"
};

/* Brand palette (shared with the rest of the arena). */
const COL = {
  bg: "#0b0f0d",
  bgPanel: "#10161300",
  green: "#b7ff4a",
  cyan: "#6dd6ff",
  amber: "#f6b73c",
  white: "#eaf2ff",
  frame: "#2a3a31",
};

/* World-space size + placement, tuned for readability from the wide front camera. */
const BOARD_WIDTH = 7;
const BOARD_HEIGHT = 2.6;
const BOARD_POS = new THREE.Vector3(0, 5.6, -10.6);

/* Canvas resolution. 1024x384 keeps the 7:2.6 face roughly square-pixelled. */
const CANVAS_W = 1024;
const CANVAS_H = 384;

const MONO = "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace";

export class Scoreboard {
  private scene: THREE.Scene;
  private group: THREE.Group;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private texture: THREE.CanvasTexture;

  private panelGeo: THREE.PlaneGeometry;
  private panelMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private frameGeo: THREE.EdgesGeometry;
  private frameMat: THREE.LineBasicMaterial;
  private trussGeo: THREE.BoxGeometry;
  private trussMat: THREE.MeshStandardMaterial;

  /** Last drawn values, so update() can skip redundant redraws. */
  private last: ScoreboardData | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(BOARD_POS);

    /* ---- Canvas face texture (drawn once now, redrawn only on change) ---- */
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext("2d");

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;

    /* ---- The LED face. MeshBasicMaterial keeps it self-lit (an LED board). ---- */
    this.panelGeo = new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT);
    this.panelMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false, // let the bright greens punch through ACES tone mapping
    });
    const face = new THREE.Mesh(this.panelGeo, this.panelMat);
    this.group.add(face);

    /* ---- Thin frame around the face so it reads as a bezelled board. ---- */
    this.frameGeo = new THREE.EdgesGeometry(this.panelGeo);
    this.frameMat = new THREE.LineBasicMaterial({ color: COL.frame, transparent: true, opacity: 0.9 });
    const frame = new THREE.LineSegments(this.frameGeo, this.frameMat);
    frame.position.z = 0.01;
    this.group.add(frame);

    /* ---- Subtle additive glow plate behind/around the face for LED bloom. ---- */
    this.glowMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(this.panelGeo, this.glowMat);
    glow.scale.set(1.04, 1.08, 1);
    glow.position.z = -0.02;
    this.group.add(glow);

    /* ---- Support truss: two thin angled hangers up to a top spar. ---- */
    this.trussGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08); // unit cube, scaled per bar
    this.trussMat = new THREE.MeshStandardMaterial({ color: 0x1a221d, roughness: 0.7, metalness: 0.5 });

    const topY = BOARD_HEIGHT / 2;
    const hangTop = topY + 1.0; // where the hangers meet the (offscreen) roof rigging
    const hx = BOARD_WIDTH * 0.32; // horizontal offset of each hanger

    // Two vertical-ish hangers from the board top up to the spar.
    for (const sx of [-hx, hx]) {
      const bar = new THREE.Mesh(this.trussGeo, this.trussMat);
      bar.scale.set(1, (hangTop - topY) / 0.08, 1);
      bar.position.set(sx, (topY + hangTop) / 2, -0.05);
      this.group.add(bar);
    }
    // Horizontal spar joining the hanger tops.
    const spar = new THREE.Mesh(this.trussGeo, this.trussMat);
    spar.scale.set((hx * 2 + 0.4) / 0.08, 1, 1);
    spar.position.set(0, hangTop, -0.05);
    this.group.add(spar);

    /* Initial paint with placeholder data so the board never shows a blank canvas. */
    this.draw({ score: 0, rounds: 0, roundsMax: 0, streak: 0, market: "----/---" });

    this.scene.add(this.group);
  }

  /** Redraw the canvas texture ONLY when a displayed value changed. */
  update(data: ScoreboardData): void {
    if (this.last && this.equal(this.last, data)) return;
    this.draw(data);
  }

  private equal(a: ScoreboardData, b: ScoreboardData): boolean {
    return (
      a.score === b.score &&
      a.rounds === b.rounds &&
      a.roundsMax === b.roundsMax &&
      a.streak === b.streak &&
      a.market === b.market
    );
  }

  /** Paint the whole face. Called from constructor and on real value changes. */
  private draw(data: ScoreboardData): void {
    const ctx = this.ctx;
    this.last = { ...data };
    if (!ctx) return;

    const w = CANVAS_W;
    const h = CANVAS_H;

    /* Background: near-black panel with a soft vertical sheen. */
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0e1411");
    bg.addColorStop(0.5, COL.bg);
    bg.addColorStop(1, "#070b09");
    ctx.fillStyle = bg;
    this.roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();

    /* Inner hairline frame so the texture itself reads as a bezelled LED board. */
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(120,160,140,0.35)";
    this.roundRect(ctx, 16, 16, w - 32, h - 32, 22);
    ctx.stroke();

    /* Faint LED scanline grid for texture (very subtle). */
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = COL.white;
    ctx.lineWidth = 1;
    for (let y = 40; y < h - 24; y += 10) {
      ctx.beginPath();
      ctx.moveTo(28, y);
      ctx.lineTo(w - 28, y);
      ctx.stroke();
    }
    ctx.restore();

    /* ---- Top label row: market ticker on the left, "LIVE" tag on the right. ---- */
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = `700 44px ${MONO}`;
    ctx.fillStyle = COL.cyan;
    this.glowText(ctx, data.market.toUpperCase(), 56, 84, COL.cyan);

    ctx.textAlign = "right";
    ctx.font = `700 30px ${MONO}`;
    ctx.fillStyle = COL.amber;
    this.glowText(ctx, "LIVE", w - 56, 78, COL.amber);

    /* ---- Big SCORE block (left half). ---- */
    ctx.textAlign = "left";
    ctx.font = `700 26px ${MONO}`;
    ctx.fillStyle = "rgba(234,242,255,0.55)";
    ctx.fillText("SCORE", 56, 150);

    ctx.font = `700 168px ${MONO}`;
    this.glowText(ctx, String(data.score), 50, 318, COL.green);

    /* ---- Right column: ROUND and STREAK readouts. ---- */
    const rx = w - 56;
    ctx.textAlign = "right";

    ctx.font = `700 26px ${MONO}`;
    ctx.fillStyle = "rgba(234,242,255,0.55)";
    ctx.fillText("ROUND", rx, 150);
    ctx.font = `700 72px ${MONO}`;
    this.glowText(ctx, `${data.rounds} / ${data.roundsMax}`, rx, 220, COL.white);

    ctx.font = `700 26px ${MONO}`;
    ctx.fillStyle = "rgba(234,242,255,0.55)";
    ctx.fillText("STREAK", rx, 282);
    ctx.font = `700 64px ${MONO}`;
    const streakStr = data.streak > 0 ? `x${data.streak}` : `${data.streak}`;
    this.glowText(ctx, streakStr, rx, 348, data.streak > 0 ? COL.amber : COL.white);

    this.texture.needsUpdate = true;
  }

  /** Draw text with a colored glow halo so it reads as emissive LEDs. */
  private glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0; // crisp core pass on top of the halo
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** Rounded-rectangle path helper (kept local to avoid Path2D / API assumptions). */
  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** Remove from scene and release all GPU + texture resources. */
  dispose(): void {
    this.scene.remove(this.group);
    this.panelGeo.dispose();
    this.frameGeo.dispose();
    this.trussGeo.dispose();
    this.panelMat.dispose();
    this.glowMat.dispose();
    this.frameMat.dispose();
    this.trussMat.dispose();
    this.texture.dispose();
  }
}
