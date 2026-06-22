import { importSPKI, jwtVerify } from "npm:jose@6.1.3";
import { fetchWithTimeout } from "./fetch.ts";
import { HttpError } from "./http.ts";

export type PrivyCaller = {
  userId: string;
  sessionId: string | null;
};

type PrivyUser = {
  id: string;
  linked_accounts?: Array<Record<string, unknown>>;
};

let verificationKeyPromise: Promise<CryptoKey> | null = null;
const freshUserCache = new Map<string, number>();
const FRESH_USER_TTL_MS = 60_000;

function appId(): string {
  const value = Deno.env.get("PRIVY_APP_ID")?.trim();
  if (!value) throw new Error("Missing PRIVY_APP_ID.");
  return value;
}

function appSecret(): string {
  const value = Deno.env.get("PRIVY_APP_SECRET")?.trim();
  if (!value) throw new Error("Missing PRIVY_APP_SECRET.");
  return value;
}

function verificationKey(): string | null {
  return (
    Deno.env.get("PRIVY_VERIFICATION_KEY")?.trim() ??
    Deno.env.get("PRIVY_JWT_VERIFICATION_KEY")?.trim() ??
    null
  );
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, "Missing bearer token.", "missing_auth");
  return match[1].trim();
}

async function verifyWithKey(accessToken: string): Promise<PrivyCaller> {
  const key = verificationKey();
  if (!key) throw new Error("Missing PRIVY_VERIFICATION_KEY.");

  verificationKeyPromise ??= importSPKI(key.replace(/\\n/g, "\n"), "ES256");
  const { payload } = await jwtVerify(accessToken, await verificationKeyPromise, {
    issuer: "privy.io",
    audience: appId(),
  });

  if (typeof payload.sub !== "string") {
    throw new HttpError(401, "Invalid Privy token.", "invalid_auth");
  }

  return {
    userId: payload.sub,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
  };
}

export async function authenticateRequest(req: Request): Promise<PrivyCaller> {
  const token = bearerToken(req);
  try {
    return await verifyWithKey(token);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.message.startsWith("Missing PRIVY_")) {
      console.error("Privy auth configuration error", error.message);
      throw new HttpError(500, "Auth is not configured.", "auth_not_configured");
    }
    console.error("Privy token verification failed", error);
    throw new HttpError(401, "Invalid Privy token.", "invalid_auth");
  }
}

export async function fetchPrivyUser(userId: string): Promise<PrivyUser | null> {
  const credentials = btoa(`${appId()}:${appSecret()}`);
  const response = await fetchWithTimeout(`https://api.privy.io/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      "privy-app-id": appId(),
    },
  });

  if (response.status === 404) {
    throw new HttpError(401, "Privy user not found.", "privy_user_not_found");
  }
  if (!response.ok) {
    console.error("Privy user fetch failed", { status: response.status, userId });
    throw new HttpError(502, "Privy user lookup failed.", "privy_lookup_failed");
  }

  const user = await response.json() as PrivyUser;
  if (user.id !== userId) {
    throw new HttpError(401, "Privy user mismatch.", "privy_user_mismatch");
  }
  return user;
}

export async function assertFreshPrivyUser(caller: PrivyCaller): Promise<void> {
  const key = `${caller.userId}:${caller.sessionId ?? "no-session"}`;
  const now = Date.now();
  const cachedUntil = freshUserCache.get(key) ?? 0;
  if (cachedUntil > now) return;

  await fetchPrivyUser(caller.userId);
  freshUserCache.set(key, now + FRESH_USER_TTL_MS);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function looksLikeSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isSolanaWalletAccount(account: Record<string, unknown>, address: string): boolean {
  const metadata = [
    text(account.chain_type),
    text(account.chainType),
    text(account.chain),
    text(account.blockchain),
    text(account.wallet_client_type),
    text(account.walletClientType),
  ].map((value) => value?.toLowerCase());

  return metadata.includes("solana") || (!address.startsWith("0x") && looksLikeSolanaAddress(address));
}

export function deriveProfileIdentity(userId: string, user: PrivyUser | null): {
  name: string;
  avatar: string;
  walletAddress: string | null;
} {
  const accounts = user?.linked_accounts ?? [];
  const displayWalletAddress = accounts.map((account) => text(account.address)).find(Boolean) ?? null;
  const walletAddress =
    accounts
      .map((account) => {
        const address = text(account.address);
        return address && isSolanaWalletAccount(account, address) ? address : null;
      })
      .find(Boolean) ?? null;

  const twitter = accounts.find((account) => account.type === "twitter_oauth");
  const farcaster = accounts.find((account) => account.type === "farcaster");
  const anonymousHandle = `player-${userId.replace(/[^a-z0-9]/gi, "").slice(-8) || "anon"}`;

  const rawName =
    text(twitter?.username) ??
    text(twitter?.name) ??
    text(farcaster?.username) ??
    text(farcaster?.display_name) ??
    (displayWalletAddress ? truncateAddress(displayWalletAddress) : null) ??
    anonymousHandle;

  const name = rawName.slice(0, 48);
  const initials = name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return {
    name,
    avatar: initials || "PP",
    walletAddress,
  };
}
