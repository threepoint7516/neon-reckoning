import { useEffect, useReducer, useRef, useState } from "react";
import { onlineEnabled } from "../../net/connection";
import { portal } from "../../platform/portal";
import { MODE_INFO, districtMeta } from "@neon/shared";
import type { DistrictId } from "@neon/shared";
import { Game } from "../../game/Game";
import { go, store, useStore } from "../../state/store";
import { Hud } from "../hud/Hud";
import { DeathPanel, MapOverlay, PauseMenu, Scoreboard } from "../hud/Overlays";
import { audio } from "../../audio/audio";
import { settingsStore } from "../../state/settings";
import { online } from "../../net/online";
import "../../styles/hud.css";

const TIPS = [
  "Sprint, then press crouch to slide — jump out of a slide to keep your momentum.",
  "Crouch-walking is silent. Sprinting footsteps carry a long way.",
  "Explosions are blocked by cover. Duck behind a wall when a frag lands.",
  "Power weapons spawn near district centres and carry limited ammo. Risky to grab, decisive to hold.",
  "Look away from a flashbang to cut its effect to a fraction.",
  "Shoot enemy proximity mines to disarm them — they blink red.",
  "An EMP strips armor and fries shields, mines and charges in its radius.",
  "Headshots hurt: Longshot-X one-shots to the head through full armor.",
  "Ending someone's 5-kill streak collects their bounty.",
  "Data Caches grant Overdrive: faster movement, reloads and abilities.",
  "Railspike rounds punch through thin cover and multiple targets.",
  "Ladders: hold forward to climb, jump to kick off.",
  "Slide-hop: land while holding crouch to flow straight into another slide and keep your speed.",
  "You have a double jump — use it to reach ledges and dodge mid-air.",
  "Green jump pads beside buildings launch you straight onto the roof.",
  "Gun Game: every kill swaps your weapon. The pistol is last — one kill with it wins.",
  "Battle Royale: watch for the SUPPLY DROP beam — power weapon and armor inside.",
  "Battle Royale: knocked out in the first 90 seconds? You glide back in once.",
  "After you respawn, the player who got you is marked for a few seconds. Revenge pays +50.",
  "Shoot loot crates open for a random pickup.",
  "Level up to unlock new weapon camos — pick one on the main menu.",
];

/** Hosts the 3D canvas, the HUD and every in-match overlay. */
export function GameView() {
  const match = useStore((s) => s.match);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Portals: the pause menu is a break in play.
  useEffect(() => {
    if (game && !game.ended) portal.gameplay(!paused);
  }, [game, paused]);
  const [locked, setLocked] = useState(false);
  const [disconnected, setDisconnected] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const tip = useRef(TIPS[Math.floor(Math.random() * TIPS.length)]!);

  useEffect(() => {
    if (!match || !canvasRef.current) return;
    let g: Game | null = null;
    let cancelled = false;
    // Let the loading overlay paint before the (synchronous) world build.
    const id = window.setTimeout(() => {
      if (cancelled) return;
      try {
        g = new Game(canvasRef.current!, match.conn, match.info, {
          onEnd: (results) => {
            store.set({ results, resultsMeta: { you: match.info.you, offline: match.offline, teamNames: [] } });
            go("results");
          },
          onPauseChange: (p) => setPaused(p),
          onDisconnected: (msg) => setDisconnected(msg),
        });
        g.start();
        setGame(g);
        // Development-only handle for automated testing in the browser console.
        if (import.meta.env.DEV) (window as unknown as { __game?: Game }).__game = g;
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(id);
      g?.dispose();
    };
  }, [match]);

  useEffect(() => {
    const onLock = () => setLocked(document.pointerLockElement === canvasRef.current);
    document.addEventListener("pointerlockchange", onLock);
    const i = setInterval(force, 200);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      clearInterval(i);
    };
  }, []);

  // Escape when not locked closes the pause menu cleanly.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Escape" && game && paused) game.setPaused(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [game, paused]);

  if (!match) return null;
  const cfg = match.info.config;
  const meta = cfg.arena === "frontier" ? { name: "Neon Frontier", tagline: "The whole region — eight districts and the bay" } : districtMeta(cfg.arena as DistrictId);

  const leave = () => {
    audio.uiClick();
    game?.leave();
    store.set({ match: null });
    if (!match.offline) {
      online.clearReconnect();
      go("play");
    } else go("menu");
  };

  const alive = game?.hud.alive ?? true;
  const showClick = !!game && !locked && !game.inputCaptured && !paused && !game.ended && !disconnected && (alive || cfg.mode === "br" ? alive : false);
  return (
    <div className="game-root">
      <canvas ref={canvasRef} onClick={() => game && !paused && game.requestLock()} />
      {!game && !error && (
        <div className="overlay" style={{ background: "linear-gradient(180deg, #0b1a45, #2a4f8a)", flexDirection: "column", textAlign: "center" }}>
          <div className="tagline" style={{ marginTop: 0 }}>
            {MODE_INFO[cfg.mode].name} {match.offline ? (onlineEnabled() ? "· Practice (offline)" : "· vs AI") : "· Online"}
          </div>
          <h1 style={{ fontSize: 60, margin: "10px 0", fontWeight: 900, color: "#ffd23f", WebkitTextStroke: "3px #1f2a44", textShadow: "0 6px 0 #1f2a44" }}>
            {meta.name.toUpperCase()}
          </h1>
          <div className="muted">{meta.tagline}</div>
          <div className="boot" style={{ marginTop: 26 }}>
            <div className="progress" style={{ margin: "0 auto" }}>
              <i style={{ width: "70%" }} className="blink" />
            </div>
          </div>
          <div className="small muted mono" style={{ marginTop: 10 }}>
            Building district geometry…
          </div>
          <div className="panel" style={{ marginTop: 30, maxWidth: 560 }}>
            <h3>Tip</h3>
            <div className="small">{tip.current}</div>
          </div>
        </div>
      )}
      {error && (
        <div className="overlay">
          <div className="panel" style={{ maxWidth: 560 }}>
            <h3>Couldn't start the renderer</h3>
            <p className="small">{error}</p>
            <p className="small muted">Try the Low graphics preset, update your browser, or enable hardware acceleration.</p>
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  settingsStore.set({ quality: "low", bloom: false, shadows: false, rain: false });
                  leave();
                }}
              >
                Switch to Low & go back
              </button>
            </div>
          </div>
        </div>
      )}
      {game && <Hud game={game} />}
      {game && !alive && !game.ended && <DeathPanel game={game} />}
      {game && game.scoreboardOpen && !paused && <Scoreboard game={game} />}
      {game && game.mapOpen && !paused && <MapOverlay game={game} />}
      {game && showClick && game.hud.alive && (
        <div className="click-to-play" onClick={() => game.requestLock()}>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "0.12em", color: "#ffd23f", WebkitTextStroke: "2px #1f2a44", textShadow: "0 4px 0 #1f2a44" }}>
            CLICK TO PLAY
          </div>
          <div className="small muted">Mouse is captured while playing · Esc opens the menu</div>
        </div>
      )}
      {game && paused && <PauseMenu game={game} onResume={() => game.setPaused(false)} onLeave={leave} />}
      {disconnected && (
        <div className="overlay">
          <div className="panel" style={{ maxWidth: 520 }}>
            <h3>Disconnected</h3>
            <p>{disconnected}</p>
            <p className="small muted">Reconnection attempts failed. Your match result could not be recorded.</p>
            <div className="row">
              <button className="btn" onClick={leave}>
                Back to lobby
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  store.set({ match: null });
                  go("practice");
                }}
              >
                Play Practice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
