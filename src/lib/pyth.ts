/**
 * Pyth Hermes price client (BTC/USD, ETH/USD, SOL/USD). Public mainnet endpoint, no API key, CORS-enabled,
 * so it is safe to call directly from the browser. We use it purely as a real-market
 * reference for the *paper* settlement - no funds, no custody.
 *
 * Hermes v2 returns prices as a fixed-point integer string plus an exponent, e.g.
 * { price: "16242000000", expo: -8 } => 162.42. We normalize to a float once here.
 */

import { env } from "../config/env";
import { DEFAULT_MARKET_ASSET, getMarketAsset, MarketAsset, MarketSymbol } from "../game/markets";

export type PriceTick = {
  /** Human-readable price (already scaled by the exponent). */
  price: number;
  /** Publish time in epoch milliseconds. */
  time: number;
};

type HermesParsedPrice = {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
};

type HermesResponse = { parsed?: HermesParsedPrice[] };

const MAX_LATEST_AGE_MS = 60_000;
const MAX_CONFIDENCE_BPS = 100;

function configuredAsset(asset: MarketAsset): MarketAsset {
  if (asset.symbol === "BTC") return { ...asset, pythId: env.btcUsdPriceId.replace(/^0x/i, "") };
  if (asset.symbol === "ETH") return { ...asset, pythId: env.ethUsdPriceId.replace(/^0x/i, "") };
  if (asset.symbol === "SOL") return { ...asset, pythId: env.solUsdPriceId.replace(/^0x/i, "") };
  return asset;
}

function resolveAsset(symbol?: MarketSymbol): MarketAsset {
  return configuredAsset(symbol ? getMarketAsset(symbol) : DEFAULT_MARKET_ASSET);
}

function normalize(entry: HermesParsedPrice | undefined): PriceTick | null {
  if (!entry?.price) return null;
  const { price, conf, expo, publish_time } = entry.price;
  const value = Number(price) * 10 ** expo;
  const confidence = Number(conf) * 10 ** expo;
  const time = publish_time * 1000;
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > MAX_LATEST_AGE_MS) return null;
  if (!Number.isFinite(confidence) || confidence < 0) return null;
  if ((confidence / value) * 10_000 > MAX_CONFIDENCE_BPS) return null;
  return { price: value, time };
}

/** One-shot fetch of the latest market price (used to seed the chart immediately). */
export async function fetchLatestPrice(symbol?: MarketSymbol, signal?: AbortSignal): Promise<PriceTick | null> {
  const asset = resolveAsset(symbol);
  const url = `${env.pythHermesUrl}/v2/updates/price/latest?ids[]=${encodeURIComponent(asset.pythId)}&parsed=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Hermes latest failed: ${res.status}`);
  const body = (await res.json()) as HermesResponse;
  return normalize(body.parsed?.[0]);
}

/**
 * Subscribe to the streaming market price via Server-Sent Events.
 * Returns an unsubscribe function. `onError` fires on transport failure so the
 * caller can fall back to the simulated feed.
 */
export function streamPrice(handlers: {
  symbol?: MarketSymbol;
  onTick: (tick: PriceTick) => void;
  onError?: (error: unknown) => void;
}): () => void {
  const asset = resolveAsset(handlers.symbol);
  const url = `${env.pythHermesUrl}/v2/updates/price/stream?ids[]=${encodeURIComponent(asset.pythId)}&parsed=true`;

  let source: EventSource | null = null;
  try {
    source = new EventSource(url);
  } catch (error) {
    handlers.onError?.(error);
    return () => {};
  }

  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const body = JSON.parse(event.data) as HermesResponse;
      const tick = normalize(body.parsed?.[0]);
      if (tick) handlers.onTick(tick);
    } catch (error) {
      handlers.onError?.(error);
    }
  };

  source.onerror = (error) => handlers.onError?.(error);

  return () => source?.close();
}
