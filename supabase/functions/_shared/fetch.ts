import { HttpError } from "./http.ts";

export const DEFAULT_EXTERNAL_TIMEOUT_MS = 6_000;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HttpError(503, "Upstream request timed out.", "upstream_timeout");
    }
    throw error;
  }
}
