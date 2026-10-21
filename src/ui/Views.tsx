import { useRef, useState } from "react";
import type { Game } from "../game/game";
import { ordinal } from "../narrative/narrative";
import { Crest, useGame } from "./common";

export function NewsView({ game }: { game: Game }) {
  useGame(game);
  const news = game.news();
  const banter = game.log.all().filter((e) => e.type === "fan.post" && e.payload.trigger === "banter").slice(-4);
  const lead = news.find((n) => n.payload.lead) ?? news[0];
  const rest = news.filter((n) => n !== lead);
  if (!lead) return <div className="card"><p>No news yet. Play a matchday and the papers will find something.</p></div>;
  const p = lead.payload as any;
  return (
    <div>
      <div className="mast"><h1>The Daily Deadlock</h1><div>{lead.date} · Price: one point</div></div>
      <div className="cols2">
        <div>
          {p.burst && <div className="burst">{String(p.burst).split(" ").map((w, i) => <span key={i}>{w}<br /></span>)}</div>}
          <div className="big">{p.headline}</div>
          <div className="dek">{p.dek}</div>
          {banter.length > 0 && banter.map((b) => <div className="say" key={b.id} style={b.payload.side === "home" ? { background: "#ffd23f" } : undefined}>“{String(b.payload.text)}”<small>{String(b.payload.handle)}</small></div>)}
        </div>
        <div>
          <div className="lab" style={{ marginTop: 8 }}>More from the paper</div>
          {rest.slice(0, 14).map((n) => <div className="story" key={n.id}><h3>{String(n.payload.headline)}</h3><div className="sub">{String(n.payload.dek)} · {n.date}</div></div>)}
          {rest.length === 0 && <div className="sub">Quiet news week.</div>}
        </div>
      </div>
    </div>
  );
}

export function TableView({ game }: { game: Game }) {
  useGame(game);
  const comps = Object.values(game.state.competitions).sort((a, b) => a.tier - b.tier);
  const mine = game.compOf(game.me)?.id ?? comps[0]!.id;
  const [sel, setSel] = useState(mine);
  const t = game.table(sel);
  const k = game.state.settings.relegationSlots;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>{comps.map((c) => <button key={c.id} className={"btn sm " + (sel === c.id ? "on" : "g")} onClick={() => setSel(c.id)}>{c.name}</button>)}</div>
      <div className="tw"><table>
        <thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>{t.map((r, i) => {
          const c = game.state.clubs[r.clubId]!;
          return <tr key={r.clubId} className={(r.clubId === game.me ? "me " : "") + (i === t.length - k ? "cut" : "")}><td>{i + 1}</td><td><i className="dot" style={{ background: c.colors[0] }} />{c.name}</td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gd > 0 ? "+" : ""}{r.gd}</td><td>{r.pts}</td></tr>;
        })}</tbody>
      </table></div>
      <div className="sub" style={{ marginTop: 8 }}>Dashed line: relegation zone. Bottom {k} of the lower division leave the league.</div>
    </div>
  );
}

export function CareerView({ game, onQuit, onImport }: { game: Game; onQuit: () => void; onImport: (json: string) => void }) {
  useGame(game);
  const hist = game.history();
  const ach = game.achievements();
  const file = useRef<HTMLInputElement>(null);
  const exportSave = () => {
    const url = URL.createObjectURL(new Blob([game.toJSON()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `eternal-draw-fc-season-${game.state.season}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const me = game.state.clubs[game.me]!;
  return (
    <div className="cols2">
      <div>
        <div className="card">
          <div className="row"><Crest club={me} lg /><div><h2 className="hd" style={{ fontSize: 24 }}>{me.name}</h2><div className="sub">Manager {game.manager(game.me)} · Season {game.state.season}</div></div></div>
          <div className="lab" style={{ marginTop: 14 }}>Seasons</div>
          {hist.length === 0 && <div className="sub">No seasons completed yet.</div>}
          {hist.slice().reverse().map((h) => <div className="story" key={h.season + h.compName}><b>Season {h.season}</b>: {h.compName}, {ordinal(h.pos)} of {h.of}, {h.pts} points ({h.w}-{h.d}-{h.l}){h.relegated ? " · relegation zone" : ""}</div>)}
        </div>
      </div>
      <div>
        <div className="card"><div className="lab">Achievements</div>{ach.length === 0 && <div className="sub">None yet.</div>}<div className="row">{ach.map((a) => <span className="stamp" key={a.id} style={{ fontSize: 14 }}>{String(a.payload.name)}</span>)}</div></div>
        <div className="card">
          <div className="lab">Save</div>
          <p className="sub" style={{ marginBottom: 10 }}>The game saves itself in this browser after every matchday. Export a backup file now and then.</p>
          <div className="row"><button className="btn g sm" onClick={exportSave}>Export save</button><button className="btn g sm" onClick={() => file.current?.click()}>Import save</button><button className="btn g sm" onClick={() => { if (confirm("Quit to the main menu? Your career stays saved.")) onQuit(); }}>Main menu</button></div>
          <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) onImport(await f.text()); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

export function GameOver({ game, onNew }: { game: Game; onNew: () => void }) {
  const hist = game.history();
  const me = game.state.clubs[game.me]!;
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <span className="stamp">Career over</span>
      <h2 className="hd" style={{ fontSize: 34, margin: "14px 0 6px" }}>{me.name} have dropped out of the league</h2>
      <p className="dek">{hist.length} {hist.length === 1 ? "season" : "seasons"} managed. The board has already hired someone else.</p>
      {hist.map((h) => <div className="sub" key={h.season + h.compName}>Season {h.season}: {h.compName}, {ordinal(h.pos)}, {h.pts} points</div>)}
      <button className="btn" style={{ marginTop: 16 }} onClick={onNew}>Start a new career</button>
    </div>
  );
}
