/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Public WebSocket URL of the game server, e.g. wss://neon-reckoning-server.onrender.com */
  readonly VITE_GAME_SERVER_URL?: string;
  /** Portal build target: "crazygames" or "poki" (set by `vite --mode`); unset for your own site. */
  readonly VITE_PORTAL?: string;
  /** Optional https:// link to a tip page (Ko-fi, Buy Me a Coffee…), shown on your own site only. */
  readonly VITE_SUPPORT_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
