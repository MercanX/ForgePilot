import { createContentSecurityPolicy } from "@main/security/csp";
import { isAllowedNavigation } from "@main/security/navGuard";

describe("content security policy", () => {
  it("keeps production connections self-only", () => {
    const policy = createContentSecurityPolicy({ allowDevServer: false });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("ws://localhost");
  });

  it("allows local Vite websocket connections only in development", () => {
    const policy = createContentSecurityPolicy({ allowDevServer: true });

    expect(policy).toContain("connect-src 'self' http://localhost:* ws://localhost:*");
  });
});

describe("navigation guard", () => {
  it("allows app files and local development server URLs", () => {
    expect(isAllowedNavigation("file:///app/index.html")).toBe(true);
    expect(isAllowedNavigation("http://localhost:5173")).toBe(true);
    expect(isAllowedNavigation("ws://127.0.0.1:5173")).toBe(true);
  });

  it("blocks external navigation targets", () => {
    expect(isAllowedNavigation("https://example.com")).toBe(false);
    expect(isAllowedNavigation("javascript:alert(1)")).toBe(false);
    expect(isAllowedNavigation("not a url")).toBe(false);
  });
});
