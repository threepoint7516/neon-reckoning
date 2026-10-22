import { Btn } from "@neon/shared";
import { settingsStore } from "../state/settings";
import type { Action } from "../state/settings";

const ACTION_BTN: Partial<Record<Action, number>> = {
  jump: Btn.JUMP, sprint: Btn.SPRINT, crouch: Btn.CROUCH, reload: Btn.RELOAD, interact: Btn.USE, tactical: Btn.TACTICAL,
  grenade: Btn.GRENADE, cycleGrenade: Btn.CYCLE_NADE, heal: Btn.HEAL, plate: Btn.PLATE, slot1: Btn.SLOT1, slot2: Btn.SLOT2, slot3: Btn.SLOT3,
};

/**
 * Keyboard & mouse state. Buttons pressed and released between two
 * simulation steps are latched so quick taps are never dropped.
 */
export class Input {
  private held = new Set<string>();
  private latched = 0;
  private mouseHeld = 0;
  private mouseLatched = 0;
  private crouchToggled = false;
  private adsToggled = false;
  dx = 0;
  dy = 0;
  wheel = 0;
  locked = false;
  /** True when pointer lock is unavailable (e.g. embedded frames) and we track the free cursor instead. */
  fallback = false;
  enabled = true;
  onPause: (() => void) | null = null;
  /** Set while the cursor is deliberately released (death screen) so it doesn't open the pause menu. */
  private quietRelease = false;
  onScoreboard: ((down: boolean) => void) | null = null;
  onMap: (() => void) | null = null;
  private disposers: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      document.addEventListener(t, f as EventListener, opts);
      this.disposers.push(() => document.removeEventListener(t, f as EventListener, opts));
    };
    on("keydown", (e) => {
      if (this.fallback && this.locked && e.code === "Escape") {
        this.locked = false;
        this.releaseAll();
        this.onPause?.();
        return;
      }
      this.key(e, true);
    });
    on("keyup", (e) => this.key(e, false));
    on("mousedown", (e) => {
      if (!this.locked || !this.enabled) return;
      const b = e.button === 0 ? Btn.FIRE : e.button === 2 ? Btn.ADS : 0;
      if (b === Btn.ADS && settingsStore.get().adsToggle) {
        this.adsToggled = !this.adsToggled;
        return;
      }
      this.mouseHeld |= b;
      this.mouseLatched |= b;
    });
    on("mouseup", (e) => {
      const b = e.button === 0 ? Btn.FIRE : e.button === 2 ? Btn.ADS : 0;
      this.mouseHeld &= ~b;
    });
    on("mousemove", (e) => {
      if (!this.locked || !this.enabled) return;
      // Ignore absurd spikes some browsers emit when re-locking.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    on("wheel", (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    on("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });
    on("pointerlockchange", () => {
      if (this.fallback) return;
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.releaseAll();
      if (was && !this.locked && !this.quietRelease) this.onPause?.();
      this.quietRelease = false;
    });
    window.addEventListener("blur", this.releaseAll);
    this.disposers.push(() => window.removeEventListener("blur", this.releaseAll));
  }

  requestLock(): void {
    if (this.fallback) {
      this.locked = true;
      return;
    }
    const useFallback = () => {
      if (document.pointerLockElement === this.el) return;
      this.fallback = true;
      this.locked = true;
    };
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function")
        p.catch(() => {
          try {
            const q = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
            if (q && typeof q.catch === "function") q.catch(useFallback);
          } catch {
            useFallback();
          }
        });
    } catch {
      useFallback();
    }
  }

  /** Free the cursor without pausing (e.g. to use the death-screen loadout picker). */
  releaseQuietly(): void {
    if (!this.locked) return;
    if (this.fallback) {
      this.locked = false;
      this.releaseAll();
      return;
    }
    this.quietRelease = true;
    document.exitPointerLock();
  }

  /** Leave captured-input mode (used by the pause menu in fallback mode). */
  release(): void {
    if (this.fallback) {
      this.locked = false;
      this.releaseAll();
    } else if (document.pointerLockElement) document.exitPointerLock();
  }

  private releaseAll = () => {
    this.held.clear();
    this.mouseHeld = 0;
  };

  private actionsFor(code: string): Action[] {
    const binds = settingsStore.get().binds;
    const out: Action[] = [];
    for (const a of Object.keys(binds) as Action[]) if (binds[a].includes(code)) out.push(a);
    return out;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const acts = this.actionsFor(e.code);
    if (acts.includes("scoreboard")) {
      e.preventDefault();
      this.onScoreboard?.(down);
    }
    if (!this.enabled) return;
    if (this.locked && (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow") || e.ctrlKey)) e.preventDefault();
    if (down && !e.repeat) {
      if (acts.includes("map")) this.onMap?.();
      if (acts.includes("crouch") && settingsStore.get().crouchToggle) this.crouchToggled = !this.crouchToggled;
      for (const a of acts) {
        const b = ACTION_BTN[a];
        if (b) this.latched |= b;
      }
    }
    if (down) this.held.add(e.code);
    else this.held.delete(e.code);
  }

  private down(a: Action): boolean {
    for (const c of settingsStore.get().binds[a]) if (this.held.has(c)) return true;
    return false;
  }

  /** Movement axes (strafe, forward). */
  axes(): [number, number] {
    if (!this.locked || !this.enabled) return [0, 0];
    const x = (this.down("right") ? 1 : 0) - (this.down("left") ? 1 : 0);
    const z = (this.down("forward") ? 1 : 0) - (this.down("back") ? 1 : 0);
    const l = Math.hypot(x, z);
    return l > 1 ? [x / l, z / l] : [x, z];
  }

  /** Buttons for the next simulation step; clears latched taps. */
  buttons(): number {
    if (!this.locked || !this.enabled) {
      this.latched = 0;
      this.mouseLatched = 0;
      return 0;
    }
    const s = settingsStore.get();
    let b = this.latched | this.mouseLatched | this.mouseHeld;
    for (const [a, bit] of Object.entries(ACTION_BTN) as [Action, number][]) if (this.down(a)) b |= bit;
    if (s.crouchToggle) b = this.crouchToggled ? b | Btn.CROUCH : b & ~Btn.CROUCH;
    if (s.adsToggle && this.adsToggled) b |= Btn.ADS;
    // Mouse wheel cycles weapons.
    if (this.wheel !== 0) {
      b |= this.wheel > 0 ? Btn.SLOT3 << 16 : Btn.SLOT1 << 16; // marker bits consumed by Game
      this.wheel = 0;
    }
    this.latched = 0;
    this.mouseLatched = 0;
    return b;
  }

  consumeMouse(): [number, number] {
    const r: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }
}
