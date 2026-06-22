import { HttpError } from "./http.ts";
import { MarketSymbol } from "./game.ts";
import { fetchWithTimeout } from "./fetch.ts";

const DEFAULT_HERMES_URL = "https://hermes.pyth.network";
const BTC_USD_FEED_ID = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const ETH_USD_FEED_ID = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const MAX_LATEST_AGE_SECONDS = 30;
const MAX_HISTORICAL_DRIFT_SECONDS = 30;
const MAX_CONFIDENCE_BPS = 100;

export type PythPrice = {
  price: number;
  publishTime: number;
};

type HermesPriceResponse = {
  parsed?: Array<{
    id: string;
    price?: {
      price: string;
      conf: string;
      expo: number;
      publish_time: number;
    };
  }>;
};

function hermesBaseUrl(): string {
  return Deno.env.get("PYTH_HERMES_URL")?.trim() ?? DEFAULT_HERMES_URL;
}

function priceId(market: MarketSymbol): string {
  const envKey = `PYTH_${market}_USD_ID`;
  const fallback = market === "BTC" ? BTC_USD_FEED_ID : market === "ETH" ? ETH_USD_FEED_ID : SOL_USD_FEED_ID;
  return (Deno.env.get(envKey)?.trim() ?? fallback).replace(/^0x/i, "");
}

function parsePrice(payload: HermesPriceResponse): PythPrice {
  const raw = payload.parsed?.[0]?.price;
  if (!raw) throw new HttpError(503, "Pyth price is unavailable.", "pyth_unavailable");

  const integerPrice = Number(raw.price);
  const integerConfidence = Number(raw.conf);
  const exponent = Number(raw.expo);
  const publishTime = Number(raw.publish_time);
  const price = integerPrice * 10 ** exponent;
  const confidence = integerConfidence * 10 ** exponent;

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(publishTime)) {
    throw new HttpError(503, "Pyth returned an invalid price.", "pyth_invalid_price");
  }
  if (!Number.isFinite(confidence) || confidence < 0 || (confidence / price) * 10_000 > MAX_CONFIDENCE_BPS) {
    throw new HttpError(503, "Pyth confidence is too wide.", "pyth_wide_confidence");
  }

  return { price, publishTime };
}

async function fetchHermes(path: string): Promise<PythPrice> {
  const response = await fetchWithTimeout(`${hermesBaseUrl()}${path}`);
  if (!response.ok) {
    console.error("Pyth Hermes request failed", { status: response.status, path });
    throw new HttpError(503, "Pyth price is unavailable.", "pyth_unavailable");
  }
  return parsePrice(await response.json() as HermesPriceResponse);
}

function assertFreshLatest(price: PythPrice): PythPrice {
  const now = Date.now() / 1000;
  if (price.publishTime > now + 2 || now - price.publishTime > MAX_LATEST_AGE_SECONDS) {
    throw new HttpError(503, "Pyth price is stale.", "pyth_stale_price");
  }
  return price;
}

function assertHistoricalClamp(price: PythPrice, targetUnixSeconds: number): PythPrice {
  if (
    price.publishTime > targetUnixSeconds ||
    targetUnixSeconds - price.publishTime > MAX_HISTORICAL_DRIFT_SECONDS
  ) {
    throw new HttpError(503, "Pyth price could not be clamped to the trade window.", "pyth_clamp_failed");
  }
  return price;
}

export async function getLatestMarketPrice(market: MarketSymbol): Promise<PythPrice> {
  const id = encodeURIComponent(priceId(market));
  return assertFreshLatest(await fetchHermes(`/v2/updates/price/latest?ids[]=${id}&parsed=true`));
}

export async function getMarketPriceAt(market: MarketSymbol, unixSeconds: number): Promise<PythPrice> {
  const id = encodeURIComponent(priceId(market));
  const publishTime = Math.max(0, Math.floor(unixSeconds));
  return assertHistoricalClamp(await fetchHermes(`/v2/updates/price/${publishTime}?ids[]=${id}&parsed=true`), publishTime);
}
