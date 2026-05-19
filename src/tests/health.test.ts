import { describe, expect, it } from "vitest";
import { buildApp } from "../server/app.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
  });
});
