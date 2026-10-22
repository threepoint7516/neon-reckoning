import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, Btn } from "@neon/shared";
import type { ServerMessage } from "@neon/shared";

const PORT = 3900 + Math.floor(Math.random() * 500);
const URL = `ws://127.0.0.1:${PORT}`;
let proc: ChildProcess;

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  closed = false;
  constructor() {
    this.ws = new WebSocket(URL, { origin: "http://localhost:5173" });
    this.ws.on("message", (d) => this.msgs.push(JSON.parse(d.toString())));
    this.ws.on("close", () => (this.closed = true));
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
  }
  send(o: unknown) {
    this.ws.send(typeof o === "string" ? o : JSON.stringify(o));
  }
  async wait<T extends ServerMessage["t"]>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 8000) {
    const start = Date.now();
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t && pred(m as never));
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      if (Date.now() - start > ms) throw new Error(`timeout waiting for ${t}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

async function connect(name: string) {
  const c = new Client();
  await c.open();
  c.send({ t: "hello", v: PROTOCOL_VERSION, name });
  await c.wait("welcome");
  return c;
}

beforeAll(async () => {
  proc = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], { env: { ...process.env, PORT: String(PORT), AI_FILL_WAIT: "2" }, stdio: "pipe" });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}, 30000);

afterAll(() => {
  proc?.kill();
});

describe("game server", () => {
  it("serves a health endpoint", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    const j = (await r.json()) as { ok: boolean; version: number };
    expect(j.ok).toBe(true);
    expect(j.version).toBe(PROTOCOL_VERSION);
  });

  it("sanitizes names and generates one when invalid", async () => {
    const c = new Client();
    await c.open();
    c.send({ t: "hello", v: PROTOCOL_VERSION, name: "<script>" });
    const w = await c.wait("welcome");
    expect(w.name).toBe("script");
    c.ws.close();
  });

  it("rejects bad room codes with a clear error", async () => {
    const c = await connect("Tester");
    c.send({ t: "party_join", code: "ZZZZZ" });
    const e = await c.wait("error");
    expect(e.code).toBe("no_such_party");
    c.send({ t: "party_join", code: "!!" });
    expect((await c.wait("error")).code).toBe("bad_code");
    c.ws.close();
  });

  it("enforces party size: solo can't queue for squads without fill", async () => {
    const c = await connect("Solo");
    c.send({ t: "party_create" });
    await c.wait("party", (m) => !!m.party);
    c.send({ t: "party_settings", mode: "tdm", size: 4, fill: false, bots: false });
    await c.wait("party", (m) => m.party?.size === 4);
    c.send({ t: "queue" });
    expect((await c.wait("error")).code).toBe("party_too_small");
    c.ws.close();
  });

  it("parties, private matches and synchronized movement/combat between two clients", async () => {
    const a = await connect("Alpha");
    const b = await connect("Bravo");
    a.send({ t: "party_create" });
    const pa = await a.wait("party", (m) => !!m.party);
    b.send({ t: "party_join", code: pa.party!.code });
    await b.wait("party", (m) => (m.party?.members.length ?? 0) === 2);
    a.send({ t: "party_settings", mode: "tdm", size: 2, fill: true, bots: false });
    b.send({ t: "party_ready", ready: true });
    await a.wait("party", (m) => !!m.party?.members.every((x) => x.ready) && m.party.mode === "tdm");
    a.send({ t: "start_private", difficulty: "standard" });
    const sa = await a.wait("match_start");
    const sb = await b.wait("match_start");
    expect(sa.info.roster.length).toBe(2); // no bots: AI fill disabled
    expect(sa.info.roster.every((r) => !r.bot)).toBe(true);
    const ta = sa.info.roster.find((r) => r.i === sa.info.you)!.t;
    const tb = sb.info.roster.find((r) => r.i === sb.info.you)!.t;
    expect(ta).not.toBe(tb);

    // Wait for the live phase, then move A forward and check B sees it.
    await a.wait("snap", (m) => m.s.m.ph === "live", 10000);
    const first = await b.wait("snap", (m) => m.s.ps.some((p) => p.i === sa.info.you));
    const startPos = first.s.ps.find((p) => p.i === sa.info.you)!;
    let seq = 1;
    for (let k = 0; k < 30; k++) {
      a.send({ t: "input", i: Array.from({ length: 4 }, () => ({ seq: seq++, mx: 0, mz: 1, yaw: 0, pitch: 0, b: Btn.SPRINT, vt: 0 })) });
      await new Promise((r) => setTimeout(r, 60));
    }
    const later = await b.wait("snap", (m) => {
      const p = m.s.ps.find((x) => x.i === sa.info.you);
      return !!p && Math.hypot(p.x - startPos.x, p.z - startPos.z) > 3;
    });
    expect(later).toBeTruthy();
    // Server acknowledges processed inputs.
    const ack = await a.wait("snap", (m) => m.s.ack > 50);
    expect(ack.s.me!.id).toBe(sa.info.you);

    // Reconnect: B drops and rejoins with its token.
    b.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const b2 = await connect("Bravo");
    b2.send({ t: "reconnect", token: sb.info.reconnectToken });
    const again = await b2.wait("match_start");
    expect(again.info.you).toBe(sb.info.you);

    a.send({ t: "leave_match" });
    b2.send({ t: "leave_match" });
    a.ws.close();
    b2.ws.close();
  }, 30000);

  it("matchmaking fills with labelled bots after the wait when allowed", async () => {
    const c = await connect("Queuer");
    c.send({ t: "party_create" });
    await c.wait("party", (m) => !!m.party);
    c.send({ t: "party_settings", mode: "ffa", size: 1, fill: true, bots: true });
    await c.wait("party", (m) => m.party?.mode === "ffa");
    c.send({ t: "queue" });
    const q = await c.wait("party", (m) => m.party?.status === "queued" && !!m.party.queue);
    expect(q.party!.queue!.waiting).toBeGreaterThanOrEqual(1);
    const ms = await c.wait("match_start", () => true, 10000);
    const bots = ms.info.roster.filter((r) => r.bot);
    expect(bots.length).toBeGreaterThan(0);
    expect(bots.every((b) => b.n.startsWith("BOT "))).toBe(true);
    c.send({ t: "leave_match" });
    c.ws.close();
  }, 20000);

  it("disconnects clients that spam invalid messages", async () => {
    const c = await connect("Spammer");
    for (let i = 0; i < 40; i++) c.send("{garbage");
    for (let i = 0; i < 50 && !c.closed; i++) await new Promise((r) => setTimeout(r, 50));
    expect(c.closed).toBe(true);
  });

  it("rejects connections from disallowed origins", async () => {
    const ws = new WebSocket(URL, { origin: "https://evil.example" });
    const code = await new Promise<number | string>((res) => {
      ws.on("unexpected-response", (_req, r) => res(r.statusCode ?? 0));
      ws.on("open", () => res("open"));
      ws.on("error", () => res("error"));
    });
    expect(code).toBe(403);
  });
});
