import type { GrenadeId, TacticalId } from "../types";

export interface GrenadeDef {
  id: GrenadeId;
  name: string;
  blurb: string;
  color: number;
  fuse: number;
  throwSpeed: number;
  bounce: number;
  radius: number;
  /** Max damage at the center (frag) / armor shred (emp). */
  damage: number;
  /** Effect duration (smoke cloud lifetime, emp disable, max flash blind). */
  duration: number;
  /** Starting count in respawn modes, and the carry cap. */
  spawnCount: number;
  max: number;
}

export const GRENADES: Record<GrenadeId, GrenadeDef> = {
  frag: {
    id: "frag", name: "Frag Grenade", color: 0xff5a1f,
    blurb: "2.4 s fuse, 6.5 m blast. Cover blocks the shrapnel.",
    fuse: 2.4, throwSpeed: 19, bounce: 0.35, radius: 6.5, damage: 125, duration: 0, spawnCount: 2, max: 3,
  },
  smoke: {
    id: "smoke", name: "Smoke Grenade", color: 0x9aa7c7,
    blurb: "Blooms into a 6 m cloud for 12 s. Breaks line of sight for players and AI.",
    fuse: 1.1, throwSpeed: 17, bounce: 0.3, radius: 6, damage: 0, duration: 12, spawnCount: 1, max: 2,
  },
  flash: {
    id: "flash", name: "Flashbang", color: 0xfff6c0,
    blurb: "Blinds anyone looking at it. Turn away or break line of sight to resist.",
    fuse: 1.4, throwSpeed: 19, bounce: 0.35, radius: 20, damage: 0, duration: 2.8, spawnCount: 1, max: 2,
  },
  emp: {
    id: "emp", name: "EMP Grenade", color: 0x3df2ff,
    blurb: "Shreds 40 armor, scrambles HUD & abilities for 4 s and fries mines, shields and charges.",
    fuse: 1.6, throwSpeed: 18, bounce: 0.3, radius: 8, damage: 40, duration: 4, spawnCount: 1, max: 2,
  },
};
export const GRENADE_IDS = Object.keys(GRENADES) as GrenadeId[];

export interface TacticalDef {
  id: TacticalId;
  name: string;
  blurb: string;
  color: number;
  cooldown: number;
}

export const TACTICALS: Record<TacticalId, TacticalDef> = {
  recon: {
    id: "recon", name: "Recon Pulse", color: 0x22e5ff, cooldown: 24,
    blurb: "Pings enemies within 35 m for your team for 4 s. Scanned enemies are warned.",
  },
  shield: {
    id: "shield", name: "Aegis Shield", color: 0x7d7dff, cooldown: 28,
    blurb: "Deploys a 3 m bullet-blocking barrier for 10 s (350 HP). EMP destroys it.",
  },
  mine: {
    id: "mine", name: "Proximity Mine", color: 0xff3b3b, cooldown: 18,
    blurb: "Arms after 1.2 s, triggers on enemies within 2.6 m. Blinks red — shoot it to disarm. Max 2.",
  },
  remote: {
    id: "remote", name: "Remote Charge", color: 0xffb21f, cooldown: 22,
    blurb: "Place a sticky charge, press again to detonate. Shootable. One at a time.",
  },
};
export const TACTICAL_IDS = Object.keys(TACTICALS) as TacticalId[];

export const RECON = { radius: 35, duration: 4 };
export const SHIELD = { hp: 350, duration: 10, width: 3, height: 2.3, thickness: 0.25 };
export const MINE = { arm: 1.2, trigger: 2.6, radius: 4.5, damage: 110, max: 2, hp: 20 };
export const REMOTE = { radius: 5.5, damage: 140, hp: 25, minDelay: 0.5 };
export const BARREL = { hp: 35, radius: 5.5, damage: 115, respawn: 45 };

export const INJECTOR = { heal: 60, channel: 1.1, spawnCount: 2, max: 4 };
export const PLATE = { armor: 50, channel: 1.4, spawnCount: 1, max: 4 };
