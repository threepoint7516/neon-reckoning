// Global tuning constants shared by the client prediction and the server
// simulation. Changing any of these is a protocol change: bump PROTOCOL_VERSION.

export const GAME_TITLE = "NEON RECKONING";
export const PROTOCOL_VERSION = 3;

// ---- Timing ---------------------------------------------------------------
/** Fixed simulation step for player movement & weapons (client and server). */
export const SIM_DT = 1 / 60;
/** Server room tick rate (Hz). Each tick consumes ~2 input steps per player. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** Client renders remote players this far in the past for smooth interpolation. */
export const INTERP_DELAY = 0.1;
/** Maximum lag compensation rewind the server will honor (seconds). */
export const MAX_REWIND = 0.3;
/** Input credit cap: how far ahead a client may burst inputs (anti speed-hack). */
export const MAX_INPUT_BANK = 12;
/** Max queued inputs held per player before old ones are dropped. */
export const MAX_INPUT_QUEUE = 40;

// ---- Player body ------------------------------------------------------------
export const PLAYER_RADIUS = 0.38;
export const PLAYER_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.15;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.0;
export const HEAD_RADIUS = 0.24;

// ---- Movement ---------------------------------------------------------------
export const WALK_SPEED = 5.6;
export const SPRINT_SPEED = 8.4;
export const CROUCH_SPEED = 2.9;
/** Quake-style: acceleration scales with wish speed (units: 1/s). */
export const GROUND_ACCEL = 12;
export const AIR_ACCEL = 14;
export const AIR_MAX_SPEED = 1.2; // wish-speed cap for air strafing (Quake-style)
export const GROUND_FRICTION = 8;
export const GRAVITY = 22;
export const JUMP_VELOCITY = 7.6;
export const STEP_HEIGHT = 0.55;
export const SLIDE_BOOST = 4.2;
export const SLIDE_MIN_SPEED = 6.5;
export const SLIDE_TIME = 0.85;
export const SLIDE_FRICTION = 1.6;
export const SLIDE_COOLDOWN = 1.0;
export const LADDER_SPEED = 4.6;
export const GLIDE_FALL_SPEED = 9;
export const GLIDE_AIR_SPEED = 13;
export const FALL_DAMAGE_THRESHOLD = 15.5; // landing speed (m/s) before damage
export const FALL_DAMAGE_PER_MS = 7;
export const KILL_PLANE_Y = -20;

// ---- Vitals -----------------------------------------------------------------
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const SPAWN_ARMOR = 50;
export const REGEN_DELAY = 5;
export const REGEN_RATE = 14;
export const SPAWN_PROTECTION = 2.2;
export const RESPAWN_DELAY = 3.5;
export const DOWNED_BLEEDOUT = 30;
export const DOWNED_HEALTH = 100;
export const REVIVE_TIME = 4;
export const ASSIST_WINDOW = 8;

// ---- Input buttons ----------------------------------------------------------
export const Btn = {
  FIRE: 1,
  ADS: 2,
  JUMP: 4,
  SPRINT: 8,
  CROUCH: 16,
  RELOAD: 32,
  USE: 64,
  GRENADE: 128,
  TACTICAL: 256,
  HEAL: 512,
  PLATE: 1024,
  SLOT1: 2048,
  SLOT2: 4096,
  SLOT3: 8192,
  CYCLE_NADE: 16384,
} as const;
export const BTN_MASK = 32767;

// ---- Networking / server limits ------------------------------------------------
export const MAX_MESSAGE_BYTES = 8 * 1024;
export const MSG_RATE_PER_SEC = 90;
export const MSG_BURST = 140;
export const RECONNECT_GRACE = 30;
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Remote players beyond this distance are not sent (interest management). */
export const INTEREST_RADIUS = 140;
export const PICKUP_INTEREST_RADIUS = 90;
