import type { z } from "zod";

export type HttpClient = {
  get: <TResponse extends z.ZodType>(
    path: string,
    responseSchema: TResponse
  ) => Promise<z.infer<TResponse>>;
  post: <TRequest, TResponse extends z.ZodType>(
    path: string,
    body: TRequest,
    responseSchema: TResponse
  ) => Promise<z.infer<TResponse>>;
};

type HttpClientOptions = {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  timeoutMs?: number;
};

const isLocalhost = (url: URL): boolean => ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

const normalizeBaseUrl = (rawBaseUrl: string): URL => {
  const url = new URL(rawBaseUrl);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url))) {
    throw new Error("Cloud API URL must use HTTPS. HTTP is allowed only for localhost dev.");
  }

  return url;
};

export const createHttpClient = (
  rawBaseUrl: string,
  options: HttpClientOptions = {}
): HttpClient => {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const request = async <TResponse extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    responseSchema: TResponse,
    body?: unknown
  ): Promise<z.infer<TResponse>> => {
    const url = new URL(path, baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const token = options.getToken ? await options.getToken() : null;

    try {
      const response = await fetchImpl(url, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        method,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Cloud API ${method} ${path} failed with HTTP ${response.status}.`);
      }

      const payload = (await response.json()) as unknown;
      return responseSchema.parse(payload);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    get: (path, responseSchema) => request("GET", path, responseSchema),
    post: (path, body, responseSchema) => request("POST", path, responseSchema, body)
  };
};
