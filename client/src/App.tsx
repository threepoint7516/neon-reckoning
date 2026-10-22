import { useEffect } from "react";
import { useStore } from "./state/store";
import { useSettings } from "./state/settings";
import { Backdrop } from "./ui/components/Backdrop";
import { ArsenalScreen, BootScreen, CreditsScreen, MainMenu, PrivacyScreen } from "./ui/screens/Menus";
import { PlayScreen } from "./ui/screens/Play";
import { PracticeScreen } from "./ui/screens/Practice";
import { SettingsScreen } from "./ui/screens/Settings";
import { GameView } from "./ui/screens/GameView";
import { ResultsScreen } from "./ui/screens/Results";
import { audio } from "./audio/audio";

export function App() {
  const screen = useStore((s) => s.screen);
  const toasts = useStore((s) => s.toasts);
  const settings = useSettings();
  const inGame = screen === "loading" || screen === "game";

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
  }, [settings.reduceMotion]);

  useEffect(() => {
    if (!inGame && screen !== "boot" && settings.musicVol > 0) audio.playMusic("menu");
    if (inGame) audio.playMusic(settings.musicVol > 0 ? "match" : "off");
  }, [inGame, screen, settings.musicVol]);

  return (
    <>
      {!inGame && <Backdrop />}
      {screen === "boot" && <BootScreen />}
      {screen === "menu" && <MainMenu />}
      {(screen === "play" || screen === "party") && <PlayScreen />}
      {screen === "practice" && <PracticeScreen />}
      {screen === "settings" && <SettingsScreen />}
      {screen === "arsenal" && <ArsenalScreen />}
      {screen === "privacy" && <PrivacyScreen />}
      {screen === "credits" && <CreditsScreen />}
      {inGame && <GameView />}
      {screen === "results" && <ResultsScreen />}
      {!inGame && !settings.reduceMotion && !settings.competitiveHud && <div className="scanlines" />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
