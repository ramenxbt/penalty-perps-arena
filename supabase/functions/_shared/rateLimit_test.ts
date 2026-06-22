import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "jsr:@std/assert@1";
import { HttpError } from "./http.ts";
import {
  checkPreAuthRateLimit,
  checkRateLimit,
  clearPreAuthRateLimitForTest,
} from "./rateLimit.ts";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://arena.test/open-trade", {
    method: "POST",
    headers,
  });
}

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

function fakeAdmin(calls: RpcCall[]) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  };
}

Deno.test("checkPreAuthRateLimit rejects requests after the fallback source limit", async () => {
  clearPreAuthRateLimitForTest();
  const req = requestWithHeaders({});

  checkPreAuthRateLimit(req, "open-trade", {
    fallbackLimit: 2,
    limit: 20,
    now: 1_000,
    windowSeconds: 60,
  });
  checkPreAuthRateLimit(req, "open-trade", {
    fallbackLimit: 2,
    limit: 20,
    now: 1_100,
    windowSeconds: 60,
  });

  const error = await assertRejects(
    async () =>
      checkPreAuthRateLimit(req, "open-trade", {
        fallbackLimit: 2,
        limit: 20,
        now: 1_200,
        windowSeconds: 60,
      }),
  );

  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 429);
  assertEquals(error.code, "rate_limited");
});

Deno.test("checkPreAuthRateLimit resets the bucket after the window", () => {
  clearPreAuthRateLimitForTest();
  const req = requestWithHeaders({ "cf-connecting-ip": "203.0.113.11" });

  checkPreAuthRateLimit(req, "open-trade", {
    limit: 1,
    now: 1_000,
    windowSeconds: 1,
  });
  checkPreAuthRateLimit(req, "open-trade", {
    limit: 1,
    now: 2_001,
    windowSeconds: 1,
  });
});

Deno.test("checkPreAuthRateLimit isolates buckets by endpoint and explicitly trusted IP", () => {
  clearPreAuthRateLimitForTest();
  const first = requestWithHeaders({ "cf-connecting-ip": "203.0.113.12" });
  const second = requestWithHeaders({ "cf-connecting-ip": "203.0.113.13" });

  checkPreAuthRateLimit(first, "open-trade", {
    limit: 1,
    now: 1_000,
    trustProxyHeaders: true,
    windowSeconds: 60,
  });
  checkPreAuthRateLimit(first, "close-trade", {
    limit: 1,
    now: 1_100,
    trustProxyHeaders: true,
    windowSeconds: 60,
  });
  checkPreAuthRateLimit(second, "open-trade", {
    limit: 1,
    now: 1_200,
    trustProxyHeaders: true,
    windowSeconds: 60,
  });
});

Deno.test("checkPreAuthRateLimit does not trust spoofed IP headers by default", async () => {
  clearPreAuthRateLimitForTest();
  const first = requestWithHeaders({
    "cf-connecting-ip": "198.51.100.10",
    "x-forwarded-for": "198.51.100.11",
  });
  const second = requestWithHeaders({
    "cf-connecting-ip": "198.51.100.12",
    "x-real-ip": "198.51.100.13",
  });

  checkPreAuthRateLimit(first, "open-trade", {
    fallbackLimit: 1,
    limit: 1,
    now: 1_000,
    windowSeconds: 60,
  });
  const error = await assertRejects(
    async () =>
      checkPreAuthRateLimit(second, "open-trade", {
        fallbackLimit: 1,
        limit: 1,
        now: 1_100,
        windowSeconds: 60,
      }),
  );

  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 429);
  assertEquals(error.code, "rate_limited");
});

Deno.test("checkPreAuthRateLimit limits repeated authorization fingerprints", async () => {
  clearPreAuthRateLimitForTest();
  const req = requestWithHeaders({
    authorization: "Bearer repeated-invalid-token",
  });

  checkPreAuthRateLimit(req, "profile", {
    fallbackLimit: 100,
    limit: 1,
    now: 1_000,
    windowSeconds: 60,
  });
  const error = await assertRejects(
    async () =>
      checkPreAuthRateLimit(req, "profile", {
        fallbackLimit: 100,
        limit: 1,
        now: 1_100,
        windowSeconds: 60,
      }),
  );

  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 429);
  assertEquals(error.code, "rate_limited");
});

Deno.test("checkPreAuthRateLimit fallback bucket still catches rotating authorization tokens", async () => {
  clearPreAuthRateLimitForTest();
  const first = requestWithHeaders({ authorization: "Bearer invalid-token-a" });
  const second = requestWithHeaders({
    authorization: "Bearer invalid-token-b",
  });

  checkPreAuthRateLimit(first, "leaderboard", {
    fallbackLimit: 1,
    limit: 100,
    now: 1_000,
    windowSeconds: 60,
  });
  const error = await assertRejects(
    async () =>
      checkPreAuthRateLimit(second, "leaderboard", {
        fallbackLimit: 1,
        limit: 100,
        now: 1_100,
        windowSeconds: 60,
      }),
  );

  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 429);
  assertEquals(error.code, "rate_limited");
});

Deno.test("checkRateLimit always applies the authenticated user bucket", async () => {
  const calls: RpcCall[] = [];
  const req = requestWithHeaders({});

  await checkRateLimit(
    fakeAdmin(calls) as never,
    req,
    "open-trade",
    "player-1",
    20,
  );

  assertEquals(calls.map((call) => call.args.p_bucket), [
    "open-trade:user:player-1",
  ]);
});

Deno.test("checkRateLimit ignores spoofed IP headers by default", async () => {
  const calls: RpcCall[] = [];
  const req = requestWithHeaders({
    "cf-connecting-ip": "198.51.100.10",
    "fly-client-ip": "198.51.100.11",
    "x-forwarded-for": "198.51.100.12",
    "x-real-ip": "198.51.100.13",
  });

  await checkRateLimit(
    fakeAdmin(calls) as never,
    req,
    "close-trade",
    "player-2",
    30,
  );

  assertEquals(calls.map((call) => call.args.p_bucket), [
    "close-trade:user:player-2",
  ]);
});

Deno.test("checkRateLimit adds trusted edge IP bucket only when explicitly enabled", async () => {
  const calls: RpcCall[] = [];
  const req = requestWithHeaders({
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "198.51.100.99",
  });

  await checkRateLimit(
    fakeAdmin(calls) as never,
    req,
    "profile",
    "player-3",
    60,
    60,
    { trustProxyHeaders: true },
  );

  assertEquals(calls.map((call) => call.args.p_bucket), [
    "profile:user:player-3",
    "profile:ip:203.0.113.10",
  ]);
});
