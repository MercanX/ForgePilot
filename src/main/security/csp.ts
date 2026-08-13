import { session } from "electron";

type ContentSecurityPolicyOptions = {
  allowDevServer: boolean;
};

export const createContentSecurityPolicy = (options: ContentSecurityPolicyOptions): string => {
  const connectSources = options.allowDevServer
    ? ["'self'", "http://localhost:*", "ws://localhost:*"]
    : ["'self'"];

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
};

export const applyContentSecurityPolicy = (options: ContentSecurityPolicyOptions): void => {
  const policy = createContentSecurityPolicy(options);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy]
      }
    });
  });
};
