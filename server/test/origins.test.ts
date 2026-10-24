import { describe, expect, it } from "vitest";
import { config, originAllowed, originMatches } from "../src/config";

describe("allowed origins", () => {
  it("matches exact origins and subdomain wildcards, nothing else", () => {
    expect(originMatches("https://neon.netlify.app", "https://neon.netlify.app")).toBe(true);
    expect(originMatches("https://neon.netlify.app", "https://neon.netlify.app.evil.com")).toBe(false);
    expect(originMatches("https://*.crazygames.com", "https://neon-reckoning.game-files.crazygames.com")).toBe(true);
    expect(originMatches("https://*.crazygames.com", "https://www.crazygames.com")).toBe(true);
    // The wildcard needs a subdomain, keeps the scheme and can't be smuggled in elsewhere.
    expect(originMatches("https://*.crazygames.com", "https://crazygames.com")).toBe(false);
    expect(originMatches("https://*.crazygames.com", "http://x.crazygames.com")).toBe(false);
    expect(originMatches("https://*.crazygames.com", "https://crazygames.com.evil.com")).toBe(false);
    expect(originMatches("https://*.crazygames.com", "https://evil.com/.crazygames.com")).toBe(false);
    expect(originMatches("https://*.poki-gdn.com", "https://a1b2.poki-gdn.com")).toBe(true);
  });

  it("applies the configured list (exact + wildcard)", () => {
    const saved = [...config.allowedOrigins];
    try {
      config.allowedOrigins.splice(0, config.allowedOrigins.length, "https://neon.netlify.app", "https://*.crazygames.com");
      expect(originAllowed("https://neon.netlify.app")).toBe(true);
      expect(originAllowed("https://game.crazygames.com")).toBe(true);
      expect(originAllowed("https://other.netlify.app")).toBe(false);
      expect(originAllowed(undefined)).toBe(false);
    } finally {
      config.allowedOrigins.splice(0, config.allowedOrigins.length, ...saved);
    }
  });
});
