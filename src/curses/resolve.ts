import type { Id } from "../events/types";
import type { GameState, ParadoxPolicy } from "../state/types";
import type { MatchInput } from "../engine/match";
import { ALL_RESULTS, type CurseRegistry, type Result } from "./types";

const FLIP: Record<Result, Result> = { W: "L", D: "D", L: "W" };

export interface Constraint {
  curseId: Id;
  clubId: Id;
  /** Allowed results from the home side's point of view. */
  allowedHome: Result[];
}

export interface Resolution {
  constraints: Constraint[];
  conflict: boolean;
  policy: ParadoxPolicy | "legend" | "none";
  stalemate: boolean;
  applied: Id[];
  overridden: Id[];
  allowedHome: Result[];
}

export function collectConstraints(input: MatchInput, state: GameState, registry: CurseRegistry): Constraint[] {
  const out: Constraint[] = [];
  for (const [side, isHome] of [[input.home, true], [input.away, false]] as const) {
    for (const cid of state.clubs[side.clubId]?.curses ?? []) {
      const c = registry.get(cid);
      if (!c?.outcome) continue;
      out.push({ curseId: c.id, clubId: side.clubId, allowedHome: isHome ? [...c.outcome] : c.outcome.map((r) => FLIP[r]) });
    }
  }
  return out;
}

const intersect = (cs: Constraint[]): Result[] => ALL_RESULTS.filter((r) => cs.every((c) => c.allowedHome.includes(r)));

export function resolveOutcome(
  constraints: Constraint[],
  policy: ParadoxPolicy,
  registry: CurseRegistry,
  suspended = false,
): Resolution {
  const ids = constraints.map((c) => c.curseId);
  const none = { constraints, conflict: false, stalemate: false, applied: [] as Id[], overridden: [] as Id[], allowedHome: [...ALL_RESULTS] };
  if (constraints.length === 0) return { ...none, policy: "none" };
  if (suspended) return { ...none, conflict: true, policy: "legend", overridden: ids };

  const all = intersect(constraints);
  if (all.length > 0) return { ...none, policy: "none", applied: ids, allowedHome: all };

  if (policy === "cancel") return { ...none, conflict: true, policy, overridden: ids };

  const key = (c: Constraint) => (policy === "priority" ? registry.get(c.curseId)!.priority : registry.get(c.curseId)!.strength);
  const best = Math.max(...constraints.map(key));
  if (intersect(constraints.filter((c) => key(c) === best)).length === 0) {
    return { ...none, conflict: true, policy, stalemate: true, overridden: ids };
  }
  const sorted = [...constraints].sort((a, b) => key(b) - key(a) || a.curseId.localeCompare(b.curseId));
  const kept: Constraint[] = [];
  const dropped: Id[] = [];
  for (const c of sorted) {
    if (intersect([...kept, c]).length > 0) kept.push(c);
    else dropped.push(c.curseId);
  }
  return { ...none, conflict: true, policy, applied: kept.map((c) => c.curseId), overridden: dropped, allowedHome: intersect(kept) };
}

const VAL: Record<Result, number> = { W: 1, D: 0, L: -1 };

export function resultOf(hg: number, ag: number): Result {
  return hg > ag ? "W" : hg < ag ? "L" : "D";
}

/** The allowed result closest to what the natural match produced. */
export function chooseTarget(natural: Result, allowed: readonly Result[]): Result {
  if (allowed.includes(natural)) return natural;
  return [...allowed].sort((a, b) => Math.abs(VAL[a] - VAL[natural]) - Math.abs(VAL[b] - VAL[natural]) || VAL[b] - VAL[a])[0] as Result;
}
