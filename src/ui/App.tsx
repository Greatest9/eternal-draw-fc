import { useCallback, useEffect, useState } from "react";
import { Game } from "../game/game";
import { DOOMED, EDFC } from "../game/world";
import { CURSE_RULE, Crest, TABS, useGame, type Tab } from "./common";
import { HomeView } from "./HomeView";
import { MatchView } from "./MatchView";
import { clearCareer, loadCareer, saveCareer } from "./storage";
import { CareerView, GameOver, NewsView, TableView } from "./Views";

function Start({ saved, onContinue, onNew, onImport }: { saved: boolean; onContinue: () => void; onNew: (club: string) => void; onImport: (json: string) => void }) {
  return (
    <div className="start">
      <h1 className="hd" style={{ fontSize: 44 }}>Eternal Draw FC</h1>
      <p className="dek">Neither victorious nor defeated.</p>
      {saved && <div className="card"><button className="btn full" onClick={onContinue}>Continue your career</button></div>}
      <div className="card">
        <div className="lab">New career</div>
        <button className="pick" onClick={() => onNew(EDFC)}><b>Eternal Draw FC</b><span className="tag">always draws</span><span className="sub">{CURSE_RULE["equilibrium"]}</span></button>
        <button className="pick" onClick={() => onNew(DOOMED)}><b>FC Doomed</b><span className="tag">always loses</span><span className="sub">{CURSE_RULE["fall"]}</span></button>
        <p className="sub" style={{ marginTop: 10 }}>If your club is relegated out of the second division, your career ends and you start again.</p>
      </div>
      <div className="card"><div className="lab">Import a save file</div><input type="file" accept="application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onImport(await f.text()); }} /></div>
    </div>
  );
}

export function Shell({ game, onQuit, onNew, onImport }: { game: Game; onQuit: () => void; onNew: () => void; onImport: (json: string) => void }) {
  useGame(game);
  const [tab, setTab] = useState<Tab>("home");
  const me = game.state.clubs[game.me]!;
  const play = useCallback(() => { game.playMatchday(); setTab("match"); }, [game]);
  const close = useCallback(() => { game.closeSeason(); setTab("home"); }, [game]);

  useEffect(() => {
    const t = window.setTimeout(() => { void saveCareer(game.toJSON()); }, 400);
    return () => window.clearTimeout(t);
  }, [game, game.version]);

  const over = game.state.careerOver;
  return (
    <div className="shell">
      <div className="top"><Crest club={me} /><div className="grow"><h2 className="hd" style={{ fontSize: 22 }}>{me.name}</h2><div className="sub">Season {game.state.season} · {game.compOf(game.me)?.name ?? "Out of the league"}</div></div>
        {!over && !game.seasonComplete() && <button className="btn sm" onClick={play}>Play matchday</button>}
      </div>
      <div className="layout">
        <nav className="tabs">{TABS.map(([id, icon, label]) => <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}><b>{icon}</b>{label}</button>)}</nav>
        <main>
          {over && tab !== "career" ? <GameOver game={game} onNew={onNew} /> : tab === "home" ? <HomeView game={game} play={play} onClose={close} /> : tab === "match" ? <MatchView game={game} /> : tab === "news" ? <NewsView game={game} /> : tab === "table" ? <TableView game={game} /> : <CareerView game={game} onQuit={onQuit} onImport={onImport} />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveJson, setSaveJson] = useState<string | null>(null);

  useEffect(() => { void loadCareer().then((j) => { setSaveJson(j); setSaved(!!j); }); }, []);

  const importJson = (json: string) => {
    try { setGame(Game.fromJSON(json)); } catch (e) { alert("That file is not a valid save: " + (e as Error).message); }
  };
  if (game) {
    return <Shell key={game.seed + game.state.season + game.me} game={game}
      onQuit={() => { setSaveJson(game.toJSON()); setSaved(true); setGame(null); }}
      onNew={() => { void clearCareer(); setSaved(false); setGame(null); }} onImport={importJson} />;
  }
  return <Start saved={saved}
    onContinue={() => saveJson && importJson(saveJson)}
    onNew={(club) => { const g = Game.create(`career-${Date.now().toString(36)}`, club); setGame(g); }}
    onImport={importJson} />;
}
