import { chooseTarget, collectConstraints, resolveOutcome, resultOf, type Resolution } from "../curses/resolve";
import { rewriteToResult, type RewriteChange } from "../curses/rewrite";
import type { CurseRegistry, Result } from "../curses/types";
import type { EventLog } from "../events/store";
import type { Id } from "../events/types";
import type { GameState } from "../state/types";
import { commitMatch, generateTimeline, timelineScore, type MatchInput, type Side } from "./match";
import { stream } from "./rng";
import { voidFixture } from "./season";

export interface PlayContext {
  state: GameState;
  log: EventLog;
  seed: string;
  registry: CurseRegistry;
  sideFor: (clubId: Id) => Side;
}

export type PlayOutcome =
  | { status: "played"; hg: number; ag: number; natural: [number, number]; resolution: Resolution; changes: RewriteChange[] }
  | { status: "postponed" | "abandoned"; reason: string };

/**
 * One fixture, end to end: gate, natural match, curse resolution, rewrite, validation, commit.
 * Curses decide the result; they never skip validation.
 */
export function playFixture(ctx: PlayContext, fixtureId: Id): PlayOutcome {
  const { state, log, seed, registry } = ctx;
  const f = state.fixtures[fixtureId];
  if (!f) throw new Error(`Unknown fixture ${fixtureId}`);
  const hc = state.clubs[f.home]!, ac = state.clubs[f.away]!;

  for (const rule of registry.rules) {
    if (!rule.matches(state, hc, ac)) continue;
    const d = rule.gate({ state, fixture: f, rng: stream(seed, "gate", f.id) });
    if (d) {
      voidFixture(state, log, f.id, d.kind, d.reason, d.tags);
      rule.afterDisruption?.(state, log, f);
      return { status: d.kind, reason: d.reason };
    }
  }

  const input: MatchInput = { fixtureId: f.id, compId: f.compId, season: state.season, date: f.date, home: ctx.sideFor(f.home), away: ctx.sideFor(f.away) };
  let drafts = generateTimeline(input, stream(seed, "match", f.id));
  const natural = timelineScore(drafts);

  const suspended = registry.rules.some((r) => r.matches(state, hc, ac) && r.suspendsCurses?.(state, hc, ac));
  const resolution = resolveOutcome(collectConstraints(input, state, registry), state.settings.paradoxPolicy, registry, suspended);
  const naturalResult = resultOf(natural[0], natural[1]);
  const target: Result = chooseTarget(naturalResult, resolution.allowedHome);
  let changes: RewriteChange[] = [];

  if (target !== naturalResult) {
    const lead = resolution.applied.find((id) => !registry.get(id)!.outcome!.includes(naturalResult)) ?? resolution.applied[0] ?? "curse";
    ({ drafts, changes } = rewriteToResult(input, drafts, target, lead, stream(seed, "curse", f.id)));
  }
  const final = timelineScore(drafts);
  if (!resolution.allowedHome.includes(resultOf(final[0], final[1]))) {
    throw new Error(`Curse invariant broken in ${f.id}: result ${final.join("-")} is not in ${resolution.allowedHome.join("")}`);
  }

  commitMatch(state, log, input, drafts);

  const meta = { date: f.date, fixtureId: f.id, actors: [f.home, f.away] };
  if (resolution.conflict) {
    log.append({ ...meta, type: "curse.conflict", payload: { curses: resolution.constraints.map((c) => c.curseId), policy: state.settings.paradoxPolicy, stalemate: resolution.stalemate }, tags: ["paradox"] });
  }
  if (resolution.constraints.length > 0) {
    log.append({ ...meta, type: "curse.resolved", payload: { policy: resolution.policy, applied: resolution.applied, overridden: resolution.overridden, natural, final, allowedHome: resolution.allowedHome }, tags: resolution.conflict ? ["paradox"] : [] });
  }
  for (const c of resolution.constraints) {
    if (resolution.applied.includes(c.curseId) && !c.allowedHome.includes(naturalResult)) {
      log.append({ ...meta, type: "curse.applied", payload: { curseId: c.curseId, clubId: c.clubId, natural, final, edits: changes.length }, tags: [`curse:${c.curseId}`] });
    }
  }

  for (const rule of registry.rules) if (rule.matches(state, hc, ac)) rule.afterPlayed?.(state, log, f);
  return { status: "played", hg: final[0], ag: final[1], natural, resolution, changes };
}
