import type { EventLog } from "../events/store";
import type { Id } from "../events/types";
import type { Fixture, GameState } from "../state/types";
import { nextSeasonStart } from "./calendar";
import { generateFixtures } from "./fixtures";
import { buildTable, type Standing } from "./league";

/** All functions here mutate `state` in place and append to `log`. */

export function startSeason(state: GameState, log: EventLog, seed: string): void {
  state.fixtures = {};
  for (const comp of Object.values(state.competitions)) {
    for (const f of generateFixtures(comp.id, comp.clubIds, state.season, state.date, seed)) {
      state.fixtures[f.id] = f;
    }
  }
  log.append({
    type: "season.started",
    date: state.date,
    payload: { season: state.season, competitions: Object.keys(state.competitions) },
  });
}

export function fixturesForRound(state: GameState, compId: Id, round: number): Fixture[] {
  return Object.values(state.fixtures).filter((f) => f.compId === compId && f.round === round);
}

function scheduled(state: GameState, fixtureId: Id): Fixture {
  const f = state.fixtures[fixtureId];
  if (!f) throw new Error(`Unknown fixture ${fixtureId}`);
  if (f.status !== "scheduled") throw new Error(`Fixture ${fixtureId} is already ${f.status}`);
  return f;
}

export function recordResult(
  state: GameState,
  log: EventLog,
  fixtureId: Id,
  hg: number,
  ag: number,
): void {
  const f = scheduled(state, fixtureId);
  log.append({
    type: "match.fulltime",
    date: f.date,
    fixtureId,
    actors: [f.home, f.away],
    payload: { compId: f.compId, season: state.season, home: f.home, away: f.away, hg, ag },
  });
  f.status = "played";
}

/** Postponed or abandoned: no result, no points. Policy for replays is a later step. */
export function voidFixture(
  state: GameState,
  log: EventLog,
  fixtureId: Id,
  kind: "postponed" | "abandoned",
  reason: string,
  tags: string[] = [],
): void {
  const f = scheduled(state, fixtureId);
  log.append({
    type: kind === "postponed" ? "fixture.postponed" : "fixture.abandoned",
    date: f.date,
    fixtureId,
    actors: [f.home, f.away],
    payload: { compId: f.compId, season: state.season, reason },
    tags,
  });
  f.status = kind;
}

export interface SeasonSummary {
  season: number;
  tables: Record<Id, Standing[]>;
  promoted: Id[];
  relegated: Id[];
  dropped: Id[];
  careerOver: boolean;
}

/**
 * Closes the season. Between each pair of tiers the bottom N go down and the top N come up.
 * The bottom tier drops its last N out of the league and takes `incoming` clubs in their place.
 * If the player's club is dropped, the career is over.
 */
export function endSeason(state: GameState, log: EventLog, incoming: Id[] = []): SeasonSummary {
  const k = state.settings.relegationSlots;
  if (state.settings.promotionSlots !== k) throw new Error("promotionSlots must equal relegationSlots");
  const comps = Object.values(state.competitions).sort((a, b) => a.tier - b.tier);
  if (comps.length === 0) throw new Error("No competitions");
  if (incoming.length !== k) throw new Error(`Bottom tier needs exactly ${k} incoming clubs`);
  const inLeague = new Set(comps.flatMap((c) => c.clubIds));
  for (const id of incoming) {
    if (!state.clubs[id]) throw new Error(`Unknown incoming club ${id}`);
    if (inLeague.has(id)) throw new Error(`Incoming club ${id} is already in the league`);
  }

  const date = state.date;
  const tables: Record<Id, Standing[]> = {};
  for (const c of comps) {
    const t = buildTable(log.all(), c.id, state.season, c.clubIds);
    tables[c.id] = t;
    log.append({ type: "table.updated", date, payload: { compId: c.id, season: state.season, table: t } });
  }
  const top = (id: Id) => tables[id]!.slice(0, k).map((r) => r.clubId);
  const bottom = (id: Id) => tables[id]!.slice(-k).map((r) => r.clubId);

  const promoted: Id[] = [];
  const relegated: Id[] = [];
  const dropped = bottom(comps[comps.length - 1]!.id);
  const nextIds = new Map<Id, Id[]>();

  comps.forEach((c, i) => {
    const out = new Set<Id>();
    const add: Id[] = [];
    const last = i === comps.length - 1;
    const first = i === 0;
    bottom(c.id).forEach((id) => out.add(id));
    if (!first) top(c.id).forEach((id) => out.add(id));
    if (!first) add.push(...bottom(comps[i - 1]!.id));
    if (!last) add.push(...top(comps[i + 1]!.id));
    if (last) add.push(...incoming);
    nextIds.set(c.id, [...c.clubIds.filter((id) => !out.has(id)), ...add]);
    if (!first) for (const id of top(c.id)) { promoted.push(id); log.append({ type: "club.promoted", date, actors: [id], payload: { season: state.season, from: c.id, to: comps[i - 1]!.id } }); }
    if (!last) for (const id of bottom(c.id)) { relegated.push(id); log.append({ type: "club.relegated", date, actors: [id], payload: { season: state.season, from: c.id, to: comps[i + 1]!.id } }); }
  });

  for (const id of dropped) {
    log.append({ type: "club.dropped", date, actors: [id], payload: { season: state.season, from: comps[comps.length - 1]!.id } });
  }
  const careerOver = state.playerClubId !== null && dropped.includes(state.playerClubId);
  if (careerOver) {
    state.careerOver = true;
    log.append({ type: "career.ended", date, actors: [state.playerClubId as Id], payload: { season: state.season }, tags: ["career:ended"] });
  }
  log.append({ type: "season.ended", date, payload: { season: state.season, promoted, relegated, dropped } });

  for (const c of comps) c.clubIds = nextIds.get(c.id)!;
  const summary: SeasonSummary = { season: state.season, tables, promoted, relegated, dropped, careerOver };
  state.fixtures = {};
  state.season += 1;
  state.date = nextSeasonStart(state.date);
  return summary;
}
