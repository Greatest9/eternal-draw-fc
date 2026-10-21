import { ordinal } from "../narrative/narrative";
import type { Game } from "../game/game";
import { CURSE_RULE, Crest, useGame } from "./common";

export function HomeView({ game, play, onClose }: { game: Game; play: () => void; onClose: () => void }) {
  useGame(game);
  const me = game.state.clubs[game.me]!;
  const rec = game.record(game.me)!;
  const next = game.nextFixture();
  const opp = next ? game.state.clubs[next.home === game.me ? next.away : next.home]! : null;
  const gap = game.pointsAboveDrop(game.me)!;
  const form = game.form(game.me);
  const off = game.lastCalledOff();
  const heads = game.news().slice(0, 4).map((n) => n.payload.headline as string);
  const done = game.seasonComplete();
  const hist = game.history().at(-1);
  return (
    <div className="cols2">
      <div>
        <div className="card">
          <div className="row"><Crest club={me} lg /><div><h2 className="hd" style={{ fontSize: 26 }}>{me.name}</h2><div className="sub">{rec.comp.name} · Season {game.state.season} · Round {Math.min(game.roundsTotal(), (game.nextRound() ?? game.roundsTotal() + 1) - 1)}/{game.roundsTotal()}</div></div></div>
          <div className="stats">
            <div><b>{rec.row.p}</b><span>P</span></div><div><b>{rec.row.w}</b><span>W</span></div><div><b>{rec.row.d}</b><span>D</span></div><div><b>{rec.row.l}</b><span>L</span></div><div><b>{rec.row.pts}</b><span>Pts</span></div>
          </div>
          <div className="lab" style={{ marginTop: 12 }}>Form</div>
          <div className="form">{form.length ? form.map((f, i) => <i key={i} className={f}>{f}</i>) : <span className="sub">No matches yet</span>}</div>
          <div className="sub" style={{ marginTop: 8 }}>{ordinal(rec.pos)} of {rec.of} · {gap >= 0 ? `${gap} points above the drop` : `${-gap} points from safety`}</div>
        </div>
        {done ? (
          <div className="card">
            <div className="lab">Season complete</div>
            <h3 className="hd" style={{ fontSize: 24 }}>{rec.comp.name}: {ordinal(rec.pos)} on {rec.row.pts} points</h3>
            <p className="sub" style={{ margin: "6px 0 10px" }}>{rec.pos > rec.of - game.state.settings.relegationSlots ? "That is inside the relegation zone." : "Safe for another year."}</p>
            <button className="btn full" onClick={onClose}>Close the season</button>
          </div>
        ) : next && opp ? (
          <div className="card">
            <div className="lab">Next fixture · round {next.round}</div>
            <div className="vs"><div><Crest club={me} /><div className="hd">{me.name}</div></div><div className="hd" style={{ fontSize: 26, color: "var(--red)" }}>{next.home === game.me ? "VS" : "AT"}</div><div><div style={{ display: "flex", justifyContent: "center" }}><Crest club={opp} /></div><div className="hd">{opp.name}</div></div></div>
            <div className="sub" style={{ textAlign: "center", margin: "10px 0" }}>{game.manager(game.me)} {next.home === game.me ? "has the home crowd" : "travels"}. Formation {me.formation}.</div>
            <button className="btn full" onClick={play}>Play matchday</button>
          </div>
        ) : null}
        {hist && <div className="sub">Last season: {hist.compName}, {ordinal(hist.pos)}, {hist.pts} points.</div>}
      </div>
      <div>
        {me.curses.length > 0 && me.curses.map((c) => (
          <div className="card" key={c}><div className="lab">Active curse</div><h3 className="hd" style={{ fontSize: 22 }}>{game.registry.get(c)?.name ?? c}</h3><div className="sub">{CURSE_RULE[c] ?? ""} Your formation shapes how you play, not how it ends.</div></div>
        ))}
        {game.disruptions() > 0 && (
          <div className="card">
            <div className="lab">The fixture nobody plays</div>
            <div style={{ textAlign: "center" }}><span className="stamp">{off ? (off.type === "fixture.abandoned" ? "Abandoned" : "Postponed") : "Called off"}</span></div>
            <div className="sub" style={{ textAlign: "center", margin: "8px 0" }}>{off ? `Reason: ${off.payload.reason}. New date: to be confirmed.` : ""}</div>
            <div className="sub" style={{ textAlign: "center" }}>Last played: 1996 · Called off {game.disruptions()} {game.disruptions() === 1 ? "time" : "times"} since</div>
          </div>
        )}
        {heads.length > 0 && <div className="tick"><span>{heads.join("  ·  ")}</span></div>}
      </div>
    </div>
  );
}
