/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Public WebSocket URL of the game server, e.g. wss://neon-reckoning-server.onrender.com */
  readonly VITE_GAME_SERVER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
