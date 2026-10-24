// Server configuration from environment variables (all optional).

const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  port: int(process.env.PORT, 2567),
  host: process.env.HOST ?? "0.0.0.0",
  /**
   * Comma-separated list of allowed browser origins for WebSocket upgrades,
   * e.g. "https://neon-reckoning.netlify.app". A "*" inside a pattern matches
   * any subdomain, e.g. "https://*.crazygames.com" for a game portal.
   * Empty = allow localhost only. A bare "*" allows any origin (not recommended).
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxRooms: int(process.env.MAX_ROOMS, 40),
  maxSessions: int(process.env.MAX_SESSIONS, 400),
  /** Seconds a queued party waits for more humans before AI fill kicks in (if the party allows bots). */
  aiFillWait: int(process.env.AI_FILL_WAIT, 8),
  /** Same, when no other player is online and free to join: start almost at once. */
  aiFillWaitAlone: int(process.env.AI_FILL_WAIT_ALONE, 2),
  logLevel: process.env.LOG_LEVEL ?? "info",
};

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Exact match, or a "*" wildcard standing for one or more subdomain labels. */
export function originMatches(pattern: string, origin: string): boolean {
  if (!pattern.includes("*")) return pattern === origin;
  const esc = (t: string) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const label = "[a-z0-9-]+(?:\\.[a-z0-9-]+)*";
  return new RegExp(`^${pattern.split("*").map(esc).join(label)}$`, "i").test(origin);
}

export function originAllowed(origin: string | undefined): boolean {
  if (config.allowedOrigins.includes("*")) return true;
  if (!origin) return config.allowedOrigins.length === 0; // non-browser clients only in dev
  if (config.allowedOrigins.length === 0) return LOCAL.test(origin);
  return config.allowedOrigins.some((p) => originMatches(p, origin)) || (LOCAL.test(origin) && process.env.NODE_ENV !== "production");
}

export function log(level: "info" | "warn" | "error", ...args: unknown[]): void {
  if (level === "info" && config.logLevel === "warn") return;
  // Never log player names, IPs or message contents — only operational events.
  console[level === "info" ? "log" : level](`[${new Date().toISOString()}] ${level.toUpperCase()}`, ...args);
}
