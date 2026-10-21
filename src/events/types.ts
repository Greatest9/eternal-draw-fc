export type Id = string;

export const SIM_EVENT_TYPES = [
  "match.kickoff", "match.attack", "match.shot", "match.save", "match.goal",
  "match.foul", "match.card", "match.sub", "match.injury", "match.rewrite", "match.fulltime",
  "fixture.postponed", "fixture.abandoned", "fixture.rescheduled",
  "table.updated", "season.started", "season.ended", "club.promoted", "club.relegated", "club.dropped", "career.ended",
  "manager.sacked", "manager.hired", "transfer.completed", "contract.signed",
  "finance.updated", "board.message",
  "curse.applied", "curse.conflict", "curse.resolved", "curse.legend.progress",
  "streak.updated", "milestone.reached", "achievement.unlocked", "rivalry.formed",
] as const;

/** Narrative events are derived output. They are excluded from the simulation hash. */
export const NARRATIVE_EVENT_TYPES = [
  "news.published", "fan.post", "commentary.line", "cutaway.cue",
] as const;

export type SimEventType = (typeof SIM_EVENT_TYPES)[number];
export type NarrativeEventType = (typeof NARRATIVE_EVENT_TYPES)[number];
export type EventType = SimEventType | NarrativeEventType;

export function isNarrative(type: EventType): type is NarrativeEventType {
  return (NARRATIVE_EVENT_TYPES as readonly string[]).includes(type);
}

export interface GameEvent {
  id: string;
  seq: number;
  type: EventType;
  date: string;
  fixtureId?: Id;
  minute?: number;
  actors: Id[];
  payload: Record<string, unknown>;
  tags: string[];
  causedBy?: string;
}

export interface NewEvent {
  type: EventType;
  date: string;
  fixtureId?: Id;
  minute?: number;
  actors?: Id[];
  payload?: Record<string, unknown>;
  tags?: string[];
  causedBy?: string;
}
