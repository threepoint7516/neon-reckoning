import { useEffect, useState } from "react";
import { BR_PLAYERS, MODE_INFO, ONLINE_TEAM_SIZE, isSoloMode } from "@neon/shared";
import type { PartySize, QueueMode } from "@neon/shared";
import { go, store, toast, useStore } from "../../state/store";
import { online } from "../../net/online";
import { LoadoutPicker } from "../components/LoadoutPicker";
import { ServerBadge } from "./Menus";
import { audio } from "../../audio/audio";

const SIZES: [PartySize, string][] = [
  [1, "Solo"],
  [2, "Duo"],
  [3, "Trio"],
  [4, "Squad"],
];
const MODES: QueueMode[] = ["tdm", "ffa", "gungame", "dom", "payload", "br"];

/** Online play: party, mode/size selection and honest matchmaking status. */
export function PlayScreen() {
  const net = useStore((s) => s.net);
  const party = useStore((s) => s.party);
  const myId = useStore((s) => s.myId);
  const loadout = useStore((s) => s.loadout);
  const [joinCode, setJoinCode] = useState("");
  const [difficulty, setDifficulty] = useState<"rookie" | "standard" | "veteran" | "elite">("standard");

  // Connect on demand and make sure we always have a (solo) party with a code.
  useEffect(() => {
    let alive = true;
    void online.connect().then((ok) => {
      if (!alive || !ok) return;
      online.send({ t: "loadout", loadout: store.get().loadout });
      const invite = store.get().pendingInvite;
      if (invite) {
        store.set({ pendingInvite: null });
        history.replaceState(null, "", location.pathname);
        online.send({ t: "party_join", code: invite });
      } else if (!store.get().party) online.send({ t: "party_create" });
    });
    return () => {
      alive = false;
    };
  }, []);

  // Left or got removed from a party: fall back to a fresh solo party.
  useEffect(() => {
    if (net.status !== "online" || party || store.get().pendingInvite) return;
    const id = window.setTimeout(() => {
      if (!store.get().party && store.get().net.status === "online") online.send({ t: "party_create" });
    }, 400);
    return () => clearTimeout(id);
  }, [net.status, party]);

  const leader = party?.members.find((m) => m.leader)?.id === myId;
  const me = party?.members.find((m) => m.id === myId);
  const queued = party?.status === "queued";
  const busy = party?.status !== "idle";
  const canEdit = !!party && leader && !busy;
  const settings = (p: Partial<{ mode: QueueMode; size: PartySize; fill: boolean; bots: boolean }>) => {
    if (!party) return;
    const next = { mode: party.mode, size: party.size, fill: party.fill, bots: party.bots, ...p };
    if (isSoloMode(next.mode)) next.size = 1;
    else if (next.size < party.members.length) next.size = party.members.length as PartySize;
    online.send({ t: "party_settings", ...next });
  };

  if (net.status === "unconfigured" || net.status === "error") {
    return (
      <div className="screen">
        <div className="topbar">
          <button className="btn" onClick={() => go("menu")}>
            ← Back
          </button>
          <h2>Play online</h2>
        </div>
        <div className="panel" style={{ maxWidth: 640 }}>
          <h3>Multiplayer unavailable</h3>
          <p>{net.error ?? "Couldn't reach the game server."}</p>
          <p className="small muted">
            We never fake online players. You can retry, or jump into Practice — the same game rules, offline, against clearly-labelled AI.
          </p>
          <div className="row">
            {net.status === "error" && (
              <button className="btn" onClick={() => void online.connect()}>
                Retry
              </button>
            )}
            <button className="btn primary" onClick={() => go("practice")}>
              Play Practice instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  const inviteUrl = party ? `${location.origin}${location.pathname}?party=${party.code}` : "";
  const sizeLabel = SIZES.find((s) => s[0] === party?.size)?.[1] ?? "Solo";
  const qi = party?.queue;
  return (
    <div className="screen">
      <div className="topbar">
        <button
          className="btn"
          onClick={() => {
            if (queued) online.send({ t: "cancel_queue" });
            go("menu");
          }}
        >
          ← Back
        </button>
        <h2>Play online</h2>
        <span className="spacer" />
        {net.status === "online" ? <span className="chip good">{net.online ?? "?"} connected · {net.ping ?? "—"} ms</span> : <span className="chip warn">Connecting…</span>}
      </div>
      <div className="grid2">
        <div className="col" style={{ gap: 18 }}>
          <div className="panel">
            <h3>Mode {!canEdit && party && !leader ? "· set by party leader" : ""}</h3>
            <div className="grid2" style={{ gap: 10 }}>
              {MODES.map((m) => (
                <button key={m} aria-label={`${MODE_INFO[m].name} mode`} aria-pressed={party?.mode === m} className={`card ${party?.mode === m ? "sel" : ""} ${!canEdit ? "disabled" : ""}`} disabled={!canEdit} onClick={() => settings({ mode: m })}>
                  <h4>{MODE_INFO[m].name}</h4>
                  <p>{MODE_INFO[m].blurb}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Squad size</h3>
            <div className="seg">
              {SIZES.map(([n, l]) => (
                <button
                  key={n}
                  className={party?.size === n ? "on" : ""}
                  disabled={!canEdit || isSoloMode(party?.mode ?? "tdm") || (party && n < party.members.length)}
                  onClick={() => settings({ size: n })}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {party?.mode === "ffa" || party?.mode === "gungame"
                ? `${MODE_INFO[party.mode].name}: 12 players, everyone for themselves. Friends in your party join the same match as rivals.`
                : party?.mode === "br"
                  ? `Battle Royale: ${BR_PLAYERS} players in squads of ${party?.size ?? 1}. Your party always stays together.`
                  : `Matches are ${ONLINE_TEAM_SIZE}v${ONLINE_TEAM_SIZE}. Your party always stays together on one team; the rest is filled with other players or labelled AI.`}
            </div>
            <div className="col" style={{ marginTop: 12, gap: 8 }}>
              {party?.mode === "br" && (
                <>
                  <label className="check">
                    <input type="checkbox" disabled={!canEdit} checked={!!party?.fill} onChange={(e) => settings({ fill: e.target.checked })} />
                    Fill squad with other players
                  </label>
                  <div className="small muted" style={{ marginLeft: 26 }}>
                    Off = you'll only be matched as a full {sizeLabel.toLowerCase()} — solo players are never put into a squad unless this is on.
                  </div>
                </>
              )}
              <label className="check">
                <input type="checkbox" disabled={!canEdit} checked={!!party?.bots} onChange={(e) => settings({ bots: e.target.checked })} />
                Allow AI fill
              </label>
              <div className="small muted" style={{ marginLeft: 26 }}>
                If nobody else is online, the match starts in a couple of seconds with AI players (always labelled BOT); otherwise empty slots are filled after a short wait. You may also drop into a running match in place of a bot, and bots take over for anyone who leaves. Turn off to wait for humans only.
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>Loadout</h3>
            <LoadoutPicker
              value={loadout}
              onChange={(l) => {
                store.set({ loadout: l });
                online.send({ t: "loadout", loadout: l });
              }}
            />
          </div>
        </div>

        <div className="col" style={{ gap: 18 }}>
          <div className="panel">
            <h3>Party</h3>
            {!party ? (
              <div className="muted">Setting up your party…</div>
            ) : (
              <>
                <div className="row">
                  <div>
                    <div className="small muted">Room code</div>
                    <div className="mono glow-cyan" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.25em" }}>
                      {party.code}
                    </div>
                  </div>
                  <span className="spacer" />
                  <button
                    className="btn small"
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteUrl).then(
                        () => toast("Invite link copied", "ok"),
                        () => toast(inviteUrl),
                      );
                    }}
                  >
                    Copy invite link
                  </button>
                </div>
                <div className="col" style={{ marginTop: 12, gap: 6 }}>
                  {party.members.map((m) => (
                    <div key={m.id} className="row" style={{ padding: "8px 12px", background: "#f3f8ff", borderRadius: 12 }}>
                      <span>{m.leader ? "★" : "•"}</span>
                      <b>{m.name}</b>
                      {m.id === myId && <span className="tag-you">YOU</span>}
                      <span className="spacer" />
                      <span className={`chip ${m.ready ? "good" : "warn"}`}>{m.ready ? "Ready" : "Not ready"}</span>
                      {leader && m.id !== myId && !busy && (
                        <button className="btn small danger" onClick={() => online.send({ t: "party_kick", id: m.id })}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, Math.min(4, isSoloMode(party.mode) ? 4 : party.size) - party.members.length) }).map((_, i) => (
                    <div key={`e${i}`} className="row muted small" style={{ padding: "8px 12px", border: "2px dashed var(--line)", borderRadius: 12 }}>
                      Open slot — share the code or link
                    </div>
                  ))}
                </div>
                {!leader && !busy && (
                  <button className={`btn ${me?.ready ? "" : "primary"}`} style={{ marginTop: 12 }} onClick={() => online.send({ t: "party_ready", ready: !me?.ready })}>
                    {me?.ready ? "Unready" : "Ready up"}
                  </button>
                )}
                <form
                  className="row"
                  style={{ marginTop: 14 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (joinCode.trim().length !== 5) {
                      toast("Room codes have 5 characters.", "error");
                      return;
                    }
                    online.send({ t: "party_join", code: joinCode.trim().toUpperCase() });
                    setJoinCode("");
                  }}
                >
                  <input className="input mono" placeholder="Join with code" value={joinCode} maxLength={5} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ width: 160, letterSpacing: "0.3em" }} />
                  <button className="btn small" type="submit" disabled={busy}>
                    Join
                  </button>
                  {party.members.length > 1 && (
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() => online.send({ t: "party_leave" })}
                    >
                      Leave party
                    </button>
                  )}
                </form>
              </>
            )}
          </div>

          <div className="panel">
            <h3>Matchmaking</h3>
            {queued ? (
              <div className="col">
                <div className="row">
                  <span className="dot blink" style={{ color: "var(--cyan)" }} />
                  <b>
                    Searching {MODE_INFO[party!.mode].name} · {sizeLabel}
                  </b>
                </div>
                {qi && (
                  <>
                    <div className="small">
                      {qi.waiting} player{qi.waiting === 1 ? "" : "s"} queuing for this mode right now (match size {qi.needed}).
                    </div>
                    <div className="small muted">Waiting {Math.round((Date.now() - qi.since) / 1000)}s.</div>
                    <div className="small" style={{ color: qi.aiFillIn !== null ? "var(--cyan)" : "var(--yellow)" }}>
                      {qi.aiFillIn !== null
                        ? qi.aiFillIn > 0
                          ? `If no one else joins, labelled AI will fill empty slots in ~${qi.aiFillIn}s.`
                          : "Starting with AI fill…"
                        : "AI fill is off — the match starts only when enough real players queue. This can take a while at quiet times."}
                    </div>
                  </>
                )}
                {leader && (
                  <button className="btn danger" onClick={() => online.send({ t: "cancel_queue" })}>
                    Cancel search
                  </button>
                )}
              </div>
            ) : party?.status === "in_match" ? (
              <div className="muted">Your party is in a match…</div>
            ) : (
              <div className="col">
                <button
                  className="btn primary big"
                  disabled={!party || !leader || net.status !== "online"}
                  onClick={() => {
                    audio.uiClick();
                    online.send({ t: "queue" });
                  }}
                >
                  Find match
                </button>
                {!leader && party && <div className="small muted">Waiting for the party leader to start matchmaking.</div>}
                {leader && party && party.members.some((m) => !m.ready) && <div className="small" style={{ color: "var(--yellow)" }}>Everyone must be ready first.</div>}
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn" disabled={!party || !leader} onClick={() => online.send({ t: "start_private", difficulty })}>
                    Start private match
                  </button>
                  <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} disabled={!leader}>
                    <option value="rookie">Rookie AI</option>
                    <option value="standard">Standard AI</option>
                    <option value="veteran">Veteran AI</option>
                    <option value="elite">Elite AI</option>
                  </select>
                </div>
                <div className="small muted">
                  Private matches start immediately with just your party{party?.bots ? " plus AI fill" : ""}. In team modes, party members are split across both teams.
                </div>
              </div>
            )}
          </div>
          <ServerBadge />
        </div>
      </div>
    </div>
  );
}
