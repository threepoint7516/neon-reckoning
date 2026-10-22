import { PROTOCOL_VERSION } from "@neon/shared";
import type { ClientMessage, ServerMessage } from "@neon/shared";
import type { Connection } from "./connection";
import { serverUrl } from "./connection";
import { go, store, toast } from "../state/store";

/**
 * Persistent WebSocket to the authoritative server (lobby + matches).
 * Created on demand when the player opens multiplayer — Practice never
 * touches the network.
 */
class OnlineClient implements Connection {
  readonly kind = "online" as const;
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerMessage) => void>();
  private pingTimer: number | null = null;
  private reconnectToken: string | null = null;
  private reconnectAttempts = 0;
  private wantOpen = false;
  private connectPromise: Promise<boolean> | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && store.get().net.status === "online";
  }

  connect(): Promise<boolean> {
    const url = serverUrl();
    if (!url) {
      store.set({ net: { status: "unconfigured", online: null, ping: null, error: "No multiplayer server is configured for this build." } });
      return Promise.resolve(false);
    }
    if (this.connected) return Promise.resolve(true);
    if (this.connectPromise) return this.connectPromise;
    this.wantOpen = true;
    store.set((s) => ({ net: { ...s.net, status: "connecting", error: null } }));
    this.connectPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          resolve(ok);
        }
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        store.set({ net: { status: "error", online: null, ping: null, error: "Invalid server address." } });
        done(false);
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          store.set({ net: { status: "error", online: null, ping: null, error: "The game server didn't respond. It may be offline or waking up." } });
          done(false);
        }
      }, 9000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name: store.get().name } satisfies ClientMessage));
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (m.t === "welcome") {
          clearTimeout(timeout);
          this.reconnectAttempts = 0;
          store.set({ myId: m.id, name: m.name, net: { status: "online", online: m.online, ping: null, error: null } });
          this.startPing();
          if (this.reconnectToken) this.send({ t: "reconnect", token: this.reconnectToken });
          done(true);
        }
        this.dispatch(m);
      };
      ws.onerror = () => {
        /* handled by onclose */
      };
      ws.onclose = (ev) => {
        clearTimeout(timeout);
        this.stopPing();
        const wasOnline = store.get().net.status === "online";
        this.ws = null;
        done(false);
        if (!this.wantOpen) {
          store.set({ net: { status: "idle", online: null, ping: null, error: null } });
          return;
        }
        const reason =
          ev.code === 4001 ? "Client out of date — refresh the page." : ev.code === 4002 ? "Disconnected for invalid traffic." : ev.code === 1012 ? "Server restarting." : wasOnline ? "Connection lost." : "Couldn't reach the game server.";
        store.set({ net: { status: "error", online: null, ping: null, error: reason } });
        // In a match: try to reconnect a few times within the grace window.
        if (store.get().match && !store.get().match!.offline && this.reconnectToken && this.reconnectAttempts < 5 && ev.code !== 4001 && ev.code !== 4002) {
          this.reconnectAttempts++;
          toast(`Connection lost — reconnecting (${this.reconnectAttempts}/5)…`, "error");
          window.setTimeout(() => void this.connect(), 1000 * this.reconnectAttempts);
        } else if (store.get().match && !store.get().match!.offline) {
          this.dispatch({ t: "error", code: "disconnected", message: "Disconnected from the match." });
        } else if (store.get().party) {
          store.set({ party: null });
          toast(reason, "error");
        }
      };
    });
    return this.connectPromise;
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.send({ t: "ping", c: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private dispatch(m: ServerMessage): void {
    switch (m.t) {
      case "pong":
        store.set((s) => ({ net: { ...s.net, ping: Math.round(performance.now() - m.c) } }));
        break;
      case "online":
        store.set((s) => ({ net: { ...s.net, online: m.n } }));
        break;
      case "named":
        store.set({ name: m.name });
        break;
      case "party":
        store.set({ party: m.party });
        break;
      case "match_start":
        this.reconnectToken = m.info.reconnectToken;
        if (!store.get().match || store.get().match!.info.matchId !== m.info.matchId) {
          store.set({ match: { info: m.info, conn: this, offline: false } });
          go("loading");
        }
        break;
      case "match_end":
        this.reconnectToken = null;
        break;
      case "error":
        if (m.code === "reconnect_failed") {
          this.reconnectToken = null;
          if (store.get().match && !store.get().match!.offline) {
            store.set({ match: null });
            go("menu");
          }
        }
        if (m.code !== "disconnected") toast(m.message, "error");
        break;
    }
    for (const l of this.listeners) l(m);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clearReconnect(): void {
    this.reconnectToken = null;
  }

  close(): void {
    this.wantOpen = false;
    this.reconnectToken = null;
    this.ws?.close();
    this.ws = null;
  }
}

export const online = new OnlineClient();
