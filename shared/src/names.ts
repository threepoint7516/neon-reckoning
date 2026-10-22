// Random session-only callsigns and display-name sanitization.

const PREFIX = [
  "Neon", "Void", "Cyber", "Chrome", "Static", "Pulse", "Glitch", "Hex", "Volt", "Nova",
  "Rogue", "Ghost", "Flux", "Ion", "Shadow", "Echo", "Proxy", "Synth", "Laser", "Rust",
  "Quantum", "Turbo", "Omega", "Vector", "Cipher", "Blitz", "Razor", "Photon", "Drift", "Arc",
];
const SUFFIX = [
  "Raven", "Runner", "Ghost", "Wolf", "Viper", "Fox", "Saint", "Jackal", "Mantis", "Specter",
  "Hawk", "Nomad", "Reaper", "Lynx", "Cobra", "Monk", "Comet", "Shark", "Wraith", "Kite",
  "Ronin", "Siren", "Golem", "Hornet", "Rook", "Moth", "Oracle", "Tiger", "Drone", "Vandal",
];

export function randomCallsign(rand: () => number = Math.random): string {
  const p = PREFIX[Math.floor(rand() * PREFIX.length)]!;
  const s = SUFFIX[Math.floor(rand() * SUFFIX.length)]!;
  const n = 100 + Math.floor(rand() * 900);
  return `${p}${s}${n}`;
}

export const NAME_MIN = 3;
export const NAME_MAX = 16;

// Small, deliberately conservative blocklist. Names that hit it are replaced
// with a random callsign instead of being shown to other players.
const BLOCKED = ["fuck", "shit", "nigg", "fag", "cunt", "rape", "hitler", "nazi", "kys", "admin", "moderator"];

/**
 * Sanitizes a player-supplied display name: letters, digits, `_` and `-` only,
 * 3–16 chars, no reserved words, and no "[BOT]" impersonation. Returns null if
 * the result is unusable (callers fall back to a random callsign).
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.normalize("NFKC").replace(/[^A-Za-z0-9_-]/g, "").slice(0, NAME_MAX);
  if (cleaned.length < NAME_MIN) return null;
  const lower = cleaned.toLowerCase().replace(/[_-]/g, "");
  if (BLOCKED.some((b) => lower.includes(b))) return null;
  if (lower.startsWith("bot")) return null;
  return cleaned;
}
