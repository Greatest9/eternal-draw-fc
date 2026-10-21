import { canon, hash53 } from "./canon";
import { isNarrative, type GameEvent, type Id, type NewEvent } from "./types";

/** Append-only event log. Ids and sequence numbers are assigned here, never by callers. */
export class EventLog {
  private events: GameEvent[];

  constructor(existing: readonly GameEvent[] = []) {
    this.events = existing.map((e) => ({ ...e }));
  }

  append(e: NewEvent): GameEvent {
    const seq = this.events.length + 1;
    const event: GameEvent = {
      id: `e${seq}`,
      seq,
      type: e.type,
      date: e.date,
      actors: e.actors ?? [],
      payload: e.payload ?? {},
      tags: e.tags ?? [],
      ...(e.fixtureId !== undefined && { fixtureId: e.fixtureId }),
      ...(e.minute !== undefined && { minute: e.minute }),
      ...(e.causedBy !== undefined && { causedBy: e.causedBy }),
    };
    this.events.push(event);
    return event;
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly GameEvent[] {
    return this.events;
  }

  byType(type: GameEvent["type"]): GameEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  byTag(tag: string): GameEvent[] {
    return this.events.filter((e) => e.tags.includes(tag));
  }

  byFixture(fixtureId: Id): GameEvent[] {
    return this.events.filter((e) => e.fixtureId === fixtureId);
  }

  /**
   * Hash of simulation events only. Narrative output must never change it, so ids and sequence numbers
   * are renumbered over sim events alone (narrative events interleaved in the log would shift them).
   */
  simHash(): string {
    const sim = this.events.filter((e) => !isNarrative(e.type));
    const rank = new Map(sim.map((e, i) => [e.id, i + 1] as const));
    return hash53(canon(sim.map((e, i) => ({ ...e, id: `s${i + 1}`, seq: i + 1, ...(e.causedBy !== undefined && { causedBy: `s${rank.get(e.causedBy) ?? 0}` }) }))));
  }

  /** Hash of everything, narrative output included. Used to check the narrative layer is deterministic. */
  fullHash(): string {
    return hash53(canon(this.events));
  }

  toJSON(): GameEvent[] {
    return this.events.map((e) => ({ ...e }));
  }
}
