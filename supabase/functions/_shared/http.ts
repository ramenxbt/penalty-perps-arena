import { corsHeaders } from "./cors.ts";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = message,
  ) {
    super(message);
  }
}

const MAX_JSON_BODY_BYTES = 8192;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function readCappedText(req: Request): Promise<string> {
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Request body is too large.", "body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(body);
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large.", "body_too_large");
  }

  const text = await readCappedText(req);
  if (encoder.encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large.", "body_too_large");
  }
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object.", "invalid_body");
  }
  return parsed as Record<string, unknown>;
}

function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function methodNotAllowed(req: Request): Response | null {
  if (req.method === "OPTIONS") return withCors(req, new Response("ok"));
  if (req.method !== "POST") {
    return withCors(req, jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405));
  }
  return null;
}

export async function withHttp(handler: (req: Request) => Promise<Response>, req: Request): Promise<Response> {
  const early = methodNotAllowed(req);
  if (early) return early;

  try {
    return withCors(req, await handler(req));
  } catch (error) {
    if (error instanceof HttpError) {
      return withCors(req, jsonResponse({ error: error.message, code: error.code }, error.status));
    }

    console.error("Unhandled edge function error", error);
    return withCors(req, jsonResponse({ error: "Internal server error.", code: "internal_error" }, 500));
  }
}
