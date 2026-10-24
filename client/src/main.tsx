import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { store } from "./state/store";
import { isValidRoomCode } from "@neon/shared";
import "./styles/global.css";
import { portal } from "./platform/portal";

// Invite links look like https://…/?party=AB2CD
const code = new URLSearchParams(location.search).get("party")?.toUpperCase() ?? null;
if (code && isValidRoomCode(code)) store.set({ pendingInvite: code });

// Portal builds only: load the portal SDK while the game boots (no-op on your own site).
void portal.init();

window.addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection:", e.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
