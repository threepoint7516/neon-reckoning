import { PORTAL } from "../../platform/portal";

/** Optional "support the game" page (Ko-fi, Buy Me a Coffee…), set at build time. */
const URL_ = import.meta.env.VITE_SUPPORT_URL?.trim() ?? "";

/** Shown only on your own site (portals don't allow outside links) and only with an https:// link. */
export const supportUrl = (): string | null => (PORTAL === "none" && /^https:\/\/\S+$/.test(URL_) ? URL_ : null);

/** A plain outbound link: no scripts, no tracking — it only leaves the game if clicked. */
export function SupportLink({ big = false }: { big?: boolean }) {
  const url = supportUrl();
  if (!url) return null;
  return (
    <a className={`btn support ${big ? "" : "small"}`} href={url} target="_blank" rel="noopener noreferrer">
      ♥ Support the game
      {big && <span className="sub">Free forever · tips keep the servers running</span>}
    </a>
  );
}
