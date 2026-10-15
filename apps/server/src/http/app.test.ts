import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHttpApp } from "./app.js";

async function request(
  path: string,
): Promise<{ status: number; body: string }> {
  const app = createHttpApp();
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected TCP address");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("createHttpApp", () => {
  it("returns ok on GET /health", async () => {
    const { status, body } = await request("/health");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  });

  it("returns 404 for unknown routes", async () => {
    const { status, body } = await request("/missing");
    expect(status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: "not_found" });
  });
});
