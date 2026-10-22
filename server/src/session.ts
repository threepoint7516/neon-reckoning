import type { WebSocket } from "ws";
import { MSG_BURST, MSG_RATE_PER_SEC, randomCallsign, sanitizeName } from "@neon/shared";
import type { Loadout, ServerMessage } from "@neon/shared";
import { DEFAULT_LOADOUT } from "@neon/shared";
import type { Room } from "./room";
import type { Party } from "./lobby";

let nextId = 1;

/** One connected browser. Identity is a session-only callsign, never stored. */
export class Session {
  readonly id = nextId++;
  name = randomCallsign();
  helloDone = false;
  party: Party | null = null;
  room: Room | null = null;
  loadout: Loadout = { ...DEFAULT_LOADOUT };
  reboundPlayerId = -1;
  private tokens = MSG_BURST;
  private last = Date.now();
  strikes = 0;
  alive = true;

  constructor(private ws: WebSocket) {}

  setName(raw: unknown): string {
    this.name = sanitizeName(raw) ?? this.name;
    return this.name;
  }

  /** Token-bucket message rate limiter. */
  allow(): boolean {
    const now = Date.now();
    this.tokens = Math.min(MSG_BURST, this.tokens + ((now - this.last) / 1000) * MSG_RATE_PER_SEC);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  send(msg: ServerMessage): void {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    if (this.ws.readyState !== 1) return;
    // Drop frames for clients that can't keep up instead of buffering forever.
    if (this.ws.bufferedAmount > 512 * 1024) return;
    this.ws.send(raw);
  }

  error(code: string, message: string): void {
    this.send({ t: "error", code, message });
  }

  close(code: number, reason: string): void {
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
