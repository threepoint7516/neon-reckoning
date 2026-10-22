import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { WebSocketServer } from "ws";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, TICK_DT, getFrontierMap, parseClientMessage } from "@neon/shared";
import { config, log, originAllowed } from "./config";
import { Lobby } from "./lobby";
import { Session } from "./session";

const startedAt = Date.now();
const lobby = new Lobby();

// Generate the map once up front so the first match starts instantly.
const t0 = performance.now();
getFrontierMap();
log("info", `map generated in ${Math.round(performance.now() - t0)} ms`);

const http = createServer((req, res) => {
  const url = req.url ?? "/";
  // Health/status are public, non-personal and safe to expose cross-origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (url === "/health" || url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION, uptime: Math.round((Date.now() - startedAt) / 1000), ...lobby.stats() }));
    return;
  }
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("NEON RECKONING game server. Connect with the game client over WebSocket.\n");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found\n");
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_MESSAGE_BYTES * 2,
  perMessageDeflate: false,
  verifyClient: (info, cb) => {
    if (!originAllowed(info.origin)) {
      log("warn", "rejected upgrade from disallowed origin");
      cb(false, 403, "Origin not allowed");
      return;
    }
    if (lobby.sessions.size >= config.maxSessions) {
      cb(false, 503, "Server full");
      return;
    }
    cb(true);
  },
});

wss.on("connection", (ws) => {
  const s = new Session(ws);
  lobby.add(s);
  let dropped = 0;
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      s.strikes += 2;
    } else if (!s.allow()) {
      // Rate limited: drop silently, strike every 20 drops.
      if (++dropped % 20 === 0) s.strikes++;
    } else {
      const msg = parseClientMessage(data.toString());
      if (!msg) s.strikes++;
      else {
        try {
          lobby.handle(s, msg);
        } catch (e) {
          log("error", "handler error", e instanceof Error ? e.message : e);
          s.error("internal", "Something went wrong handling that request.");
        }
      }
    }
    if (s.strikes >= 25) {
      s.error("abuse", "Too many invalid messages — disconnected.");
      s.close(4002, "invalid traffic");
    }
  });
  ws.on("close", () => lobby.remove(s));
  ws.on("error", () => lobby.remove(s));
  // Close sockets that never complete the handshake.
  setTimeout(() => {
    if (!s.helloDone) s.close(4000, "handshake timeout");
  }, 10_000);
});

// Fixed-rate simulation loop with drift compensation.
let acc = 0;
let last = performance.now();
const loop = setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last);
  last = now;
  let n = 0;
  while (acc >= TICK_DT * 1000 && n < 4) {
    acc -= TICK_DT * 1000;
    n++;
    try {
      lobby.tick();
    } catch (e) {
      log("error", "tick error", e instanceof Error ? e.stack : e);
    }
  }
}, 5);

const mm = setInterval(() => lobby.matchmake(), 1000);
const presence = setInterval(() => {
  const n = lobby.online();
  for (const s of lobby.sessions) if (s.helloDone && !s.room) s.send({ t: "online", n });
}, 10_000);

http.listen(config.port, config.host, () => {
  log("info", `NEON RECKONING server listening on ${config.host}:${config.port}`);
  log("info", config.allowedOrigins.length ? `allowed origins: ${config.allowedOrigins.join(", ")}` : "allowed origins: localhost only (set ALLOWED_ORIGINS)");
});

function shutdown(sig: string) {
  log("info", `${sig} received, shutting down`);
  clearInterval(loop);
  clearInterval(mm);
  clearInterval(presence);
  for (const s of lobby.sessions) {
    s.error("server_restart", "The server is restarting. Please reconnect in a moment.");
    s.close(1012, "restart");
  }
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (e) => log("error", "uncaught", e.stack ?? e));
