import { afterEach, describe, expect, it, vi } from "vitest";
import { AD_START_TIMEOUT, PORTAL, createPortal, crazyGames, poki } from "../src/platform/portal";
import type { PortalWindow } from "../src/platform/portal";

/** A fake adapter that records calls; `ad` decides how the ad break plays out. */
function fakeAdapter(ad: "plays" | "skipped" | "throws" = "plays", initFails = false) {
  const calls: string[] = [];
  const factory = () => ({
    init: () => (initFails ? Promise.reject(new Error("blocked")) : Promise.resolve()),
    loadingDone: () => void calls.push("loadingDone"),
    gameplayStart: () => void calls.push("start"),
    gameplayStop: () => void calls.push("stop"),
    adBreak: (onStart: () => void) => {
      calls.push("adBreak");
      if (ad === "throws") throw new Error("sdk crashed");
      if (ad === "skipped") return new Promise<void>(() => {}); // SDK ignores the request: no callbacks, ever
      onStart();
      return new Promise<void>((r) => setTimeout(r, 50));
    },
  });
  return { calls, factory };
}

afterEach(() => vi.useRealTimers());

describe("portal integration", () => {
  it("the regular site build has no portal at all", async () => {
    expect(PORTAL).toBe("none");
    const muted: boolean[] = [];
    const p = createPortal("none", null, {} as PortalWindow, (on) => muted.push(on));
    expect(p.active).toBe(false);
    await p.init();
    p.gameplay(true);
    await p.adBreak();
    expect(muted).toEqual([]);
  });

  it("reports loading and gameplay (deduplicated), and mutes only while an ad plays", async () => {
    const { calls, factory } = fakeAdapter("plays");
    const muted: boolean[] = [];
    const p = createPortal("crazygames", factory, {} as PortalWindow, (on) => muted.push(on));
    await p.init();
    p.loadingDone();
    p.gameplay(true);
    p.gameplay(true);
    await Promise.resolve();
    await p.adBreak();
    expect(calls).toEqual(["loadingDone", "start", "stop", "adBreak"]);
    expect(muted).toEqual([true, false]);
  });

  it("never hangs: a skipped ad resolves after a short wait, a crashing SDK immediately", async () => {
    vi.useFakeTimers();
    const skipped = fakeAdapter("skipped");
    const muted: boolean[] = [];
    const p = createPortal("poki", skipped.factory, {} as PortalWindow, (on) => muted.push(on));
    await p.init();
    let done = false;
    const br = p.adBreak().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT + 10);
    await br;
    expect(done).toBe(true);
    expect(muted).toEqual([]); // nothing played, nothing muted
    vi.useRealTimers();
    const crashing = createPortal("poki", fakeAdapter("throws").factory, {} as PortalWindow, () => {});
    await crashing.init();
    await crashing.adBreak();
  });

  it("keeps working when the SDK can't load (e.g. blocked)", async () => {
    const { calls, factory } = fakeAdapter("plays", true);
    const p = createPortal("crazygames", factory, {} as PortalWindow, () => {});
    expect(await p.init()).toBe(false);
    p.gameplay(true);
    await p.adBreak();
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it("drives the real CrazyGames and Poki SDK shapes", async () => {
    const cg: string[] = [];
    const cw = {
      CrazyGames: {
        SDK: {
          init: async () => void cg.push("init"),
          game: { loadingStart: () => cg.push("loadingStart"), loadingStop: () => cg.push("loadingStop"), gameplayStart: () => cg.push("gameplayStart"), gameplayStop: () => cg.push("gameplayStop") },
          ad: {
            requestAd: (type: string, cb: { adStarted?: () => void; adFinished?: () => void }) => {
              cg.push(`requestAd:${type}`);
              cb.adStarted?.();
              cb.adFinished?.();
            },
          },
        },
      },
    } as unknown as PortalWindow;
    const muted: boolean[] = [];
    const p = createPortal("crazygames", crazyGames, cw, (on) => muted.push(on));
    await p.init();
    p.loadingDone();
    p.gameplay(true);
    await Promise.resolve();
    await p.adBreak();
    expect(cg).toEqual(["init", "loadingStart", "loadingStop", "gameplayStart", "gameplayStop", "requestAd:midgame"]);
    expect(muted).toEqual([true, false]);

    const pk: string[] = [];
    const pw = {
      PokiSDK: {
        init: async () => void pk.push("init"),
        gameLoadingFinished: () => pk.push("gameLoadingFinished"),
        gameplayStart: () => pk.push("gameplayStart"),
        gameplayStop: () => pk.push("gameplayStop"),
        commercialBreak: async (onStart?: () => void) => {
          pk.push("commercialBreak");
          onStart?.();
        },
      },
    } as unknown as PortalWindow;
    const q = createPortal("poki", poki, pw, () => {});
    await q.init();
    q.loadingDone();
    q.gameplay(true);
    await Promise.resolve();
    await q.adBreak();
    expect(pk).toEqual(["init", "gameLoadingFinished", "gameplayStart", "gameplayStop", "commercialBreak"]);
  });
});
