import { finalizeTimeline, type Draft, type MatchInput } from "../engine/match";
import type { Rng } from "../engine/rng";
import type { Id } from "../events/types";
import type { Player } from "../state/types";
import type { Result } from "./types";

export interface RewriteChange { kind: string; team: Id; minute: number }

const HINT_FOR: Record<string, string> = { saved: "keeper-fumble", missed: "post-and-in", blocked: "deflection" };
const VAR_KINDS = ["offside-overturned", "foul-in-build-up", "handball-var"];
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function onPitchAt(input: MatchInput, ev: readonly Draft[], clubId: Id, minute: number): Player[] {
  const side = input.home.clubId === clubId ? input.home : input.away;
  const all = new Map([...side.lineup, ...side.bench].map((p) => [p.id, p] as const));
  const on = new Set(side.lineup.map((p) => p.id));
  for (const e of ev) {
    const p = e.payload as any;
    if ((e.minute ?? 0) > minute || p?.team !== clubId) continue;
    if (e.type === "match.sub") { on.delete(p.out); on.add(p.in); }
    else if (e.type === "match.card" && p.card === "red") on.delete(p.player);
  }
  return [...on].map((id) => all.get(id) as Player);
}

/**
 * Edits a natural timeline until its result is `target` (home point of view).
 * Prefers turning an existing chance into a goal, or ruling out an existing goal, and only
 * invents a late chance when it has to. Every edit leaves a `match.rewrite` hint event.
 */
export function rewriteToResult(
  input: MatchInput,
  drafts: readonly Draft[],
  target: Result,
  curseId: Id,
  rng: Rng,
): { drafts: Draft[]; changes: RewriteChange[] } {
  let ev: Draft[] = drafts.filter((d) => d.type !== "match.fulltime").map((d) => ({ ...d, payload: { ...d.payload }, tags: [...(d.tags ?? [])] }));
  const home = input.home.clubId, away = input.away.clubId;
  const base = { date: input.date, fixtureId: input.fixtureId };
  const tags = ["unnatural", `curse:${curseId}`];
  const changes: RewriteChange[] = [];
  const pl = (e: Draft) => e.payload as any;
  const goals = (club: Id) => ev.filter((e) => e.type === "match.goal" && pl(e).team === club).length;
  let seq = 0;

  const needFor = (h: number, a: number): { benefit: Id; harm: Id } | null => {
    if (target === "D") return h > a ? { benefit: away, harm: home } : h < a ? { benefit: home, harm: away } : null;
    if (target === "W") return h <= a ? { benefit: home, harm: away } : null;
    return a <= h ? { benefit: away, harm: home } : null;
  };

  const pickScorer = (club: Id, minute: number, not?: Id) => {
    const pool = onPitchAt(input, ev, club, minute).filter((p) => p.pos !== "GK" && p.id !== not);
    return pool.length ? rng.weighted(pool, pool.map((p) => (p.pos === "FW" ? 2 : p.pos === "MF" ? 1 : 0.3) * p.att)) : null;
  };

  const hint = (kind: string, team: Id, player: Id, minute: number, causedByKey: string, from: string): Draft => ({
    ...base, type: "match.rewrite", minute, causedByKey, actors: [team, player], payload: { curseId, kind, team, player, from }, tags,
  });

  const convert = (b: Id): boolean => {
    const cands = ev.filter((e) => e.type === "match.shot" && pl(e).team === b && ["saved", "missed", "blocked"].includes(pl(e).outcome));
    if (!cands.length) return false;
    const shot = rng.weighted(cands, cands.map((s) => pl(s).xg * (1 + (s.minute ?? 0) / 60)));
    const old = pl(shot).outcome as string;
    const minute = shot.minute ?? 0;
    ev = ev.filter((e) => !(e.type === "match.save" && e.causedByKey === shot.key));
    pl(shot).outcome = "goal";
    const mates = onPitchAt(input, ev, b, minute).filter((p) => p.pos !== "GK" && p.id !== pl(shot).shooter);
    const assist = mates.length && rng.chance(0.6) ? rng.weighted(mates, mates.map((p) => p.att)) : null;
    const goal: Draft = {
      ...base, type: "match.goal", minute, causedByKey: shot.key, actors: [b, pl(shot).shooter, ...(assist ? [assist.id] : [])],
      payload: { team: b, scorer: pl(shot).shooter, ...(assist && { assist: assist.id }), xg: pl(shot).xg }, tags: [`curse:${curseId}`],
    };
    ev.splice(ev.indexOf(shot) + 1, 0, goal, hint(HINT_FOR[old] as string, b, pl(shot).shooter, minute, shot.key!, old));
    changes.push({ kind: HINT_FOR[old] as string, team: b, minute });
    return true;
  };

  const disallow = (h: Id): boolean => {
    const cands = ev.filter((e) => e.type === "match.goal" && pl(e).team === h && !(e.tags ?? []).some((t) => t.startsWith("curse:")));
    if (!cands.length) return false;
    const goal = rng.pick(cands);
    const shot = ev.find((e) => e.key === goal.causedByKey)!;
    pl(shot).outcome = "disallowed";
    const kind = rng.pick(VAR_KINDS);
    ev[ev.indexOf(goal)] = hint(kind, h, pl(goal).scorer, goal.minute ?? 0, shot.key!, "goal");
    changes.push({ kind, team: h, minute: goal.minute ?? 0 });
    return true;
  };

  const add = (b: Id): boolean => {
    const maxMin = Math.max(90, ...ev.map((e) => e.minute ?? 0));
    const minute = rng.int(78, maxMin);
    const shooter = pickScorer(b, minute);
    if (!shooter) return false;
    const n = seq++;
    const ak = `x${n}a`, sk = `x${n}s`;
    const xg = round3(0.05 + rng.next() * 0.15);
    ev.push(
      { ...base, type: "match.attack", minute, key: ak, actors: [b, shooter.id], payload: { team: b, zone: rng.pick(["left", "centre", "right"]), shooter: shooter.id }, tags: [] },
      { ...base, type: "match.shot", minute, key: sk, causedByKey: ak, actors: [b, shooter.id], payload: { team: b, shooter: shooter.id, xg, outcome: "goal" }, tags: [] },
      { ...base, type: "match.goal", minute, causedByKey: sk, actors: [b, shooter.id], payload: { team: b, scorer: shooter.id, xg }, tags: [`curse:${curseId}`] },
      hint("scramble", b, shooter.id, minute, sk, "chance"),
    );
    changes.push({ kind: "scramble", team: b, minute });
    return true;
  };

  for (let guard = 0; guard < 40; guard++) {
    const need = needFor(goals(home), goals(away));
    if (!need) break;
    const order = rng.chance(0.5) ? ["convert", "disallow", "add"] : ["disallow", "convert", "add"];
    const done = order.some((m) => (m === "convert" ? convert(need.benefit) : m === "disallow" ? disallow(need.harm) : add(need.benefit)));
    if (!done) throw new Error("Could not rewrite the timeline to the required result");
  }
  if (needFor(goals(home), goals(away))) throw new Error("Rewrite did not converge");
  return { drafts: finalizeTimeline(input, ev), changes };
}
