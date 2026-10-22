import { describe, expect, it } from "vitest";
import { parseClientMessage, isValidRoomCode } from "../src/protocol";
import { sanitizeName, randomCallsign } from "../src/names";

describe("protocol validation", () => {
  it("rejects malformed frames", () => {
    for (const raw of ["", "null", "[]", "{", '{"t":"nope"}', '{"t":1}', "x".repeat(20000)]) expect(parseClientMessage(raw)).toBeNull();
  });

  it("rejects invalid inputs", () => {
    const good = { seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, b: 0, vt: 1 };
    expect(parseClientMessage(JSON.stringify({ t: "input", i: [good] }))).not.toBeNull();
    for (const bad of [
      { ...good, mx: 5 },
      { ...good, pitch: 3 },
      { ...good, b: 1 << 20 },
      { ...good, seq: -1 },
      { ...good, seq: 1.5 },
      { ...good, yaw: "x" },
    ])
      expect(parseClientMessage(JSON.stringify({ t: "input", i: [bad] }))).toBeNull();
    expect(parseClientMessage('{"t":"input","i":[{"seq":1,"mx":NaN}]}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "input", i: new Array(31).fill(good) }))).toBeNull();
  });

  it("validates loadouts and party settings", () => {
    expect(parseClientMessage(JSON.stringify({ t: "loadout", loadout: { primary: "nova", secondary: "phantom", tactical: "recon" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "loadout", loadout: { primary: "pulse9", secondary: "phantom", tactical: "recon" } }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "party_settings", mode: "tdm", size: 5, fill: true, bots: true }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "party_settings", mode: "tdm", size: 4, fill: true, bots: false }))).not.toBeNull();
  });

  it("validates room codes", () => {
    expect(isValidRoomCode("AB2CD")).toBe(true);
    expect(isValidRoomCode("AB0CD")).toBe(false); // 0 excluded from alphabet
    expect(isValidRoomCode("ABCD")).toBe(false);
    expect(isValidRoomCode("<scr>")).toBe(false);
  });
});

describe("display names", () => {
  it("sanitizes custom names", () => {
    expect(sanitizeName("Neo_Runner-7")).toBe("Neo_Runner-7");
    expect(sanitizeName("<b>hax</b>")).toBe("bhaxb");
    expect(sanitizeName("ab")).toBeNull();
    expect(sanitizeName("BOT Kestrel")).toBeNull();
    expect(sanitizeName("x".repeat(40))!.length).toBe(16);
    expect(sanitizeName(42)).toBeNull();
  });
  it("generates readable random callsigns", () => {
    const n = randomCallsign();
    expect(n).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
    expect(sanitizeName(n)).toBe(n);
  });
});
