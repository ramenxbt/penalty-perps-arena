/**
 * Hyperliquid market feed (BTC/ETH/SOL). Public, no API key, CORS-enabled. We use the
 * WebSocket `allMids` stream for rapid sub-second mid prices and build ~1s candles from
 * it client-side - this is purely a real-market reference for the *paper* game, no funds.
 *
 * The interface mirrors lib/pyth so the feed hook can swap sources with one import change.
 */

export type PriceTick = {
  price: number;
  time: number;
};

export type MarketSymbol = "BTC" | "ETH" | "SOL";

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const EMIT_THROTTLE_MS = 200; // cap state churn at ~5 price updates/sec.
const PING_INTERVAL_MS = 30_000;

function parseMid(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** One-shot latest mid for `symbol` (used to seed the chart immediately). */
export async function fetchLatestPrice(symbol: MarketSymbol, signal?: AbortSignal): Promise<PriceTick | null> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid allMids failed: ${res.status}`);
  const data = (await res.json()) as Record<string, string>;
  const price = parseMid(data?.[symbol]);
  return price == null ? null : { price, time: Date.now() };
}

/**
 * Subscribe to the live mid for `symbol`. Returns an unsubscribe function; `onError`
 * fires on transport failure (or close) so the caller can fall back to the simulator.
 */
export function streamPrice(handlers: {
  symbol: MarketSymbol;
  onTick: (tick: PriceTick) => void;
  onError?: (error: unknown) => void;
}): () => void {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let lastEmit = 0;
  let ping: number | undefined;

  try {
    socket = new WebSocket(HL_WS_URL);
  } catch (error) {
    handlers.onError?.(error);
    return () => {};
  }

  socket.onopen = () => {
    socket?.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } }));
    ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as { channel?: string; data?: { mids?: Record<string, string> } };
      if (message.channel !== "allMids") return;
      const price = parseMid(message.data?.mids?.[handlers.symbol]);
      if (price == null) return;
      const now = Date.now();
      if (now - lastEmit < EMIT_THROTTLE_MS) return;
      lastEmit = now;
      handlers.onTick({ price, time: now });
    } catch (error) {
      handlers.onError?.(error);
    }
  };

  socket.onerror = (error) => handlers.onError?.(error);
  socket.onclose = () => {
    if (!closedByUs) handlers.onError?.(new Error("Hyperliquid stream closed"));
  };

  return () => {
    closedByUs = true;
    if (ping !== undefined) window.clearInterval(ping);
    if (!socket) return;
    try {
      // Closing a socket that is still CONNECTING logs a console warning, so defer
      // the close until it opens; close immediately if it is already open.
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket?.close(), { once: true });
      }
    } catch {
      // ignore
    }
  };
}
