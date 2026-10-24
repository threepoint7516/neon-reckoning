import { useEffect, useMemo, useState } from "react";
import { MODE_INFO, WEAPONS, isSoloMode } from "@neon/shared";
import { go, store, useStore } from "../../state/store";
import { challenges, recordResults } from "../../state/session";
import { MEDAL_NAMES } from "../../game/hud";
import { online } from "../../net/online";
import { startPractice } from "./Practice";
import { titleFor, useProgress, xpToNext } from "../../state/progress";
import { portal } from "../../platform/portal";
import { SupportLink } from "../components/SupportLink";
import { audio } from "../../audio/audio";

const recorded = new WeakMap<object, ReturnType<typeof recordResults>>();

export function ResultsScreen() {
  const results = useStore((s) => s.results);
  const meta = useStore((s) => s.resultsMeta);
  const match = useStore((s) => s.match);
  const cached = useMemo(() => {
    if (!results || !meta) return null;
    let r = recorded.get(results);
    if (!r) recorded.set(results, (r = recordResults(results, meta.you)));
    return r;
  }, [results, meta]);
  if (!results || !meta) return null;
  const me = results.rows.find((r) => r.id === meta.you);
  const win = !!me && results.winnerTeam >= 0 && me.team === results.winnerTeam;
  const draw = results.winnerTeam < 0;
  const br = results.mode === "br";
  const acc = me && me.shots ? Math.round((me.hits / me.shots) * 100) : 0;
  const prev = cached?.previous;
  const feedback: string[] = [];
  if (prev && me) {
    const a = me.shots ? me.hits / me.shots : 0;
    if (a > prev.accuracy + 0.03) feedback.push(`Accuracy up ${Math.round((a - prev.accuracy) * 100)}% on your last match.`);
    else if (a < prev.accuracy - 0.05) feedback.push(`Accuracy dipped ${Math.round((prev.accuracy - a) * 100)}% — try shorter bursts or aim down sights at range.`);
    if (me.kills > prev.kills) feedback.push(`${me.kills - prev.kills} more eliminations than last match.`);
  }
  if (me) {
    if (me.deaths > me.kills * 2 && me.deaths > 3) feedback.push("Lots of deaths — use cover between fights and let health regenerate.");
    if (me.hits > 10 && me.headshots / me.hits > 0.25) feedback.push("Great head-level aim this match.");
    if (me.bestStreak >= 5) feedback.push(`Best streak: ${me.bestStreak}. Bounties make you a target — stay mobile.`);
  }
  const back = () => {
    store.set({ match: null, results: null });
    if (meta.offline) go("menu");
    else {
      online.send({ t: "leave_match" });
      online.clearReconnect();
      go("play");
    }
  };
  // Portal builds: leaving the results screen is a natural ad break (no-op on your own site).
  const [adPending, setAdPending] = useState(false);
  const afterBreak = (fn: () => void) => async () => {
    if (adPending) return;
    setAdPending(true);
    await portal.adBreak();
    setAdPending(false);
    fn();
  };
  const myId = useStore((s) => s.myId);
  const party = useStore((s) => s.party);
  const isLeader = !party || party.members.find((m) => m.leader)?.id === myId;
  const playAgain = () => {
    // Back to the lobby and straight into the same queue.
    store.set({ match: null, results: null });
    online.send({ t: "leave_match" });
    online.clearReconnect();
    go("play");
    online.send({ t: "queue" });
  };
  const fav = me?.favWeapon ? WEAPONS[me.favWeapon as keyof typeof WEAPONS]?.name : null;
  return (
    <div className="screen">
      {adPending && (
        <div className="overlay ad-break">
          <div className="panel">Taking a short break…</div>
        </div>
      )}
      <div className="topbar">
        <h2 className={draw ? "" : win ? "glow-cyan" : "glow-mag"}>{draw ? "Draw" : br ? `Placed #${me?.placement || "?"}` : win ? "Victory" : "Defeat"}</h2>
        <span className="chip">
          {MODE_INFO[results.mode].name} · {results.reason} · {Math.floor(results.duration / 60)}:{String(results.duration % 60).padStart(2, "0")}
        </span>
        <span className="spacer" />
        {meta.offline && match?.practice && (
          <button className="btn primary" onClick={afterBreak(() => startPractice(match.practice!))}>
            Rematch
          </button>
        )}
        {meta.offline && (
          <button
            className="btn"
            onClick={afterBreak(() => {
              store.set({ match: null, results: null });
              go("practice");
            })}
          >
            Change setup
          </button>
        )}
        {!meta.offline && isLeader && (
          <button className="btn primary" onClick={afterBreak(playAgain)}>
            Play again
          </button>
        )}
        <button className={`btn ${meta.offline ? "primary" : ""}`} onClick={afterBreak(back)}>
          {meta.offline ? "Main menu" : "Back to lobby"}
        </button>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Scoreboard</h3>
          <table className="sb">
            <thead>
              <tr>
                <th>{br ? "#" : ""}</th>
                <th>Player</th>
                <th className="num">K</th>
                <th className="num">D</th>
                <th className="num">A</th>
                <th className="num">Dmg</th>
                <th className="num">Acc</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map((r, i) => (
                <tr key={r.id} className={r.id === meta.you ? "me" : ""}>
                  <td className="mono">{br ? r.placement || "—" : i + 1}</td>
                  <td>
                    {r.id === results.mvp && <span title="MVP">👑 </span>}
                    {r.name}
                    {r.bot && <span className="tag-bot">BOT</span>}
                    {r.id === meta.you && <span className="tag-you">YOU</span>}
                    {!br && !isSoloMode(results.mode) && <span className="muted small"> · {r.team === me?.team ? "ally" : "enemy"}</span>}
                  </td>
                  <td className="num">{r.kills}</td>
                  <td className="num">{r.deaths}</td>
                  <td className="num">{r.assists}</td>
                  <td className="num">{r.damage}</td>
                  <td className="num">{r.shots ? Math.round((r.hits / r.shots) * 100) : 0}%</td>
                  <td className="num">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.mode === "payload" && results.teamScores.length > 0 ? (
            <div className="row" style={{ marginTop: 12 }}>
              <span className={`chip ${win ? "good" : "bad"}`}>Payload pushed {results.teamScores[0]}%</span>
              <span className="muted small">{me?.team === 0 ? "You attacked" : "You defended"}</span>
            </div>
          ) : results.teamScores.length > 0 && !br && (
            <div className="row" style={{ marginTop: 12 }}>
              {results.teamScores.map((s, i) => (
                <span key={i} className={`chip ${i === me?.team ? "good" : "bad"}`}>
                  {i === me?.team ? "Your team" : "Enemy"}: {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="col" style={{ gap: 18 }}>
          <XpPanel />
          <div className="panel">
            <h3>Your performance</h3>
            {me ? (
              <div className="row" style={{ gap: 26 }}>
                <Big v={me.kills} l="Eliminations" />
                <Big v={me.deaths} l="Deaths" />
                <Big v={`${acc}%`} l="Accuracy" />
                <Big v={me.headshots} l="Headshot hits" />
                <Big v={me.damage} l="Damage" />
                <Big v={me.bestStreak} l="Best streak" />
              </div>
            ) : (
              <div className="muted">You left before the end.</div>
            )}
            {fav && <div className="small muted" style={{ marginTop: 10 }}>Most eliminations with: {fav}</div>}
            {feedback.length > 0 && (
              <ul className="small" style={{ marginTop: 12, lineHeight: 1.7 }}>
                {feedback.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3>Medals this match</h3>
            {me && Object.keys(me.medals).length ? (
              <div className="row" style={{ gap: 8 }}>
                {Object.entries(me.medals).map(([m, n]) => (
                  <span key={m} className="chip warn">
                    {MEDAL_NAMES[m] ?? m} ×{n}
                  </span>
                ))}
              </div>
            ) : (
              <div className="muted small">No medals this time.</div>
            )}
          </div>
          <div className="panel">
            <h3>Today's challenges</h3>
            {challenges.map((c) => (
              <div key={c.id} className="challenge">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small">{c.text}</span>
                  <span className="mono small">
                    {c.progress}/{c.goal} {c.progress >= c.goal ? "✔" : ""}
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${(c.progress / c.goal) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <SupportLink />
          <div className="small muted">Results exist only in this tab — nothing is saved to a profile because there are no profiles.</div>
        </div>
      </div>
    </div>
  );
}

/** XP earned this match, the level bar and anything it unlocked. */
function XpPanel() {
  const p = useProgress();
  const m = p.match;
  const total = m.combat + m.bonuses.reduce((a, b) => a + b.xp, 0);
  const gained = p.level - m.startLevel;
  useEffect(() => {
    if (gained > 0) audio.levelUp();
  }, [gained]);
  const need = xpToNext(p.level);
  return (
    <div className="panel xp-panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>+{total.toLocaleString()} XP</h3>
        <span className="small">
          Level <b>{p.level}</b> · {titleFor(p.level)}
        </span>
      </div>
      <div className="bar xp" style={{ margin: "8px 0 10px" }}>
        <i className="grow" style={{ width: `${(p.into / need) * 100}%` }} />
      </div>
      <div className="xp-rows small">
        <div>
          <span>Combat (score)</span>
          <b>+{m.combat}</b>
        </div>
        {m.bonuses.map((b, i) => (
          <div key={i}>
            <span>{b.label}</span>
            <b>+{b.xp}</b>
          </div>
        ))}
      </div>
      {gained > 0 && (
        <div className="levelup-box">
          <b>LEVEL UP{gained > 1 ? ` ×${gained}` : ""}!</b>
          {m.unlocked.length > 0 ? <span> Unlocked: {m.unlocked.join(", ")}. Pick finishes on the main menu.</span> : <span> Keep going — new finishes unlock as you level.</span>}
        </div>
      )}
      <div className="small muted" style={{ marginTop: 6 }}>
        {need - p.into} XP to level {p.level + 1}.
      </div>
    </div>
  );
}

function Big({ v, l }: { v: number | string; l: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>
        {v}
      </div>
      <div className="small muted" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {l}
      </div>
    </div>
  );
}
