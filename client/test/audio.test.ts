import { beforeEach, describe, expect, it } from "vitest";
import { WEAPONS } from "@neon/shared";

// Minimal fake Web Audio graph: enough to count started sources and track
// which nodes get disconnected.
class Param {
  value = 0;
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class FakeNode {
  disconnected = false;
  [k: string]: unknown;
  constructor(params: string[] = []) {
    for (const p of params) this[p] = new Param();
  }
  connect<T>(n: T): T { return n; }
  disconnect() { this.disconnected = true; }
}
class FakeContext {
  static last: FakeContext;
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  started = 0;
  resumed = 0;
  panners: FakeNode[] = [];
  destination = new FakeNode();
  listener = new FakeNode(["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"]);
  constructor() { FakeContext.last = this; }
  private source(params: string[]) {
    const n = new FakeNode(params);
    n.start = () => void this.started++;
    n.stop = () => {};
    return n;
  }
  createGain() { return new FakeNode(["gain"]); }
  createBiquadFilter() { return new FakeNode(["frequency", "Q"]); }
  createDynamicsCompressor() { return new FakeNode(["threshold", "knee", "ratio", "attack", "release"]); }
  createConvolver() { return new FakeNode(); }
  createOscillator() { return this.source(["frequency"]); }
  createBufferSource() { return this.source(["playbackRate"]); }
  createPanner() {
    const p = new FakeNode(["positionX", "positionY", "positionZ"]);
    this.panners.push(p);
    return p;
  }
  createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { this.resumed++; this.state = "running"; return Promise.resolve(); }
}
const docListeners = new Map<string, (() => void)[]>();
const g = globalThis as Record<string, unknown>;
g.window = { AudioContext: FakeContext, setInterval: () => 0 };
g.document = {
  visibilityState: "visible",
  addEventListener: (t: string, f: () => void) => docListeners.set(t, [...(docListeners.get(t) ?? []), f]),
};

const { AudioEngine, VOICE_LIMIT } = await import("../src/audio/audio");

describe("audio voices", () => {
  let a: InstanceType<typeof AudioEngine>;
  let ctx: FakeContext;
  beforeEach(() => {
    a = new AudioEngine();
    a.unlock();
    ctx = FakeContext.last;
    a.setListener({ x: 0, y: 0, z: 0 }, 0);
  });

  it("your own gunshots always play, however busy the fight is", () => {
    const rifle = WEAPONS.pulse9;
    for (let i = 0; i < 300; i++) {
      const pos = { x: 5 + (i % 50), y: 1, z: (i % 7) * 3 };
      a.gunshot(rifle, pos);
      a.footstep(pos, 1);
      a.impact(pos);
    }
    for (let shot = 0; shot < 30; shot++) {
      const before = ctx.started;
      a.gunshot(rifle, undefined, true);
      expect(ctx.started).toBeGreaterThan(before);
    }
  });

  it("caps other players' voices per kind, and closer sounds take over from distant ones", () => {
    const rifle = WEAPONS.pulse9;
    for (let i = 0; i < 50; i++) a.gunshot(rifle, { x: 80, y: 0, z: i });
    expect(a.activeVoices("gun")).toBe(VOICE_LIMIT.gun);
    const before = ctx.started;
    a.gunshot(rifle, { x: 3, y: 0, z: 0 });
    expect(ctx.started).toBeGreaterThan(before);
    expect(a.activeVoices("gun")).toBe(VOICE_LIMIT.gun);
    // Footsteps have their own pool, so gunfire can't starve them.
    const s0 = ctx.started;
    a.footstep({ x: 4, y: 0, z: 0 }, 1);
    expect(ctx.started).toBeGreaterThan(s0);
  });

  it("skips sounds too far away to hear", () => {
    const before = ctx.started;
    a.footstep({ x: 60, y: 0, z: 0 }, 1);
    a.gunshot(WEAPONS.pulse9, { x: 400, y: 0, z: 0 });
    expect(ctx.started).toBe(before);
  });

  it("disconnects finished voices so they stop costing CPU", () => {
    for (let i = 0; i < 10; i++) a.gunshot(WEAPONS.viper, { x: 10, y: 0, z: i });
    const panners = [...ctx.panners];
    expect(panners.every((p) => !p.disconnected)).toBe(true);
    ctx.currentTime += 2;
    a.footstep({ x: 2, y: 0, z: 0 }, 1);
    expect(panners.every((p) => p.disconnected)).toBe(true);
    expect(a.activeVoices("gun")).toBe(0);
  });

  it("resumes audio the browser suspended, on the next key press", () => {
    ctx.state = "suspended";
    for (const f of docListeners.get("keydown") ?? []) f();
    expect(ctx.resumed).toBeGreaterThan(0);
    expect(ctx.state).toBe("running");
  });
});
