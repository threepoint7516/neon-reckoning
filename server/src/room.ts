import { randomBytes } from "node:crypto";
import { Match, getFrontierMap, MAX_REWIND, RECONNECT_GRACE } from "@neon/shared";
import type { Loadout, MatchConfig, MatchResults, PlayerInput, RosterEntry, ServerMessage } from "@neon/shared";
import type { Session } from "./session";
import { log } from "./config";

export interface RoomSlot {
  playerId: number;
  session: Session | null;
  token: string;
  disconnectedAt: number;
}

/**
 * One running match on the server. Owns the authoritative `Match`
 * simulation, routes validated inputs into it and streams per-player
 * snapshots back. All state lives in memory and is discarded on close.
 */
export class Room {
  readonly id: string;
  readonly match: Match;
  readonly slots = new Map<number, RoomSlot>();
  private lastRoster = -1;
  ended = false;
  closed = false;
  /** Private (party-started) matches never take drop-in players. */
  private = false;
  private endedAt = 0;
  createdAt = Date.now();

  constructor(cfg: MatchConfig, private onClose: (room: Room) => void) {
    this.id = randomBytes(6).toString("hex");
    this.match = new Match(cfg, getFrontierMap());
    this.match.onEnd = (r) => this.handleEnd(r);
  }

  addHuman(s: Session, team: number, squad: number, loadout: Loadout): RoomSlot {
    const mp = this.match.addPlayer({ id: s.id, name: s.name, squad, team, loadout });
    const slot: RoomSlot = { playerId: mp.id, session: s, token: randomBytes(18).toString("base64url"), disconnectedAt: 0 };
    this.slots.set(mp.id, slot);
    s.room = this;
    return slot;
  }

  addBot(team: number, squad: number): void {
    this.match.addBot(team, squad);
  }

  /** True while new players can still drop into this match in place of bots. */
  acceptsDropIn(): boolean {
    const m = this.match;
    return !this.ended && !this.closed && m.cfg.mode !== "br" && m.cfg.mode !== "training" && (m.phase === "starting" || (m.phase === "live" && m.timeLeft() > 75));
  }

  /** Bot ids on `team` (any team when null). */
  botsOn(team: number | null): number[] {
    return [...this.match.players.values()].filter((p) => p.isBot && (team === null || p.team === team)).map((p) => p.id);
  }

  /**
   * Drop-in: real players take over bot slots in a running match. Team modes
   * replace bots on `team`; FFA (team null) replaces any bots.
   */
  dropIn(members: Session[], team: number | null): void {
    const bots = this.botsOn(team);
    members.forEach((s, k) => {
      const bot = this.match.players.get(bots[k]!)!;
      const t = bot.team;
      const sq = bot.squad;
      this.match.removePlayer(bot.id);
      this.sendStart(this.addHuman(s, t, sq, s.loadout));
    });
  }

  /** A human left mid-match: a labelled bot takes their place so teams stay full. */
  private backfill(team: number, squad: number): void {
    if (this.ended || this.closed || this.slots.size === 0 || this.match.cfg.mode === "br") return;
    if (this.match.phase === "ended") return;
    this.match.addBot(team, squad);
  }

  /** Sends match_start to every connected human (call after all players are added). */
  announceStart(): void {
    for (const slot of this.slots.values()) this.sendStart(slot);
  }

  sendStart(slot: RoomSlot): void {
    slot.session?.send({
      t: "match_start",
      info: {
        matchId: this.id, config: this.match.cfg, you: slot.playerId, roster: this.match.roster(),
        reconnectToken: slot.token, barrels: this.match.barrelList(), crates: this.match.crateList(),
      },
    });
  }

  input(s: Session, inputs: PlayerInput[]): void {
    if (this.ended) return;
    const slot = this.slots.get(s.id);
    if (!slot || slot.session !== s) return;
    // View time can't be in the future or beyond the rewind window.
    for (const i of inputs) i.vt = Math.min(this.match.time, Math.max(this.match.time - MAX_REWIND - 0.2, i.vt));
    this.match.pushInputs(slot.playerId, inputs);
  }

  setLoadout(s: Session, l: Loadout): void {
    if (this.slots.get(s.id)?.session === s) this.match.setLoadout(s.id, l);
  }

  /** Player explicitly left: remove them from the simulation. */
  leave(s: Session): void {
    const slot = this.slots.get(s.id);
    if (!slot) return;
    this.slots.delete(s.id);
    const mp = this.match.players.get(slot.playerId);
    this.match.removePlayer(slot.playerId);
    s.room = null;
    this.checkEmpty();
    if (mp) this.backfill(mp.team, mp.squad);
  }

  /** Socket dropped: keep the slot for a grace period so they can reconnect. */
  disconnect(s: Session): void {
    const slot = this.slots.get(s.id);
    if (!slot || slot.session !== s) return;
    slot.session = null;
    slot.disconnectedAt = Date.now();
    this.match.setConnected(slot.playerId, false);
    this.checkEmpty();
  }

  reconnect(s: Session, token: string): boolean {
    for (const slot of this.slots.values()) {
      if (slot.token !== token || slot.session) continue;
      slot.session = s;
      slot.disconnectedAt = 0;
      s.room = this;
      s.reboundPlayerId = slot.playerId;
      this.match.setConnected(slot.playerId, true);
      if (this.ended && this.match.results) s.send({ t: "match_end", results: this.match.results });
      else this.sendStart(slot);
      return true;
    }
    return false;
  }

  private checkEmpty(): void {
    const humans = [...this.slots.values()];
    if (humans.length === 0 || humans.every((h) => !h.session && Date.now() - h.disconnectedAt > RECONNECT_GRACE * 1000)) this.close();
    else if (humans.every((h) => !h.session) && !this.ended) {
      // Everyone dropped: keep the room briefly for reconnects, handled in tick().
    }
  }

  private handleEnd(results: MatchResults): void {
    this.ended = true;
    this.endedAt = Date.now();
    this.broadcast({ t: "match_end", results });
    log("info", `room ${this.id} ended (${this.match.cfg.mode}, ${Math.round(results.duration)}s)`);
  }

  private broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const slot of this.slots.values()) slot.session?.sendRaw(raw);
  }

  tick(): void {
    if (this.closed) return;
    this.match.step();
    const withScores = this.match.tick % 15 === 0;
    if (this.match.rosterVersion !== this.lastRoster) {
      this.lastRoster = this.match.rosterVersion;
      this.broadcast({ t: "roster", roster: this.match.roster() as RosterEntry[] });
    }
    for (const slot of this.slots.values()) {
      if (!slot.session) continue;
      const snap = this.match.snapshotFor(slot.playerId, withScores);
      slot.session.sendRaw(JSON.stringify({ t: "snap", s: snap }));
    }
    this.match.clearEvents();

    const now = Date.now();
    // Expire disconnected players after the grace window.
    for (const slot of [...this.slots.values()]) {
      if (!slot.session && slot.disconnectedAt && now - slot.disconnectedAt > RECONNECT_GRACE * 1000) {
        this.slots.delete(slot.playerId);
        const mp = this.match.players.get(slot.playerId);
        this.match.removePlayer(slot.playerId);
        if (mp) this.backfill(mp.team, mp.squad);
      }
    }
    if (this.slots.size === 0) this.close();
    // Linger after the end so results can be shown, then free everything.
    if (this.ended && now - this.endedAt > 60_000) this.close();
    // Safety: hard cap on room lifetime.
    if (now - this.createdAt > 40 * 60_000) this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.ended) this.match.end(-1, "Room closed");
    for (const slot of this.slots.values()) if (slot.session && slot.session.room === this) slot.session.room = null;
    this.slots.clear();
    this.onClose(this);
  }

  humanCount(): number {
    return this.slots.size;
  }
}
