import type { Game } from "../game/game";
import type { Id } from "../events/types";

/** Everything the match screen needs, read from the event log. Nothing here invents facts. */
export interface Attack { id: string; minute: number; team: Id; shooter: Id; outcome: string; score?: [number, number]; hint?: string }
export interface Item { id: string; type: "commentary.line" | "fan.post" | "cutaway.cue"; minute: number; seq: number; payload: any; attackId?: string }
export interface MatchScript {
  fixtureId: Id; home: Id; away: Id; homeName: string; awayName: string;
  formations: [string, string]; colors: [string, string]; lineups: [Id[], Id[]];
  attacks: Attack[]; items: Item[]; end: number; final: [number, number]; name: (id: Id) => string;
}

export const HINT_TEXT: Record<string, string> = {
  "offside-overturned": "Offside, by a toe", "foul-in-build-up": "Foul in the build-up", "handball-var": "Handball on the replay",
};

export function buildScript(game: Game, fixtureId: Id): MatchScript | null {
  const evs = game.fixtureEvents(fixtureId);
  const ft = evs.find((e) => e.type === "match.fulltime");
  if (!ft) return null;
  const p = ft.payload as any;
  const chain = new Map<string, string>(); // event id -> attack id
  const attacks: Attack[] = [];
  for (const a of evs.filter((e) => e.type === "match.attack")) {
    const shot = evs.find((e) => e.type === "match.shot" && e.causedBy === a.id);
    if (!shot) continue;
    const goal = evs.find((e) => e.type === "match.goal" && e.causedBy === shot.id);
    const hints = evs.filter((e) => e.type === "match.rewrite" && e.causedBy === shot.id);
    [a, shot, goal, ...hints, ...evs.filter((e) => e.type === "match.save" && e.causedBy === shot.id)].forEach((e) => e && chain.set(e.id, a.id));
    attacks.push({ id: a.id, minute: a.minute ?? 0, team: (a.payload as any).team, shooter: (a.payload as any).shooter, outcome: (shot.payload as any).outcome, score: goal ? ((goal.payload as any).score as [number, number]) : undefined, hint: hints[0] ? (hints[0].payload as any).kind : undefined });
  }
  attacks.sort((x, y) => x.minute - y.minute);
  const items: Item[] = evs
    .filter((e) => e.type === "commentary.line" || e.type === "fan.post" || e.type === "cutaway.cue")
    .map((e) => ({ id: e.id, type: e.type as Item["type"], minute: e.minute ?? 0, seq: e.seq, payload: e.payload, attackId: e.causedBy ? chain.get(e.causedBy) : undefined }))
    .sort((a, b) => a.minute - b.minute || a.seq - b.seq);
  const h = game.state.clubs[p.home]!, a = game.state.clubs[p.away]!;
  const hs = game.sideFor(p.home), as = game.sideFor(p.away);
  return {
    fixtureId, home: p.home, away: p.away, homeName: h.name, awayName: a.name,
    formations: [h.formation, a.formation],
    colors: [h.colors[0], a.colors[0] === h.colors[0] ? a.colors[1] : a.colors[0]],
    lineups: [hs.lineup.map((x) => x.id), as.lineup.map((x) => x.id)],
    attacks, items, end: Math.max(90, ft.minute ?? 90), final: [p.hg, p.ag], name: game.name,
  };
}

interface Dot { t: 0 | 1; bx: number; by: number; x: number; y: number; id?: Id }
interface Seq { a: Attack; team: 0 | 1; t: number; hops: Dot[]; shooter: Dot; from: { x: number; y: number }; to: { x: number; y: number }; done: boolean; hold: number }
export interface PlaybackCallbacks {
  item(i: Item): void;
  score(s: [number, number]): void;
  flash(f: { text: string; sub?: string } | null): void;
  clock(label: string): void;
  end(): void;
}

const RATE = 6; // match minutes per second while idle
const HOP = 0.32, SHOT = 0.4;

function layout(formation: string): Array<[number, number]> {
  const rows = formation.split("-").map(Number);
  const out: Array<[number, number]> = [[0.04, 0.5]];
  rows.forEach((n, k) => { for (let j = 0; j < n; j++) out.push([0.18 + (0.42 * k) / (rows.length - 1), (j + 1) / (n + 1)]); });
  return out;
}

export class Playback {
  clock = 0;
  score: [number, number] = [0, 0];
  done = false;
  private P: Dot[] = [];
  private ball = { x: 0.5, y: 0.5 };
  private poss: 0 | 1 = 0;
  private car: Dot;
  private pass = 0;
  private ai = 0;
  private ni = 0;
  private flashT = 0;
  private seq: Seq | null = null;
  private normal: Item[];
  private held = new Map<string, Item[]>();
  private seen = new Set<string>();

  constructor(private s: MatchScript, private cb: PlaybackCallbacks) {
    ([0, 1] as const).forEach((t) => layout(s.formations[t]).forEach(([a, b], i) => this.P.push({ t, bx: t ? 1 - a : a, by: b, x: t ? 1 - a : a, y: b, id: s.lineups[t][i] })));
    this.car = this.P[9]!;
    this.normal = s.items.filter((i) => !i.attackId);
    for (const i of s.items) if (i.attackId) this.held.set(i.attackId, [...(this.held.get(i.attackId) ?? []), i]);
    cb.clock("0'");
  }

  private emit(i: Item) {
    if (this.seen.has(i.id)) return;
    this.seen.add(i.id);
    this.cb.item(i);
  }

  private reveal() {
    while (this.ni < this.normal.length && this.normal[this.ni]!.minute <= this.clock) this.emit(this.normal[this.ni++]!);
  }

  private mates(team: 0 | 1, not?: Dot) { return this.P.filter((p, i) => p.t === team && i % 11 !== 0 && p !== not); }

  private randomPass() {
    const m = this.mates(this.poss, this.car), dir = this.poss ? -1 : 1;
    const fwd = m.filter((p) => (p.x - this.car.x) * dir > 0);
    const pool = fwd.length && Math.random() < 0.6 ? fwd : m;
    this.car = pool[Math.floor(Math.random() * pool.length)]!;
    if (Math.random() < 0.1) { this.poss = (this.poss ^ 1) as 0 | 1; this.car = this.mates(this.poss)[5]!; }
  }

  private startSeq(a: Attack) {
    const team = (a.team === this.s.home ? 0 : 1) as 0 | 1;
    this.poss = team;
    const opp = (1 - team) as 0 | 1;
    const dir = team ? -1 : 1;
    const own = this.mates(team);
    const shooter = this.P.find((p) => p.id === a.shooter) ?? own[own.length - 1]!;
    const pick = () => own[Math.floor(Math.random() * own.length)]!;
    const hops = [pick(), pick(), shooter];
    const gx = team === 0 ? 1 : 0;
    let to = { x: gx, y: 0.5 + (Math.random() - 0.5) * 0.12 };
    if (a.outcome === "saved") to = { x: this.P[opp * 11]!.x, y: this.P[opp * 11]!.y };
    else if (a.outcome === "missed") to = { x: team === 0 ? 1.05 : -0.05, y: 0.5 + (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.1) };
    else if (a.outcome === "blocked") { const d = this.P[opp * 11 + 1 + Math.floor(Math.random() * 4)]!; to = { x: d.x - dir * 0.02, y: d.y }; }
    this.seq = { a, team, t: 0, hops, shooter, from: { ...this.ball }, to, done: false, hold: 0.5 };
  }

  private outcome(q: Seq) {
    q.done = true;
    const a = q.a;
    if (a.outcome === "goal") {
      if (a.score) { this.score = a.score; this.cb.score(a.score); }
      this.cb.flash({ text: "GOAL!", sub: `${this.s.name(a.shooter)} ${a.minute}'` });
      this.flashT = 1.5; q.hold = 1.5;
    } else if (a.outcome === "disallowed") {
      this.cb.flash({ text: "NO GOAL", sub: HINT_TEXT[a.hint ?? ""] ?? "Chalked off" });
      this.flashT = 1.4; q.hold = 1.4;
    } else if (a.outcome === "saved") { this.cb.flash({ text: "SAVED" }); this.flashT = 0.6; q.hold = 0.6; }
    for (const i of this.held.get(a.id) ?? []) this.emit(i);
  }

  update(dtRaw: number, speed: number) {
    if (this.done) return;
    const dt = Math.min(dtRaw, 0.05) * speed;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.cb.flash(null); }
    const q = this.seq;
    if (q) {
      q.t += dt;
      const build = HOP * q.hops.length;
      if (q.t < build) {
        const k = Math.min(q.hops.length - 1, Math.floor(q.t / HOP)), f = (q.t - k * HOP) / HOP;
        const from = k === 0 ? q.from : { x: q.hops[k - 1]!.x, y: q.hops[k - 1]!.y };
        this.ball = { x: from.x + (q.hops[k]!.x - from.x) * f, y: from.y + (q.hops[k]!.y - from.y) * f };
        this.car = q.hops[k]!;
      } else if (q.t < build + SHOT) {
        const f = (q.t - build) / SHOT, sx = q.shooter.x, sy = q.shooter.y;
        this.ball = { x: sx + (q.to.x - sx) * f, y: sy + (q.to.y - sy) * f };
      } else {
        if (!q.done) this.outcome(q);
        if (q.t >= build + SHOT + q.hold) {
          this.seq = null; this.ai++;
          if (q.a.outcome === "goal" || q.a.outcome === "disallowed") { this.poss = (q.team ^ 1) as 0 | 1; this.car = this.mates(this.poss)[5]!; this.ball = { x: 0.5, y: 0.5 }; }
          else { this.car = q.shooter; this.ball = { x: q.shooter.x, y: q.shooter.y }; }
        }
      }
    } else {
      const next = this.s.attacks[this.ai];
      this.clock = Math.min(this.clock + dt * RATE, next ? next.minute : this.s.end);
      this.cb.clock(this.clock >= this.s.end ? "FT" : this.clock > 90 ? "90+" : `${Math.floor(this.clock)}'`);
      this.reveal();
      if (next && this.clock >= next.minute) this.startSeq(next);
      else if (!next && this.clock >= this.s.end) { this.finish(); return; }
      this.pass -= dt;
      if (this.pass <= 0) { this.pass = 0.45 + Math.random() * 0.35; this.randomPass(); }
      this.ball.x += (this.car.x - this.ball.x) * Math.min(1, dt * 9);
      this.ball.y += (this.car.y - this.ball.y) * Math.min(1, dt * 9);
    }
    this.P.forEach((p, i) => {
      const gk = i % 11 === 0, a = p.t === this.poss ? (p.t ? -0.1 : 0.1) : p.t ? 0.04 : -0.04;
      const tx = p.bx + (gk ? 0 : a + (this.ball.x - p.bx) * 0.25), ty = p.by + (gk ? (this.ball.y - 0.5) * 0.15 : (this.ball.y - p.by) * 0.25);
      p.x += (tx - p.x) * Math.min(1, dt * 2.5); p.y += (ty - p.y) * Math.min(1, dt * 2.5);
    });
  }

  /** Jump to the final whistle: reveal everything and show the final score. */
  finish() {
    if (this.done) return;
    this.done = true;
    const rest = [...this.normal.slice(this.ni), ...[...this.held.values()].flat()].sort((a, b) => a.minute - b.minute || a.seq - b.seq);
    for (const i of rest) this.emit(i);
    this.score = this.s.final; this.cb.score(this.s.final); this.cb.flash(null); this.cb.clock("FT"); this.clock = this.s.end; this.cb.end();
  }

  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    x.fillStyle = "#2e7d4f"; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i += 2) { x.fillStyle = "rgba(0,0,0,.05)"; x.fillRect((i * W) / 8, 0, W / 8, H); }
    x.strokeStyle = "rgba(255,255,255,.7)"; x.lineWidth = 2; x.strokeRect(10, 10, W - 20, H - 20);
    x.beginPath(); x.moveTo(W / 2, 10); x.lineTo(W / 2, H - 10); x.stroke();
    x.beginPath(); x.arc(W / 2, H / 2, 40, 0, 7); x.stroke();
    x.strokeRect(10, H / 2 - 60, 70, 120); x.strokeRect(W - 80, H / 2 - 60, 70, 120);
    for (const p of this.P) {
      x.fillStyle = this.s.colors[p.t]; x.strokeStyle = p.t ? "#fff" : "#ffd23f"; x.lineWidth = 3;
      x.beginPath(); x.arc(p.x * W, p.y * H, 9, 0, 7); x.fill(); x.stroke();
    }
    const q = this.seq;
    if (q && q.t > HOP * (q.hops.length - 1)) { x.fillStyle = "#fff"; x.font = "bold 13px system-ui"; x.textAlign = "center"; x.fillText(this.s.name(q.a.shooter).split(" ").pop() ?? "", q.shooter.x * W, q.shooter.y * H - 16); }
    x.fillStyle = "#fff"; x.strokeStyle = "#151515"; x.lineWidth = 1.5;
    x.beginPath(); x.arc(this.ball.x * W, this.ball.y * H, 5.5, 0, 7); x.fill(); x.stroke();
  }
}
