import { useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../game/game";
import { Crest, initials, useGame } from "./common";
import { buildScript, Playback, type Item } from "./playback";

const CUE_LABEL: Record<string, string> = { bench: "Bench cam", crowd: "Crowd cam", ref: "Referee cam", replay: "Replay" };

export function MatchView({ game }: { game: Game }) {
  useGame(game);
  const last = game.lastMatch();
  const off = game.lastCalledOff();
  if (off && (!last || off.seq > last.seq)) {
    const home = game.state.clubs[off.actors[0]!]!, away = game.state.clubs[off.actors[1]!]!;
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <div className="lab">Round {game.state.fixtures[off.fixtureId!]?.round ?? ""}</div>
        <div className="vs"><div><div style={{ display: "flex", justifyContent: "center" }}><Crest club={home} lg /></div><div className="hd">{home.name}</div></div><div className="hd" style={{ fontSize: 26, color: "var(--red)" }}>VS</div><div><div style={{ display: "flex", justifyContent: "center" }}><Crest club={away} lg /></div><div className="hd">{away.name}</div></div></div>
        <div style={{ margin: "14px 0" }}><span className="stamp">{off.type === "fixture.abandoned" ? "Abandoned" : "Postponed"}</span></div>
        <p className="dek">Reason: {String(off.payload.reason)}. No points, no result.</p>
        <p className="sub">The fixture has not been played since 1996.</p>
      </div>
    );
  }
  if (!last) return <div className="card"><p>No match played yet. Hit “Play matchday” on the Home tab.</p></div>;
  return <MatchPlayer key={last.fixtureId} game={game} fixtureId={last.fixtureId} />;
}

function MatchPlayer({ game, fixtureId }: { game: Game; fixtureId: string }) {
  const script = useMemo(() => buildScript(game, fixtureId), [game, fixtureId]);
  const cv = useRef<HTMLCanvasElement>(null);
  const pbRef = useRef<Playback | null>(null);
  const speedRef = useRef(1);
  const cueTimer = useRef<number | undefined>(undefined);
  const [run, setRun] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [clock, setClock] = useState("0'");
  const [flash, setFlash] = useState<{ text: string; sub?: string } | null>(null);
  const [cue, setCue] = useState<Item | null>(null);
  const [comm, setComm] = useState<Item[]>([]);
  const [fans, setFans] = useState<Item[]>([]);
  const fanBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!script || !cv.current) return;
    const ctx = cv.current.getContext("2d")!;
    setScore([0, 0]); setClock("0'"); setFlash(null); setCue(null); setComm([]); setFans([]);
    const pb = new Playback(script, {
      item: (i) => {
        if (i.type === "commentary.line") setComm((c) => [i, ...c]);
        else if (i.type === "fan.post") setFans((f) => [...f, i]);
        else { setCue(i); window.clearTimeout(cueTimer.current); cueTimer.current = window.setTimeout(() => setCue(null), 3200); }
      },
      score: setScore, flash: setFlash, clock: setClock, end: () => { /* drawn below */ },
    });
    pbRef.current = pb;
    let raf = 0, prev = performance.now();
    const loop = (t: number) => {
      pb.update((t - prev) / 1000, speedRef.current); prev = t;
      pb.draw(ctx, 640, 380);
      if (!pb.done) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(cueTimer.current); };
  }, [script, run]);

  useEffect(() => { if (fanBox.current) fanBox.current.scrollTop = fanBox.current.scrollHeight; }, [fans]);
  if (!script) return null;
  const hc = game.state.clubs[script.home]!, ac = game.state.clubs[script.away]!;
  const skip = () => { const pb = pbRef.current; if (pb) { pb.finish(); cv.current && pb.draw(cv.current.getContext("2d")!, 640, 380); } };

  return (
    <div className="matchgrid">
      <div>
        <div className="sb"><Crest club={hc} /><div className="tn">{initials(hc.name)}</div><div className="sc">{score[0]}</div><div className="cl">{clock}</div><div className="sc">{score[1]}</div><div className="tn">{initials(ac.name)}</div><Crest club={ac} /></div>
        <div className="pitchw">
          <canvas ref={cv} className="pitch" width={640} height={380} />
          {flash && <div className="flash" key={flash.text + (flash.sub ?? "")}><b>{flash.text}</b>{flash.sub && <i>{flash.sub}</i>}</div>}
          {cue && <div className="cue" key={cue.id}><small>{CUE_LABEL[cue.payload.target] ?? "Cam"}</small>{cue.payload.line}</div>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn g sm" onClick={() => setRun((r) => r + 1)}>Replay</button>
          <button className="btn g sm" onClick={skip}>Skip to result</button>
          {[1, 2, 4].map((s) => <button key={s} className={"btn sm " + (speed === s ? "on" : "g")} onClick={() => { setSpeed(s); speedRef.current = s; }}>{s}x</button>)}
        </div>
        <div className="sub" style={{ marginTop: 6 }}>{hc.name} {script.formations[0]} · {ac.name} {script.formations[1]}</div>
      </div>
      <div>
        <div className="card"><div className="lab">Live commentary</div><div className="feed">{comm.length === 0 && <span className="sub">Waiting for kick-off…</span>}{comm.map((c) => <div className="bub" key={c.id}><b>{c.payload.kind === "fulltime" ? "FT" : `${c.minute}'`}</b> {c.payload.text}</div>)}</div></div>
        <div className="card"><div className="lab">Fan zone</div><div className="feed" ref={fanBox}>{fans.length === 0 && <span className="sub">Fans are warming up…</span>}{fans.map((f) => <div key={f.id} className={"fb " + f.payload.side}><small>{f.payload.handle}</small>{f.payload.text}</div>)}</div></div>
      </div>
    </div>
  );
}
