const LOCAL_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
]);

function configuredOrigins(): Set<string> {
  const raw = Deno.env.get("APP_ALLOWED_ORIGINS") ?? Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (LOCAL_ORIGINS.has(origin)) return origin;
  return configuredOrigins().has(origin) ? origin : null;
}

export function corsHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  const origin = allowedOrigin(req);
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
