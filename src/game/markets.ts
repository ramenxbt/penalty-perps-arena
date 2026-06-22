export type MarketSymbol = "BTC" | "ETH" | "SOL";

export type MarketAsset = {
  symbol: MarketSymbol;
  name: string;
  displayPair: string;
  pythId: string;
  seedPrice: number;
  volatility: number;
  decimals: number;
  accent: string;
};

export const MARKET_ASSETS: readonly MarketAsset[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    displayPair: "BTC/USD",
    pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    seedPrice: 104250,
    volatility: 85,
    decimals: 1,
    accent: "#f6b73c",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    displayPair: "ETH/USD",
    pythId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    seedPrice: 3580,
    volatility: 3.1,
    decimals: 2,
    accent: "#8ea7ff",
  },
  {
    symbol: "SOL",
    name: "Solana",
    displayPair: "SOL/USD",
    pythId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    seedPrice: 162.42,
    volatility: 0.15,
    decimals: 2,
    accent: "#b7ff4a",
  },
] as const;

export const DEFAULT_MARKET_ASSET = MARKET_ASSETS[2];

export function isMarketSymbol(value: unknown): value is MarketSymbol {
  return value === "BTC" || value === "ETH" || value === "SOL";
}

export function getMarketAsset(symbol: MarketSymbol): MarketAsset {
  return MARKET_ASSETS.find((asset) => asset.symbol === symbol) ?? DEFAULT_MARKET_ASSET;
}

export function randomMarketAsset(previous?: MarketSymbol | null): MarketAsset {
  const pool = previous ? MARKET_ASSETS.filter((asset) => asset.symbol !== previous) : MARKET_ASSETS;
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_MARKET_ASSET;
}

export function formatMarketPrice(value: number, asset: MarketAsset): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: asset.decimals,
    maximumFractionDigits: asset.decimals,
  });
}
