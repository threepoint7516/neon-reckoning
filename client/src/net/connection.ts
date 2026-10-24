import type { ClientMessage, ServerMessage } from "@neon/shared";

/**
 * Transport used by the game. Online play uses a WebSocket to the
 * authoritative server; Practice uses an in-browser host running the same
 * Match simulation. The game code can't tell the difference.
 */
export interface Connection {
  readonly kind: "online" | "offline";
  send(msg: ClientMessage): void;
  onMessage(cb: (m: ServerMessage) => void): () => void;
  /** Practice only: pause the local simulation. */
  setPaused?(paused: boolean): void;
  close(): void;
}

/**
 * Online play is only offered when the build knows a game server. Without
 * VITE_GAME_SERVER_URL (and outside `npm run dev`) the game is offline-only:
 * no Play/lobby, invites or server status anywhere in the UI.
 */
export function onlineEnabled(): boolean {
  return serverUrl() !== null;
}

export function serverUrl(): string | null {
  const env = import.meta.env.VITE_GAME_SERVER_URL?.trim();
  if (env) return env;
  // Local development convenience only: never used in production builds.
  if (import.meta.env.DEV) return `ws://${location.hostname || "localhost"}:2567`;
  return null;
}
