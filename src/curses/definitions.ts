import type { Id } from "../events/types";
import type { Club, GameState } from "../state/types";
import { CurseRegistry, type Curse, type FixtureRule } from "./types";

export const EQUILIBRIUM: Curse = {
  id: "equilibrium",
  name: "The Eternal Equilibrium",
  category: "outcome",
  priority: 100,
  strength: 80,
  outcome: ["D"],
};

export const FALL: Curse = {
  id: "fall",
  name: "The Inevitable Fall",
  category: "outcome",
  priority: 90,
  strength: 70,
  outcome: ["L"],
};

export const LEGEND_UNLOCKED = "legend.doomed.unlocked";
export const LEGEND_DISRUPTIONS = "legend.doomed.disruptions";
export const LEGEND_LAST_MET = "legend.doomed.lastMet";
export const LEGEND_BROKEN = "legend.doomed.broken";

const REASONS = [
  "waterlogged pitch", "floodlight failure", "a pre-match riot", "both coaches stuck in a lift",
  "stolen goalposts", "a fire alarm", "the referee losing his whistle", "sheep on the pitch",
  "a fog that only affected the stadium", "a dispute over who was the home side",
];

const has = (c: Club, id: Id) => c.curses.includes(id);
const isPair = (a: Club, b: Club) => (has(a, EQUILIBRIUM.id) && has(b, FALL.id)) || (has(a, FALL.id) && has(b, EQUILIBRIUM.id));
const year = (s: GameState) => Number(s.date.slice(0, 4));

/**
 * The fixture between the club that always draws and the club that always loses never gets played.
 * It is matched by curse, not by club name. A hidden flag (set by `unlockLegend`) lets one match go ahead;
 * after that match both curses are gone. What sets the flag is an open design decision.
 */
export const DOOMED_FIXTURE: FixtureRule = {
  id: "doomed-fixture",
  matches: (_s, h, a) => isPair(h, a),
  gate({ state, rng }) {
    if (state.flags[LEGEND_UNLOCKED] === true) return null;
    return {
      kind: rng.chance(0.65) ? "postponed" : "abandoned",
      reason: rng.pick(REASONS),
      tags: ["legend:doomed-fixture"],
    };
  },
  afterDisruption(state, log, f) {
    const n = ((state.flags[LEGEND_DISRUPTIONS] as number | undefined) ?? 0) + 1;
    state.flags[LEGEND_DISRUPTIONS] = n;
    const last = (state.flags[LEGEND_LAST_MET] as number | undefined) ?? 1996;
    log.append({
      type: "curse.legend.progress",
      date: f.date,
      fixtureId: f.id,
      actors: [f.home, f.away],
      payload: { stage: "disrupted", disruptions: n, yearsSinceLastMeeting: year(state) - last },
      tags: ["legend:doomed-fixture"],
    });
  },
  suspendsCurses: (s, h, a) => isPair(h, a) && s.flags[LEGEND_UNLOCKED] === true,
  afterPlayed(state, log, f) {
    for (const id of [f.home, f.away]) {
      const c = state.clubs[id]!;
      c.curses = c.curses.filter((x) => x !== EQUILIBRIUM.id && x !== FALL.id);
    }
    state.flags[LEGEND_UNLOCKED] = false;
    state.flags[LEGEND_BROKEN] = true;
    state.flags[LEGEND_LAST_MET] = year(state);
    log.append({
      type: "curse.legend.progress",
      date: f.date,
      fixtureId: f.id,
      actors: [f.home, f.away],
      payload: { stage: "curse-broken" },
      tags: ["legend:doomed-fixture", "legend:broken"],
    });
  },
};

export function createRegistry(opts: { legend?: boolean } = {}): CurseRegistry {
  const r = new CurseRegistry().register(EQUILIBRIUM).register(FALL);
  if (opts.legend !== false) r.addRule(DOOMED_FIXTURE);
  return r;
}

/** Hook for whatever the break condition turns out to be. Until something calls this, the fixture never happens. */
export function unlockLegend(state: GameState): void {
  state.flags[LEGEND_UNLOCKED] = true;
}
