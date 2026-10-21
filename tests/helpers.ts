import { stream } from "../src/engine/rng";
import { fixturesForRound, recordResult, startSeason } from "../src/engine/season";
import { EventLog } from "../src/events/store";
import { emptyState, type Club, type GameState } from "../src/state/types";

const pad = (n: number) => String(n).padStart(2, "0");

export function makeWorld(playerClubId: string | null = null): { state: GameState; log: EventLog } {
  const state = emptyState();
  state.playerClubId = playerClubId;
  const ids = Array.from({ length: 30 }, (_, i) => `c${pad(i + 1)}`);
  for (const id of ids) {
    const club: Club = { id, name: id, colors: ["#000", "#fff"], formation: "4-4-2", curses: [], budget: 0, fanMood: 50, squad: [] };
    state.clubs[id] = club;
  }
  state.competitions["d1"] = { id: "d1", name: "Division 1", tier: 1, clubIds: ids.slice(0, 12) };
  state.competitions["d2"] = { id: "d2", name: "Division 2", tier: 2, clubIds: ids.slice(12, 24) };
  return { state, log: new EventLog() };
}

export type ResultFn = (fixtureId: string, home: string, away: string) => [number, number];

/** Plays every scheduled fixture. Default results are random goals from a per-fixture stream. */
export function playSeason(state: GameState, log: EventLog, seed: string, result?: ResultFn): void {
  const rounds = 22;
  for (let r = 1; r <= rounds; r++) {
    for (const compId of Object.keys(state.competitions)) {
      for (const f of fixturesForRound(state, compId, r)) {
        if (f.status !== "scheduled") continue;
        const [hg, ag] = result
          ? result(f.id, f.home, f.away)
          : (() => { const s = stream(seed, "dummy", f.id); return [s.poisson(1.4), s.poisson(1.1)] as [number, number]; })();
        recordResult(state, log, f.id, hg, ag);
      }
    }
  }
}

export function newSeason(seed: string, playerClubId: string | null = null) {
  const w = makeWorld(playerClubId);
  startSeason(w.state, w.log, seed);
  return w;
}

import { pickLineup } from "../src/engine/lineup";
import type { MatchInput, Side } from "../src/engine/match";
import type { Player } from "../src/state/types";

const clamp = (n: number) => Math.max(1, Math.min(99, n));

export function makeSquad(clubId: string, seed: string, quality = 60): Player[] {
  const r = stream(seed, "squad", clubId);
  const spec: Array<[Player["pos"], number]> = [["GK", 2], ["DF", 6], ["MF", 6], ["FW", 5]];
  const out: Player[] = [];
  let n = 0;
  for (const [pos, count] of spec) {
    for (let i = 0; i < count; i++) {
      const back = pos === "DF" || pos === "GK";
      out.push({
        id: `${clubId}-p${++n}`, name: `${clubId} ${pos}${i + 1}`, pos, clubId, morale: 50,
        att: clamp(quality + r.int(-8, 8) + (pos === "FW" ? 6 : back ? -12 : 0)),
        def: clamp(quality + r.int(-8, 8) + (back ? 6 : pos === "FW" ? -12 : 0)),
        pace: r.int(40, 80),
        discipline: r.int(45, 80),
      });
    }
  }
  return out;
}

export function makeSide(clubId: string, seed: string, quality = 60, formation = "4-4-2"): Side {
  const { lineup, bench } = pickLineup(formation, makeSquad(clubId, seed, quality));
  return { clubId, formation, lineup, bench };
}

export function makeInput(fixtureId: string, home: Side, away: Side, compId = "d1"): MatchInput {
  return { fixtureId, compId, season: 1, date: "2026-08-08", home, away };
}
