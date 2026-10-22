import { randomInt } from "node:crypto";
import {
  DISTRICT_IDS, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode, makeMatchConfig,
} from "@neon/shared";
import type { ClientMessage, Difficulty, MatchConfig, PartySize, PartyState, QueueMode } from "@neon/shared";
import type { Session } from "./session";
import { Room } from "./room";
import { config, log } from "./config";

export interface Party {
  code: string;
  members: Session[];
  leader: Session;
  ready: Set<number>;
  mode: QueueMode;
  size: PartySize;
  fill: boolean;
  bots: boolean;
  status: "idle" | "queued" | "in_match";
  queuedAt: number;
  queueInfo?: PartyState["queue"];
}

/**
 * Lobby: sessions, parties (room codes), matchmaking queues and rooms.
 * Everything is in-memory; nothing about players is persisted.
 */
export class Lobby {
  readonly sessions = new Set<Session>();
  readonly parties = new Map<string, Party>();
  readonly rooms = new Set<Room>();

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  add(s: Session): void {
    this.sessions.add(s);
  }

  remove(s: Session): void {
    this.sessions.delete(s);
    s.alive = false;
    if (s.room) s.room.disconnect(s);
    if (s.party) this.leaveParty(s);
  }

  online(): number {
    return this.sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  handle(s: Session, m: ClientMessage): void {
    if (!s.helloDone && m.t !== "hello") {
      s.error("hello_required", "Handshake required.");
      return;
    }
    switch (m.t) {
      case "hello": {
        if (m.v !== PROTOCOL_VERSION) {
          s.error("version", "Your game client is out of date. Refresh the page to update.");
          s.close(4001, "version");
          return;
        }
        s.helloDone = true;
        s.setName(m.name);
        s.send({ t: "welcome", id: s.id, name: s.name, online: this.online(), v: PROTOCOL_VERSION });
        return;
      }
      case "ping":
        s.send({ t: "pong", c: m.c, s: Date.now() });
        return;
      case "rename":
        if (s.room) return s.error("in_match", "You can't rename during a match.");
        s.setName(m.name);
        s.send({ t: "named", name: s.name });
        if (s.party) this.pushParty(s.party);
        return;
      case "party_create":
        if (s.room) return s.error("in_match", "Leave your match first.");
        if (s.party) this.leaveParty(s);
        this.createParty(s);
        return;
      case "party_join":
        return this.joinParty(s, m.code);
      case "party_leave":
        if (s.party) this.leaveParty(s);
        s.send({ t: "party", party: null });
        return;
      case "party_ready": {
        const p = s.party;
        if (!p || p.status !== "idle") return;
        if (m.ready) p.ready.add(s.id);
        else p.ready.delete(s.id);
        this.pushParty(p);
        return;
      }
      case "party_settings": {
        const p = s.party;
        if (!p) return s.error("no_party", "You're not in a party.");
        if (p.leader !== s) return s.error("not_leader", "Only the party leader can change settings.");
        if (p.status !== "idle") return s.error("busy", "Cancel matchmaking before changing settings.");
        if (m.mode !== "ffa" && p.members.length > m.size)
          return s.error("party_too_big", `Your party has ${p.members.length} players — choose a squad size of at least ${p.members.length}.`);
        p.mode = m.mode;
        p.size = m.mode === "ffa" ? 1 : m.size;
        p.fill = m.fill;
        p.bots = m.bots;
        this.pushParty(p);
        return;
      }
      case "party_kick": {
        const p = s.party;
        if (!p || p.leader !== s) return s.error("not_leader", "Only the party leader can remove players.");
        const target = p.members.find((x) => x.id === m.id);
        if (!target || target === s) return;
        this.leaveParty(target);
        target.send({ t: "party", party: null });
        target.error("kicked", "You were removed from the party.");
        return;
      }
      case "queue":
        return this.queue(s);
      case "cancel_queue": {
        const p = s.party;
        if (p && p.status === "queued") {
          p.status = "idle";
          p.queueInfo = undefined;
          this.pushParty(p);
        }
        return;
      }
      case "start_private":
        return this.startPrivate(s, m.difficulty);
      case "loadout":
        s.loadout = m.loadout;
        s.room?.setLoadout(s, m.loadout);
        return;
      case "input":
        s.room?.input(s, m.i);
        return;
      case "leave_match":
        if (s.room) s.room.leave(s);
        if (s.party && s.party.status === "in_match" && s.party.members.every((x) => !x.room)) {
          s.party.status = "idle";
          this.pushParty(s.party);
        }
        return;
      case "reconnect": {
        for (const r of this.rooms) {
          if (r.reconnect(s, m.token)) {
            log("info", `session rejoined room ${r.id}`);
            return;
          }
        }
        s.error("reconnect_failed", "That match is no longer available.");
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Parties
  // ---------------------------------------------------------------------------

  private newCode(): string {
    for (;;) {
      let c = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.parties.has(c)) return c;
    }
  }

  private createParty(s: Session): Party {
    const p: Party = {
      code: this.newCode(), members: [s], leader: s, ready: new Set([s.id]), mode: "tdm", size: 1, fill: true, bots: true,
      status: "idle", queuedAt: 0,
    };
    this.parties.set(p.code, p);
    s.party = p;
    this.pushParty(p);
    return p;
  }

  private joinParty(s: Session, code: string): void {
    if (s.room) return s.error("in_match", "Leave your match first.");
    if (!isValidRoomCode(code)) return s.error("bad_code", "Room codes are 5 characters (letters and digits).");
    const p = this.parties.get(code);
    if (!p) return s.error("no_such_party", `No party with code ${code}. Check the code with your friend.`);
    if (p === s.party) return this.pushParty(p);
    if (p.members.length >= 4) return s.error("party_full", "That party is full (4 players max).");
    if (p.status !== "idle") return s.error("party_busy", "That party is matchmaking or in a match. Try again shortly.");
    if (s.party) this.leaveParty(s);
    p.members.push(s);
    s.party = p;
    if (p.mode !== "ffa" && p.size < p.members.length) p.size = Math.min(4, p.members.length) as PartySize;
    this.pushParty(p);
  }

  leaveParty(s: Session): void {
    const p = s.party;
    if (!p) return;
    p.members = p.members.filter((x) => x !== s);
    p.ready.delete(s.id);
    s.party = null;
    if (p.members.length === 0) {
      this.parties.delete(p.code);
      return;
    }
    if (p.leader === s) {
      p.leader = p.members[0]!;
      p.ready.add(p.leader.id);
    }
    if (p.status === "queued") {
      p.status = "idle";
      p.queueInfo = undefined;
      for (const m of p.members) m.error("queue_cancelled", "Matchmaking cancelled because a party member left.");
    }
    this.pushParty(p);
  }

  private partyState(p: Party): PartyState {
    return {
      code: p.code,
      members: p.members.map((m) => ({ id: m.id, name: m.name, ready: p.ready.has(m.id), leader: m === p.leader })),
      mode: p.mode, size: p.size, fill: p.fill, bots: p.bots, status: p.status, queue: p.queueInfo,
    };
  }

  pushParty(p: Party): void {
    const st = this.partyState(p);
    for (const m of p.members) m.send({ t: "party", party: st });
  }

  // ---------------------------------------------------------------------------
  // Matchmaking
  // ---------------------------------------------------------------------------

  private queue(s: Session): void {
    const p = s.party ?? this.createParty(s);
    if (p.leader !== s) return s.error("not_leader", "Only the party leader can start matchmaking.");
    if (p.status !== "idle") return;
    if (p.members.some((m) => !p.ready.has(m.id))) return s.error("not_ready", "Everyone in the party must be ready.");
    if (p.members.some((m) => m.room)) return s.error("busy", "A party member is still in a match.");
    if (p.mode !== "ffa") {
      if (p.members.length > p.size) return s.error("party_too_big", "Your party is larger than the squad size.");
      if (p.members.length < p.size && !p.fill)
        return s.error(
          "party_too_small",
          `Your party has ${p.members.length} of ${p.size} players. Enable "Fill squad" to team up with others, or invite friends.`,
        );
    }
    p.status = "queued";
    p.queuedAt = Date.now();
    this.pushParty(p);
    this.matchmake();
  }

  /** Runs every second: forms matches from compatible queued parties. */
  matchmake(): void {
    const now = Date.now();
    const groups = new Map<string, Party[]>();
    for (const p of this.parties.values()) {
      if (p.status !== "queued") continue;
      const k = `${p.mode}:${p.mode === "ffa" ? 1 : p.size}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
    }
    for (const [key, parties] of groups) {
      parties.sort((a, b) => a.queuedAt - b.queuedAt);
      const [mode, sizeStr] = key.split(":") as [QueueMode, string];
      const size = Number(sizeStr);
      const cfg = makeMatchConfig({ mode, arena: DISTRICT_IDS[randomInt(DISTRICT_IDS.length)]!, teamSize: size, offline: false, difficulty: "standard" });
      const oldest = (now - parties[0]!.queuedAt) / 1000;
      const humans = parties.reduce((a, p) => a + p.members.length, 0);
      const botsOk = (ps: Party[]) => ps.length > 0 && ps.every((p) => p.bots);
      let started = false;

      if (mode === "ffa") {
        const packed: Party[] = [];
        let n = 0;
        for (const p of parties) if (n + p.members.length <= cfg.maxPlayers) packed.push(p), (n += p.members.length);
        if (n >= cfg.maxPlayers || (n >= 2 && oldest >= 30) || (botsOk(packed) && oldest >= config.aiFillWait)) {
          started = this.start(cfg, packed.map((p) => [p]), botsOk(packed) ? Math.max(n, 8) : n);
        }
      } else {
        const teams = formTeams(parties, size);
        const complete = teams.filter((t) => t.reduce((a, p) => a + p.members.length, 0) === size);
        const wantTeams = mode === "br" ? cfg.teamCount : 2;
        if (complete.length >= wantTeams) started = this.start(cfg, complete.slice(0, wantTeams), cfg.maxPlayers);
        else if (mode === "br" && complete.length >= 2 && oldest >= 45) started = this.start(cfg, complete, complete.length * size);
        else if (oldest >= config.aiFillWait) {
          const use = [...complete, ...teams.filter((t) => !complete.includes(t))].slice(0, wantTeams);
          const flat = use.flat();
          if (botsOk(flat)) {
            const totalTeams = mode === "br" ? Math.min(wantTeams, Math.max(use.length, 6)) : 2;
            started = this.start(cfg, use, totalTeams * size);
          }
        }
      }

      if (!started) {
        const aiFillIn = botsOk(parties) ? Math.max(0, Math.ceil(config.aiFillWait - oldest)) : null;
        for (const p of parties) {
          p.queueInfo = { waiting: humans, needed: cfg.maxPlayers, since: p.queuedAt, aiFillIn };
          this.pushParty(p);
        }
      }
    }
  }

  /**
   * Starts a match. `teams` lists the parties on each team (FFA: one party
   * per entry, each member on their own team). `target` is the total player
   * count to reach with clearly-labelled AI bots (never disguised as humans).
   */
  private start(cfg: MatchConfig, teams: Party[][], target: number, difficulty: Difficulty = "standard"): boolean {
    if (this.rooms.size >= config.maxRooms) {
      for (const p of teams.flat()) for (const m of p.members) m.error("server_full", "All match servers are busy. Try again in a minute, or play Practice.");
      return false;
    }
    cfg.botDifficulty = difficulty;
    const room = new Room(cfg, (r) => this.onRoomClosed(r));
    this.rooms.add(room);
    let humans = 0;
    const totalHumans = teams.flat().reduce((a, p) => a + p.members.length, 0);
    if (cfg.mode === "ffa") {
      let t = 0;
      for (const team of teams) for (const p of team) for (const m of p.members) room.addHuman(m, t++, t, m.loadout), humans++;
      for (let i = humans; i < Math.min(target, cfg.maxPlayers); i++) room.addBot(t++, t);
    } else {
      teams.forEach((team, ti) => {
        let n = 0;
        for (const p of team) for (const m of p.members) room.addHuman(m, ti, ti, m.loadout), n++, humans++;
        if (target > totalHumans) for (; n < cfg.teamSize; n++) room.addBot(ti, ti);
      });
      const totalTeams = Math.ceil(target / cfg.teamSize);
      for (let ti = teams.length; ti < Math.min(totalTeams, cfg.teamCount); ti++) for (let n = 0; n < cfg.teamSize; n++) room.addBot(ti, ti);
    }
    for (const p of teams.flat()) {
      p.status = "in_match";
      p.queueInfo = undefined;
      this.pushParty(p);
    }
    room.announceStart();
    log("info", `room ${room.id} started: ${cfg.mode} ${cfg.arena} humans=${humans} total=${room.match.players.size}`);
    return true;
  }

  private startPrivate(s: Session, difficulty: Difficulty): void {
    const p = s.party ?? this.createParty(s);
    if (p.leader !== s) return s.error("not_leader", "Only the party leader can start a private match.");
    if (p.status !== "idle") return s.error("busy", "Cancel matchmaking first.");
    if (p.members.some((m) => m.room)) return s.error("busy", "A party member is still in a match.");
    if (!p.bots && p.members.length < 2) return s.error("need_players", "A private match needs 2+ players, or enable AI fill to add bots.");
    const size = p.mode === "ffa" ? 1 : p.mode === "br" ? Math.max(1, p.size) : Math.max(p.size, Math.ceil(p.members.length / 2));
    const cfg = makeMatchConfig({ mode: p.mode, arena: DISTRICT_IDS[randomInt(DISTRICT_IDS.length)]!, teamSize: size, offline: false, difficulty });
    // Split the party: TDM/DOM alternate members across teams so friends can face each other.
    const fake = (members: Session[]): Party => ({ ...p, members });
    let teams: Party[][];
    if (p.mode === "ffa") teams = p.members.map((m) => [fake([m])]);
    else if (p.mode === "br") teams = p.bots ? [[fake(p.members)]] : p.members.map((m) => [fake([m])]);
    else teams = [[fake(p.members.filter((_, i) => i % 2 === 0))], [fake(p.members.filter((_, i) => i % 2 === 1))]];
    const target = p.bots ? (p.mode === "ffa" ? 6 : p.mode === "br" ? 6 * size : cfg.maxPlayers) : p.members.length;
    if (this.start(cfg, teams, target, difficulty)) {
      p.status = "in_match";
      this.pushParty(p);
    }
  }

  private onRoomClosed(r: Room): void {
    this.rooms.delete(r);
    for (const p of this.parties.values()) {
      if (p.status === "in_match" && p.members.every((m) => !m.room || m.room === r)) {
        p.status = "idle";
        p.ready = new Set([p.leader.id]);
        this.pushParty(p);
      }
    }
  }

  tick(): void {
    for (const r of [...this.rooms]) r.tick();
  }

  stats() {
    let inMatch = 0;
    for (const r of this.rooms) inMatch += r.humanCount();
    return { online: this.sessions.size, rooms: this.rooms.size, inMatch, parties: this.parties.size };
  }
}

/** Packs queued parties into teams of `size`. Full parties stay together; partial parties (fill enabled) combine. */
export function formTeams(parties: Party[], size: number): Party[][] {
  const teams: Party[][] = [];
  const room = (t: Party[]) => size - t.reduce((a, p) => a + p.members.length, 0);
  const sorted = [...parties].sort((a, b) => b.members.length - a.members.length || a.queuedAt - b.queuedAt);
  for (const p of sorted) {
    if (p.members.length === size) {
      teams.push([p]);
      continue;
    }
    const t = teams.find((tm) => tm.every((x) => x.fill && x.members.length < size) && room(tm) >= p.members.length);
    if (t) t.push(p);
    else teams.push([p]);
  }
  return teams;
}
