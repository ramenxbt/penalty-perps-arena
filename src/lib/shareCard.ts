/**
 * Renders a shareable result card to a canvas so a player can save or copy a clean image of
 * their cup finish. Self-contained 2D canvas drawing (no external assets) in the World Cup
 * palette, sized to the standard 1200x630 social card. The arena itself is paper-trading; the
 * card carries no price data, only the run result.
 */

export type ShareCardData = {
  placement: number;
  fieldSize: number;
  ordinal: string;
  points: number;
  goals: number;
};

const W = 1200;
const H = 630;

const COL = {
  bg0: "#0a0f12",
  bg1: "#11181d",
  gold: "#ffc53d",
  green: "#2fd07a",
  text: "#e8eef2",
  muted: "#8a97a3",
  line: "rgba(255,255,255,0.10)",
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function buildShareCard(data: ShareCardData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Background: vertical gradient + a soft gold glow toward the top.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, COL.bg1);
  grad.addColorStop(1, COL.bg0);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 90, 40, W / 2, 90, 520);
  glow.addColorStop(0, "rgba(255,197,61,0.18)");
  glow.addColorStop(1, "rgba(255,197,61,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Gold hairline frame.
  ctx.strokeStyle = "rgba(255,197,61,0.55)";
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, W - 48, H - 48, 28);
  ctx.stroke();

  const won = data.placement === 1;
  const podium = data.placement <= 3;

  // Eyebrow + brand mark.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COL.gold;
  ctx.font = "700 30px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("PENALTY PERPS ARENA", 80, 120);

  // Result line.
  ctx.fillStyle = COL.muted;
  ctx.font = "600 34px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(won ? "WON THE CUP" : podium ? "ON THE PODIUM" : "CUP COMPLETE", 80, 200);

  // Big placement.
  ctx.fillStyle = won ? COL.gold : COL.text;
  ctx.font = "800 190px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(data.ordinal, 76, 380);

  // "of N" trailing the placement.
  const placeW = ctx.measureText(data.ordinal).width;
  ctx.fillStyle = COL.muted;
  ctx.font = "600 46px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`of ${data.fieldSize}`, 76 + placeW + 28, 380);

  // Stat row.
  const statY = 470;
  ctx.fillStyle = COL.line;
  ctx.fillRect(80, statY - 34, W - 160, 2);

  const stat = (label: string, value: string, x: number, accent = COL.text) => {
    ctx.fillStyle = COL.muted;
    ctx.font = "600 26px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(label, x, statY + 4);
    ctx.fillStyle = accent;
    ctx.font = "800 64px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(value, x, statY + 70);
  };
  stat("POINTS", data.points.toLocaleString(), 80, COL.text);
  stat("GOALS", String(data.goals), 460, COL.green);

  // Footer tagline.
  ctx.fillStyle = COL.muted;
  ctx.font = "600 26px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Trade the chart. Profit earns your shots.", 80, H - 70);

  return canvas;
}

export type ProfileCardData = {
  handle: string;
  rank: number;
  fieldSize: number;
  seasonPoints: number;
  tier: string;
};

/** A shareable identity card: handle, rank, tier, and season points. */
export function buildProfileCard(data: ProfileCardData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, COL.bg1);
  grad.addColorStop(1, COL.bg0);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 90, 40, W / 2, 90, 520);
  glow.addColorStop(0, "rgba(255,197,61,0.18)");
  glow.addColorStop(1, "rgba(255,197,61,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,197,61,0.55)";
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, W - 48, H - 48, 28);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COL.gold;
  ctx.font = "700 30px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("PENALTY PERPS ARENA", 80, 120);

  ctx.fillStyle = COL.muted;
  ctx.font = "600 30px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${data.tier} TIER`, 80, 188);

  ctx.fillStyle = COL.text;
  ctx.font = "800 96px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(data.handle.slice(0, 16), 76, 300);

  const stat = (label: string, value: string, x: number, accent = COL.text) => {
    ctx.fillStyle = COL.muted;
    ctx.font = "600 26px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(label, x, 392);
    ctx.fillStyle = accent;
    ctx.font = "800 64px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(value, x, 460);
  };
  ctx.fillStyle = COL.line;
  ctx.fillRect(80, 356, W - 160, 2);
  stat("RANK", `#${data.rank}`, 80, COL.gold);
  stat("OF", String(data.fieldSize), 360, COL.text);
  stat("SEASON POINTS", data.seasonPoints.toLocaleString(), 620, COL.green);

  ctx.fillStyle = COL.muted;
  ctx.font = "600 26px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Trade the chart. Profit earns your shots.", 80, H - 70);

  return canvas;
}

/** Trigger a download of the canvas as a PNG. */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Try to copy the canvas to the clipboard as a PNG. Returns false if unsupported/denied. */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const ClipItem = window.ClipboardItem;
    if (!ClipItem || !navigator.clipboard?.write) return false;
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
