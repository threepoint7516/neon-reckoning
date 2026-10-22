import {
  Match, getFrontierMap, makeMatchConfig, TICK_DT, DEFAULT_LOADOUT,
} from "@neon/shared";
import type { ArenaId, ClientMessage, Difficulty, Loadout, MatchConfig, ModeId, ModifierId, ServerMessage } from "@neon/shared";
import type { Connection } from "./connection";

export interface PracticeOptions {
  mode: ModeId;
  arena: ArenaId;
  teamSize: number;
  bots: number;
  difficulty: Difficulty;
  modifiers: ModifierId[];
  timeLimit?: number;
  name: string;
  loadout: Loadout;
}

const ME = 1;

/**
 * Offline host for Practice. Runs the authoritative Match locally with AI
 * opponents and speaks the exact same JSON protocol as the real server.
 * Clearly offline: no network traffic at all.
 */
export class LocalConnection implements Connection {
  readonly kind = "offline" as const;
  readonly match: Match;
  readonly cfg: MatchConfig;
  private listeners = new Set<(m: ServerMessage) => void>();
  private timer: number | null = null;
  private last = 0;
  private acc = 0;
  private paused = false;
  private closed = false;
  private lastRoster = -1;

  constructor(o: PracticeOptions) {
    const cfg = makeMatchConfig({
      mode: o.mode, arena: o.arena, teamSize: o.teamSize, difficulty: o.difficulty, modifiers: o.modifiers, offline: true,
      timeLimit: o.timeLimit,
    });
    this.cfg = cfg;
    this.match = new Match(cfg, getFrontierMap());
    const teamMode = cfg.mode === "tdm" || cfg.mode === "dom";
    this.match.addPlayer({ id: ME, name: o.name, squad: 0, team: 0, loadout: o.loadout ?? DEFAULT_LOADOUT });
    const total = Math.max(1, Math.min(cfg.maxPlayers, o.bots + 1));
    for (let i = 1; i < total; i++) {
      if (teamMode) {
        const team = i < cfg.teamSize ? 0 : 1;
        this.match.addBot(team, team);
      } else if (cfg.mode === "br") {
        const team = Math.floor(i / cfg.teamSize);
        this.match.addBot(team, team);
      } else this.match.addBot(i, i);
    }
    // Deliver match_start asynchronously, like a real server would.
    setTimeout(() => {
      if (this.closed) return;
      this.emit({
        t: "match_start",
        info: {
          matchId: "practice", config: cfg, you: ME, roster: this.match.roster(), reconnectToken: "", barrels: this.match.barrelList(),
        },
      });
      this.lastRoster = this.match.rosterVersion;
      this.startLoop();
    }, 30);
    this.match.onEnd = (results) => this.emit({ t: "match_end", results });
  }

  private startLoop(): void {
    this.last = performance.now();
    this.timer = window.setInterval(() => this.pump(), 8);
  }

  private pump(): void {
    const now = performance.now();
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.paused) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_DT * 1000 && n < 4) {
      this.acc -= TICK_DT * 1000;
      n++;
      this.match.step();
      if (this.match.rosterVersion !== this.lastRoster) {
        this.lastRoster = this.match.rosterVersion;
        this.emit({ t: "roster", roster: this.match.roster() });
      }
      const snap = this.match.snapshotFor(ME, this.match.tick % 15 === 0);
      this.emit({ t: "snap", s: snap });
      this.match.clearEvents();
    }
    if (n === 4) this.acc = 0;
  }

  private emit(m: ServerMessage): void {
    // Serialize like the network does, so offline play exercises the same paths.
    const copy = JSON.parse(JSON.stringify(m)) as ServerMessage;
    for (const l of this.listeners) l(copy);
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    switch (msg.t) {
      case "input":
        this.match.pushInputs(ME, msg.i);
        break;
      case "loadout":
        this.match.setLoadout(ME, msg.loadout);
        break;
      case "leave_match":
        this.close();
        break;
      default:
        break;
    }
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) this.last = performance.now();
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
