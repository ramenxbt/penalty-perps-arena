import { assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert@1";
import { HttpError, readJsonObject } from "./http.ts";

Deno.test("readJsonObject returns an empty object for empty bodies", async () => {
  const req = new Request("https://arena.test/open-trade", { method: "POST" });
  assertEquals(await readJsonObject(req), {});
});

Deno.test("readJsonObject parses valid JSON objects", async () => {
  const req = new Request("https://arena.test/open-trade", {
    method: "POST",
    body: JSON.stringify({ direction: "long" }),
  });

  assertEquals(await readJsonObject(req), { direction: "long" });
});

Deno.test("readJsonObject rejects declared oversized bodies before reading", async () => {
  const req = new Request("https://arena.test/open-trade", {
    method: "POST",
    body: "{}",
    headers: { "content-length": "8193" },
  });

  const error = await assertRejects(() => readJsonObject(req));
  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 413);
  assertEquals(error.code, "body_too_large");
});

Deno.test("readJsonObject rejects chunked oversized bodies while streaming", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4096).fill(0x20));
      controller.enqueue(new Uint8Array(4097).fill(0x20));
      controller.close();
    },
  });
  const req = new Request("https://arena.test/open-trade", { method: "POST", body });

  const error = await assertRejects(() => readJsonObject(req));
  assertInstanceOf(error, HttpError);
  assertEquals(error.status, 413);
  assertEquals(error.code, "body_too_large");
});
