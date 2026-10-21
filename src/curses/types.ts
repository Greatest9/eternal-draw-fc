import type { Rng } from "../engine/rng";
import type { EventLog } from "../events/store";
import type { Id } from "../events/types";
import type { Club, Fixture, GameState } from "../state/types";

/** A result from the HOME side's point of view. */
export type Result = "W" | "D" | "L";
export const ALL_RESULTS: readonly Result[] = ["W", "D", "L"];

export type CurseCategory = "outcome" | "performance" | "objective" | "economic" | "fixture";

export interface Curse {
  id: Id;
  name: string;
  category: CurseCategory;
  /** Fixed ordering used by the "priority" policy. Higher wins. */
  priority: number;
  /** Used by the "strength" policy. Higher wins. */
  strength: number;
  /** Results the cursed club may end a match with, from that club's own point of view. */
  outcome?: readonly Result[];
}

export interface Disruption {
  kind: "postponed" | "abandoned";
  reason: string;
  tags: string[];
}

/** A rule about specific fixtures, such as the fixture that never gets played. */
export interface FixtureRule {
  id: Id;
  matches(state: GameState, home: Club, away: Club): boolean;
  /** Return a disruption to stop the match being played, or null to let it go ahead. */
  gate(ctx: { state: GameState; fixture: Fixture; rng: Rng }): Disruption | null;
  afterDisruption?(state: GameState, log: EventLog, fixture: Fixture): void;
  /** True when both clubs' curses are suspended for this match. */
  suspendsCurses?(state: GameState, home: Club, away: Club): boolean;
  afterPlayed?(state: GameState, log: EventLog, fixture: Fixture): void;
}

export class CurseRegistry {
  private curses = new Map<Id, Curse>();
  readonly rules: FixtureRule[] = [];

  register(c: Curse): this {
    if (this.curses.has(c.id)) throw new Error(`Curse ${c.id} already registered`);
    this.curses.set(c.id, c);
    return this;
  }

  addRule(r: FixtureRule): this {
    this.rules.push(r);
    return this;
  }

  get(id: Id): Curse | undefined {
    return this.curses.get(id);
  }

  all(): Curse[] {
    return [...this.curses.values()];
  }
}
