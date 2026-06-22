import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredBackendKeys = [
  "VITE_PRIVY_APP_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const raw = line.slice(index + 1).trim();
        const value = raw.replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

const fileEnv = {
  ...parseEnvFile(resolve(".env")),
  ...parseEnvFile(resolve(".env.local")),
};
const env = { ...fileEnv, ...process.env };
const forbiddenClientKeyPattern = /(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|TOKEN|RPC_URL)/i;
const allowedClientKeyPattern = /^VITE_(REQUIRE_BACKEND|PRIVY_APP_ID|SUPABASE_URL|SUPABASE_ANON_KEY|PYTH_HERMES_URL|PYTH_(BTC|ETH|SOL)_USD_ID|TOKEN_MINT|TOKEN_SYMBOL)$/;

function value(key) {
  const raw = env[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

function truthy(key) {
  return ["1", "true", "yes"].includes(value(key).toLowerCase());
}

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const backendEnvPresent = requiredBackendKeys.some(value);
const backendEnvComplete = requiredBackendKeys.every(value);
const productionContext = value("CONTEXT") === "production";
const backendRequired = truthy("VITE_REQUIRE_BACKEND") || productionContext || backendEnvPresent;
const missing = requiredBackendKeys.filter((key) => !value(key));

const failures = [];
if (backendRequired && missing.length) {
  failures.push(`missing connected-mode env: ${missing.join(", ")}`);
}
if (productionContext && !truthy("VITE_REQUIRE_BACKEND")) {
  failures.push("Netlify production must set VITE_REQUIRE_BACKEND=true");
}
if (value("VITE_SUPABASE_URL")) {
  try {
    const url = new URL(value("VITE_SUPABASE_URL"));
    if (!url.hostname.endsWith(".supabase.co")) {
      failures.push("VITE_SUPABASE_URL should point at a Supabase project URL");
    }
  } catch {
    failures.push("VITE_SUPABASE_URL is not a valid URL");
  }
}
for (const key of Object.keys(env)) {
  if (!key.startsWith("VITE_")) continue;
  if (allowedClientKeyPattern.test(key)) continue;
  if (forbiddenClientKeyPattern.test(key)) {
    failures.push(`${key} looks secret-like but VITE_* variables are bundled into the browser`);
  }
}
const supabaseAnonKey = value("VITE_SUPABASE_ANON_KEY");
const supabaseJwtPayload = supabaseAnonKey.includes(".") ? decodeJwtPayload(supabaseAnonKey) : null;
if (supabaseJwtPayload?.role === "service_role") {
  failures.push("VITE_SUPABASE_ANON_KEY contains a service_role key; use an anon/publishable key in browser env");
}

if (failures.length) {
  console.error("Prebuild check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error("For local paper mode, unset VITE_REQUIRE_BACKEND and leave all connected-mode env empty.");
  process.exit(1);
}

if (backendEnvComplete) {
  console.log("Prebuild check passed: connected frontend env is complete.");
} else {
  console.log("Prebuild check passed: local paper mode.");
}
