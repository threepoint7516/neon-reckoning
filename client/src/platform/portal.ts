// Game-portal integration (CrazyGames / Poki).
//
// Only the portal builds (`npm run build:crazygames` / `build:poki`, i.e. Vite
// `--mode crazygames|poki`) load a portal SDK. The regular site build never
// loads any third-party script: there, every call below is a no-op.
//
// Portal rules followed here: ads only at natural breaks (leaving the results
// screen), never during play; the game is paused and muted while an ad runs;
// a failed or skipped ad never blocks the game.

import { audio } from "../audio/audio";

export type PortalId = "none" | "crazygames" | "poki";

// Compared against literals so each build keeps only its own adapter (the others,
// and their SDK URLs, are dropped from the bundle entirely).
export const PORTAL: PortalId = import.meta.env.VITE_PORTAL === "crazygames" ? "crazygames" : import.meta.env.VITE_PORTAL === "poki" ? "poki" : "none";
const ADAPTER = import.meta.env.VITE_PORTAL === "crazygames" ? crazyGames : import.meta.env.VITE_PORTAL === "poki" ? poki : null;

export const PORTAL_NAME: Record<PortalId, string> = { none: "", crazygames: "CrazyGames", poki: "Poki" };

interface Adapter {
  init(): Promise<void>;
  loadingDone(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Resolves when the break is over (ad finished, failed or not shown). */
  adBreak(onStart: () => void): Promise<void>;
}

interface CrazySdk {
  init(): Promise<void>;
  game: { loadingStart(): void; loadingStop(): void; gameplayStart(): void; gameplayStop(): void };
  ad: { requestAd(type: "midgame", cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }): void };
}
interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<unknown>;
}
export type PortalWindow = Window & { CrazyGames?: { SDK: CrazySdk }; PokiSDK?: PokiSdk };

/** If an ad hasn't started this quickly, assume none will (portals silently skip early requests). */
export const AD_START_TIMEOUT = 2500;
/** Hard cap on a break, so a stuck SDK can never freeze the game. */
export const AD_MAX = 60_000;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
}

export function crazyGames(w: PortalWindow): Adapter {
  let sdk: CrazySdk | null = null;
  return {
    async init() {
      if (!w.CrazyGames) await loadScript("https://sdk.crazygames.com/crazygames-sdk-v3.js");
      sdk = w.CrazyGames!.SDK;
      await sdk.init();
      sdk.game.loadingStart();
    },
    loadingDone: () => sdk?.game.loadingStop(),
    gameplayStart: () => sdk?.game.gameplayStart(),
    gameplayStop: () => sdk?.game.gameplayStop(),
    adBreak: (onStart) =>
      new Promise<void>((resolve) => {
        if (!sdk) return resolve();
        sdk.ad.requestAd("midgame", { adStarted: onStart, adFinished: () => resolve(), adError: () => resolve() });
      }),
  };
}

export function poki(w: PortalWindow): Adapter {
  let sdk: PokiSdk | null = null;
  return {
    async init() {
      if (!w.PokiSDK) await loadScript("https://game-cdn.poki.com/scripts/v2/poki-sdk.js");
      sdk = w.PokiSDK!;
      await sdk.init();
    },
    loadingDone: () => sdk?.gameLoadingFinished(),
    gameplayStart: () => sdk?.gameplayStart(),
    gameplayStop: () => sdk?.gameplayStop(),
    adBreak: async (onStart) => {
      if (sdk) await sdk.commercialBreak(onStart);
    },
  };
}

/** Portal pages embed the game in an iframe: keep Space/arrows and wheel from scrolling the host page. */
function containScrolling(): void {
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  });
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.overscrollBehavior = "none";
}

/** Thin, safe facade over the active portal (or nothing). */
export function createPortal(
  id: PortalId,
  factory: ((w: PortalWindow) => Adapter) | null,
  w: PortalWindow = globalThis as unknown as PortalWindow,
  mute: (on: boolean) => void = (on) => audio.setAdMute(on),
) {
  const adapter = factory ? factory(w) : null;
  let ready: Promise<boolean> = Promise.resolve(false);
  let playing = false;
  let breaking = false;
  const safe = (f: () => void) => {
    try {
      f();
    } catch (e) {
      console.warn("[portal]", e);
    }
  };
  return {
    id,
    active: !!adapter,
    /** Loads and initializes the portal SDK (call once at startup). Never throws. */
    init(): Promise<boolean> {
      if (!adapter) return ready;
      if (typeof document !== "undefined") containScrolling();
      ready = adapter.init().then(
        () => true,
        (e) => {
          console.warn("[portal] SDK unavailable — continuing without it", e);
          return false;
        },
      );
      return ready;
    },
    /** Boot finished; the menu is ready. */
    loadingDone(): void {
      void ready.then((ok) => ok && safe(() => adapter!.loadingDone()));
    },
    /** Reports whether the player is actively playing (deduplicated). */
    gameplay(on: boolean): void {
      if (!adapter || on === playing || breaking) return;
      playing = on;
      void ready.then((ok) => ok && safe(() => (on ? adapter.gameplayStart() : adapter.gameplayStop())));
    },
    /**
     * A natural break (leaving the results screen). Mutes the game while an
     * ad plays; resolves when it's over, skipped or failed — never hangs.
     */
    async adBreak(): Promise<void> {
      if (!adapter || breaking || !(await ready)) return;
      // Report the stop before requesting the ad (synchronously: the SDK is ready).
      if (playing) {
        playing = false;
        safe(() => adapter.gameplayStop());
      }
      breaking = true;
      let started = false;
      let over = false;
      let finish: () => void = () => {};
      const done = new Promise<void>((r) => (finish = () => ((over = true), r())));
      const startTimer = setTimeout(() => !started && finish(), AD_START_TIMEOUT);
      const capTimer = setTimeout(finish, AD_MAX);
      try {
        adapter
          .adBreak(() => {
            // A start signal after we already gave up waiting is ignored.
            if (over) return;
            started = true;
            clearTimeout(startTimer);
            mute(true);
          })
          .then(finish, finish);
      } catch {
        finish();
      }
      await done;
      clearTimeout(startTimer);
      clearTimeout(capTimer);
      if (started) mute(false);
      breaking = false;
    },
  };
}

export const portal = createPortal(PORTAL, ADAPTER);
