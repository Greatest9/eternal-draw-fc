import type { Id } from "../events/types";

export type Formation = string; // e.g. "4-5-1"
export type Position = "GK" | "DF" | "MF" | "FW";

export interface Player {
  id: Id;
  name: string;
  pos: Position;
  att: number; // 1..100
  def: number;
  pace: number;
  discipline: number;
  morale: number;
  clubId: Id;
}

export interface Club {
  id: Id;
  name: string;
  colors: [string, string];
  formation: Formation;
  curses: Id[];
  budget: number;
  fanMood: number; // 0..100
  squad: Id[];
}

export type FixtureStatus = "scheduled" | "played" | "postponed" | "abandoned";

export interface Fixture {
  id: Id;
  compId: Id;
  round: number;
  date: string;
  home: Id;
  away: Id;
  status: FixtureStatus;
}

export interface Competition {
  id: Id;
  name: string;
  tier: number;
  clubIds: Id[];
}

export type ParadoxPolicy = "priority" | "strength" | "cancel";
export type AbandonedPolicy = "void" | "replay";

export interface Settings {
  paradoxPolicy: ParadoxPolicy;
  abandonedMatches: AbandonedPolicy;
  /** Clubs moving between each pair of tiers each season. Bottom tier drops this many out of the league. */
  promotionSlots: number;
  relegationSlots: number;
}

export interface GameState {
  season: number;
  date: string; // game calendar date, YYYY-MM-DD
  clubs: Record<Id, Club>;
  players: Record<Id, Player>;
  competitions: Record<Id, Competition>;
  fixtures: Record<Id, Fixture>;
  playerClubId: Id | null;
  careerOver: boolean;
  /** Hidden world flags (legend progress and similar). Never shown in UI text. */
  flags: Record<string, boolean | number | string>;
  settings: Settings;
}

export function emptyState(date = "2026-08-01"): GameState {
  return {
    season: 1,
    date,
    clubs: {},
    players: {},
    competitions: {},
    fixtures: {},
    playerClubId: null,
    careerOver: false,
    flags: {},
    settings: { paradoxPolicy: "priority", abandonedMatches: "void", promotionSlots: 3, relegationSlots: 3 },
  };
}
