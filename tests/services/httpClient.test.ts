import { z } from "zod";

import { createHttpClient } from "@services/api/httpClient";

describe("httpClient", () => {
  it("rejects non-local HTTP URLs", () => {
    expect(() => createHttpClient("http://example.com")).toThrow("HTTPS");
  });

  it("allows localhost HTTP for development and validates responses", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      void input;
      void options;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200
        })
      );
    });
    const client = createHttpClient("http://localhost:4317", {
      fetchImpl: fetchMock
    });

    await expect(client.get("/health", z.object({ ok: z.literal(true) }))).resolves.toEqual({
      ok: true
    });
  });

  it("attaches bearer tokens when provided", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      void input;
      void options;
      return Promise.resolve(
        new Response(JSON.stringify({ accepted: true }), {
          headers: { "content-type": "application/json" },
          status: 200
        })
      );
    });
    const client = createHttpClient("https://cloud.example.test", {
      fetchImpl: fetchMock,
      getToken: () => Promise.resolve("secret-token")
    });

    await client.post("/jobs/request", {}, z.object({ accepted: z.literal(true) }));

    const requestOptions = fetchMock.mock.calls[0]?.[1];
    expect(requestOptions?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token"
      })
    );
  });
});
