import { canon } from "../events/canon";
import type { EventLog } from "../events/store";
import type { GameEvent, Id, NewEvent } from "../events/types";
import type { GameState, Player } from "../state/types";
import type { Rng } from "./rng";

export interface Side {
  clubId: Id;
  formation: string;
  lineup: Player[]; // 11 starters, one GK
  bench: Player[];
}

export interface MatchInput {
  fixtureId: Id;
  compId: Id;
  season: number;
  date: string;
  home: Side;
  away: Side;
}

/** An event before it is written to the log. `key` links a chain (attack, shot, goal). */
export type Draft = NewEvent & { key?: string; causedByKey?: string };

export interface MatchStats {
  shots: [number, number];
  onTarget: [number, number];
  xg: [number, number];
  fouls: [number, number];
  yellows: [number, number];
  reds: [number, number];
  possession: [number, number];
}

interface Sub { minute: number; out: Id; in: Id }
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function teamRatings(lineup: readonly Player[]) {
  const avg = (ps: Player[], f: (p: Player) => number) => (ps.length ? ps.reduce((s, p) => s + f(p), 0) / ps.length : 50);
  const by = (pos: Player["pos"]) => lineup.filter((p) => p.pos === pos);
  const att = (avg(by("FW"), (p) => p.att) * 2 + avg(by("MF"), (p) => p.att)) / 3;
  const def = (avg(by("DF"), (p) => p.def) * 2 + avg(by("GK"), (p) => p.def) * 2 + avg(by("MF"), (p) => p.def)) / 5;
  return { att, def, discipline: avg([...lineup], (p) => p.discipline) };
}

/** Who is on the pitch at `minute`, given planned subs and the red cards shown so far. */
function onPitch(side: Side, minute: number, subs: Sub[], reds: Map<Id, number>): Player[] {
  const all = new Map([...side.lineup, ...side.bench].map((p) => [p.id, p] as const));
  let ids = side.lineup.map((p) => p.id);
  for (const s of subs) {
    if (s.minute > minute) continue;
    const r = reds.get(s.out);
    if (r !== undefined && r <= s.minute) continue;
    ids = ids.map((id) => (id === s.out ? s.in : id));
  }
  return ids.filter((id) => { const r = reds.get(id); return r === undefined || r > minute; }).map((id) => all.get(id) as Player);
}

function planSubs(side: Side, rng: Rng): Sub[] {
  const outs = rng.shuffle(side.lineup.filter((p) => p.pos !== "GK"));
  const ins = rng.shuffle(side.bench.filter((p) => p.pos !== "GK"));
  const n = Math.min(3, outs.length, ins.length);
  const minutes = Array.from({ length: n }, () => rng.int(46, 85)).sort((a, b) => a - b);
  return minutes.map((minute, i) => ({ minute, out: (outs[i] as Player).id, in: (ins[i] as Player).id }));
}

export function computeStats(input: MatchInput, drafts: readonly Draft[]): MatchStats {
  const idx = (club: unknown) => (club === input.home.clubId ? 0 : 1);
  const z = (): [number, number] => [0, 0];
  const s: MatchStats = { shots: z(), onTarget: z(), xg: z(), fouls: z(), yellows: z(), reds: z(), possession: z() };
  const attacks = z();
  for (const e of drafts) {
    const p = e.payload as any;
    if (e.type === "match.attack") attacks[idx(p.team)]++;
    else if (e.type === "match.shot") {
      const i = idx(p.team);
      s.shots[i]++;
      s.xg[i] = round3(s.xg[i] + p.xg);
      if (p.outcome === "goal" || p.outcome === "saved" || p.outcome === "disallowed") s.onTarget[i]++;
    } else if (e.type === "match.foul") s.fouls[idx(p.team)]++;
    else if (e.type === "match.card") (p.card === "yellow" ? s.yellows : s.reds)[idx(p.team)]++;
  }
  const h = Math.round((100 * (attacks[0] + 4)) / (attacks[0] + attacks[1] + 8));
  s.possession = [h, 100 - h];
  return s;
}

/** Sorts by minute, rebuilds running scores and late-goal tags, and appends a fresh fulltime event. */
export function finalizeTimeline(input: MatchInput, drafts: readonly Draft[]): Draft[] {
  const ev = drafts.filter((d) => d.type !== "match.fulltime").map((d) => ({ ...d, payload: { ...d.payload }, tags: [...(d.tags ?? [])] }));
  ev.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  let h = 0, a = 0;
  for (const e of ev) {
    if (e.type !== "match.goal") continue;
    if ((e.payload as any).team === input.home.clubId) h++; else a++;
    e.payload.score = [h, a];
    e.tags = e.tags!.filter((t) => t !== "late-goal");
    if ((e.minute ?? 0) >= 85) e.tags.push("late-goal");
  }
  const end = Math.max(90, ...ev.map((e) => e.minute ?? 0));
  ev.push({
    type: "match.fulltime",
    date: input.date,
    fixtureId: input.fixtureId,
    minute: end,
    actors: [input.home.clubId, input.away.clubId],
    payload: { compId: input.compId, season: input.season, home: input.home.clubId, away: input.away.clubId, hg: h, ag: a, stats: computeStats(input, ev) },
    tags: [],
  });
  return ev;
}

export function timelineScore(drafts: readonly Draft[]): [number, number] {
  const ft = drafts.find((d) => d.type === "match.fulltime");
  const p = ft?.payload as any;
  return [p?.hg ?? 0, p?.ag ?? 0];
}

/** Natural match: no curses yet. Curses rewrite this timeline (M4) and call finalizeTimeline again. */
export function generateTimeline(input: MatchInput, rng: Rng): Draft[] {
  const sides = [input.home, input.away] as const;
  const maxMin = 90 + rng.int(2, 5);
  const base = { date: input.date, fixtureId: input.fixtureId };
  const rt = sides.map((s) => teamRatings(s.lineup));
  const plans = sides.map((s) => planSubs(s, rng));
  const reds = sides.map(() => new Map<Id, number>());

  // discipline first: it decides who is still on the pitch for everything else
  const disc: Draft[] = [];
  sides.forEach((side, i) => {
    const d = Math.max(25, rt[i]!.discipline);
    const minutes = Array.from({ length: rng.poisson((9 * 60) / d) }, () => rng.int(1, maxMin)).sort((x, y) => x - y);
    const yellows = new Set<Id>();
    for (const m of minutes) {
      const pool = onPitch(side, m, plans[i]!, reds[i]!).filter((p) => p.pos !== "GK");
      if (pool.length === 0) continue;
      const p = rng.weighted(pool, pool.map((x) => 101 - x.discipline));
      disc.push({ ...base, type: "match.foul", minute: m, actors: [side.clubId, p.id], payload: { team: side.clubId, player: p.id }, tags: [] });
      const roll = rng.next();
      const card = (c: "yellow" | "red", reason: string) =>
        disc.push({ ...base, type: "match.card", minute: m, actors: [side.clubId, p.id], payload: { team: side.clubId, player: p.id, card: c, reason }, tags: [] });
      if (roll < 0.01) { card("red", "foul"); reds[i]!.set(p.id, m); }
      else if (roll < 0.21) {
        if (yellows.has(p.id)) { card("red", "second-yellow"); reds[i]!.set(p.id, m); }
        else { yellows.add(p.id); card("yellow", "foul"); }
      }
    }
  });

  const subDrafts: Draft[] = [];
  sides.forEach((side, i) => {
    for (const s of plans[i]!) {
      const r = reds[i]!.get(s.out);
      if (r !== undefined && r <= s.minute) continue;
      subDrafts.push({ ...base, type: "match.sub", minute: s.minute, actors: [side.clubId, s.out, s.in], payload: { team: side.clubId, out: s.out, in: s.in }, tags: [] });
    }
  });

  const attacks: Draft[] = [];
  sides.forEach((side, i) => {
    const opp = sides[1 - i]!;
    const r = rt[i]!.att / rt[1 - i]!.def;
    const n = rng.poisson(12 * Math.sqrt(r) * (i === 0 ? 1.1 : 0.95));
    for (let k = 0; k < n; k++) {
      const minute = rng.int(1, maxMin);
      const pool = onPitch(side, minute, plans[i]!, reds[i]!).filter((p) => p.pos !== "GK");
      if (pool.length === 0) continue;
      const shooter = rng.weighted(pool, pool.map((p) => (p.pos === "FW" ? 2 : p.pos === "MF" ? 1 : 0.3) * p.att));
      const zone = rng.pick(["left", "centre", "right"] as const);
      const xg = round3(Math.min(0.6, Math.max(0.01, 0.11 * Math.sqrt(r) * (0.4 + 1.2 * rng.next()))));
      const outcome = rng.next() < xg ? "goal" : rng.weighted(["saved", "missed", "blocked"] as const, [45, 35, 20]);
      const ak = `a${i}-${k}`, sk = `s${i}-${k}`;
      attacks.push({ ...base, type: "match.attack", minute, key: ak, actors: [side.clubId, shooter.id], payload: { team: side.clubId, zone, shooter: shooter.id }, tags: [] });
      attacks.push({ ...base, type: "match.shot", minute, key: sk, causedByKey: ak, actors: [side.clubId, shooter.id], payload: { team: side.clubId, shooter: shooter.id, xg, outcome }, tags: [] });
      if (outcome === "goal") {
        const mates = pool.filter((p) => p.id !== shooter.id);
        const assist = mates.length && rng.chance(0.7) ? rng.weighted(mates, mates.map((p) => p.att)) : null;
        attacks.push({ ...base, type: "match.goal", minute, causedByKey: sk, actors: [side.clubId, shooter.id, ...(assist ? [assist.id] : [])], payload: { team: side.clubId, scorer: shooter.id, ...(assist && { assist: assist.id }), xg }, tags: [] });
      } else if (outcome === "saved") {
        const oi = 1 - i;
        const opool = onPitch(opp, minute, plans[oi]!, reds[oi]!);
        const keeper = opool.find((p) => p.pos === "GK") ?? (opool[0] as Player);
        attacks.push({ ...base, type: "match.save", minute, causedByKey: sk, actors: [opp.clubId, keeper.id], payload: { team: opp.clubId, keeper: keeper.id, shooter: shooter.id }, tags: [] });
      }
    }
  });

  const kickoff: Draft = { ...base, type: "match.kickoff", minute: 0, actors: [input.home.clubId, input.away.clubId], payload: { home: input.home.clubId, away: input.away.clubId }, tags: [] };
  return finalizeTimeline(input, [kickoff, ...subDrafts, ...disc, ...attacks]);
}

/** Returns a list of problems. An empty list means the timeline is internally consistent. */
export function validateTimeline(input: MatchInput, drafts: readonly Draft[]): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const teams = new Map([input.home, input.away].map((s) => [s.clubId, { side: s, on: new Set(s.lineup.map((p) => p.id)), bench: new Set(s.bench.map((p) => p.id)), yellow: new Set<Id>(), subs: 0 }]));
  const pos = new Map<Id, Player["pos"]>();
  for (const s of [input.home, input.away]) for (const p of [...s.lineup, ...s.bench]) pos.set(p.id, p.pos);
  if (drafts[0]?.type !== "match.kickoff" || drafts[0].minute !== 0) err("first event must be kickoff at minute 0");
  if (drafts[drafts.length - 1]?.type !== "match.fulltime") err("last event must be fulltime");
  if (drafts.filter((d) => d.type === "match.fulltime").length !== 1) err("exactly one fulltime event required");

  const keyed = new Map<string, Draft>();
  const follow = new Map<string, number>(); // shot key -> goal/save events
  const shotsOf = new Map<string, number>(); // attack key -> shots
  const goals = new Map<Id, number>([[input.home.clubId, 0], [input.away.clubId, 0]]);
  let last = 0;

  drafts.forEach((e, i) => {
    const m = e.minute ?? -1;
    if (m < last) err(`event ${i} (${e.type}) is out of time order`);
    last = Math.max(last, m);
    if (m < 0 || m > 100) err(`event ${i} has bad minute ${m}`);
    const p = e.payload as any;
    const t = teams.get(p.team);
    const need = (id: Id, who: string) => { if (!t || !t.on.has(id)) err(`event ${i} (${e.type}): ${who} ${id} is not on the pitch for ${p.team} at ${m}'`); };
    if (e.key) keyed.set(e.key, e);
    const cause = e.causedByKey ? keyed.get(e.causedByKey) : undefined;
    switch (e.type) {
      case "match.attack":
        need(p.shooter, "shooter"); shotsOf.set(e.key!, 0); break;
      case "match.shot":
        if (!cause || cause.type !== "match.attack") err(`event ${i}: shot has no attack`);
        else { shotsOf.set(cause.key!, (shotsOf.get(cause.key!) ?? 0) + 1); if ((cause.payload as any).team !== p.team) err(`event ${i}: shot team differs from attack`); }
        if (!["goal", "saved", "missed", "blocked", "disallowed"].includes(p.outcome)) err(`event ${i}: bad shot outcome`);
        follow.set(e.key!, 0); break;
      case "match.goal":
        need(p.scorer, "scorer");
        if (p.assist !== undefined) { need(p.assist, "assist"); if (p.assist === p.scorer) err(`event ${i}: assist equals scorer`); }
        if (!cause || cause.type !== "match.shot" || (cause.payload as any).outcome !== "goal") err(`event ${i}: goal without a goal shot`);
        else follow.set(cause.key!, (follow.get(cause.key!) ?? 0) + 1);
        if (teams.has(p.team)) goals.set(p.team, (goals.get(p.team) ?? 0) + 1);
        if (canon(p.score) !== canon([goals.get(input.home.clubId), goals.get(input.away.clubId)])) err(`event ${i}: running score is wrong`);
        break;
      case "match.save":
        need(p.keeper, "keeper");
        if (!cause || cause.type !== "match.shot" || (cause.payload as any).outcome !== "saved") err(`event ${i}: save without a saved shot`);
        else { follow.set(cause.key!, (follow.get(cause.key!) ?? 0) + 1); if ((cause.payload as any).team === p.team) err(`event ${i}: keeper saved a shot from his own team`); }
        break;
      case "match.rewrite":
        need(p.player, "player in rewrite");
        if (!cause || cause.type !== "match.shot") err(`event ${i}: rewrite without a shot`);
        else if ((cause.payload as any).outcome === "disallowed") follow.set(cause.key!, (follow.get(cause.key!) ?? 0) + 1);
        break;
      case "match.foul": need(p.player, "fouler"); break;
      case "match.card":
        need(p.player, "carded player");
        if (p.card === "yellow") { if (t?.yellow.has(p.player)) err(`event ${i}: second yellow must be a red`); t?.yellow.add(p.player); }
        else if (p.card === "red") {
          if (p.reason === "second-yellow" && !t?.yellow.has(p.player)) err(`event ${i}: second-yellow red without a first yellow`);
          t?.on.delete(p.player);
        } else err(`event ${i}: bad card`);
        break;
      case "match.sub":
        if (!t || !t.on.has(p.out) || pos.get(p.out) === "GK") err(`event ${i}: bad player going off`);
        else if (!t.bench.has(p.in)) err(`event ${i}: substitute ${p.in} is not on the bench`);
        else { t.on.delete(p.out); t.on.add(p.in); t.bench.delete(p.in); if (++t.subs > 5) err(`event ${i}: too many subs`); }
        break;
      case "match.fulltime": {
        if (p.home !== input.home.clubId || p.away !== input.away.clubId) err("fulltime teams do not match the fixture");
        if (p.hg !== goals.get(input.home.clubId) || p.ag !== goals.get(input.away.clubId)) err(`fulltime score ${p.hg}-${p.ag} does not match the goal events`);
        if (canon(p.stats) !== canon(computeStats(input, drafts))) err("fulltime stats do not match the events");
        break;
      }
      default: break;
    }
  });
  for (const [k, n] of shotsOf) if (n !== 1) err(`attack ${k} has ${n} shots`);
  for (const [k, n] of follow) {
    const out = (keyed.get(k)!.payload as any).outcome;
    const expect = out === "goal" || out === "saved" || out === "disallowed" ? 1 : 0;
    if (n !== expect) err(`shot ${k} (${out}) has ${n} follow-up events, expected ${expect}`);
  }
  return errs;
}

/** Validates, writes the timeline to the log, and marks the fixture played. */
export function commitMatch(state: GameState, log: EventLog, input: MatchInput, drafts: readonly Draft[]): GameEvent[] {
  const f = state.fixtures[input.fixtureId];
  if (!f) throw new Error(`Unknown fixture ${input.fixtureId}`);
  if (f.status !== "scheduled") throw new Error(`Fixture ${f.id} is already ${f.status}`);
  if (f.home !== input.home.clubId || f.away !== input.away.clubId) throw new Error("Match input does not match the fixture");
  const problems = validateTimeline(input, drafts);
  if (problems.length) throw new Error("Invalid timeline: " + problems.slice(0, 5).join("; "));
  const ids = new Map<string, string>();
  const out: GameEvent[] = [];
  for (const d of drafts) {
    const { key, causedByKey, ...rest } = d;
    const causedBy = causedByKey ? ids.get(causedByKey) : undefined;
    const ev = log.append({ ...rest, ...(causedBy && { causedBy }) });
    if (key) ids.set(key, ev.id);
    out.push(ev);
  }
  f.status = "played";
  return out;
}
