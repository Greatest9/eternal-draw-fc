import type { EventLog } from "../events/store";
import type { GameEvent } from "../events/types";
import type { GameState } from "../state/types";

export const SAVE_VERSION = 1;

export interface SaveGame {
  version: number;
  seed: string;
  state: GameState;
  events: GameEvent[];
}

/** Each entry upgrades a save from version N to N + 1. */
export type Migrations = Record<number, (save: any) => any>;

export const MIGRATIONS: Migrations = {};

export function createSave(seed: string, state: GameState, log: EventLog): SaveGame {
  return { version: SAVE_VERSION, seed, state, events: log.toJSON() };
}

export function serialize(save: SaveGame): string {
  return JSON.stringify(save);
}

export function deserialize(
  json: string,
  migrations: Migrations = MIGRATIONS,
  current: number = SAVE_VERSION,
): SaveGame {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Save file is not valid JSON");
  }
  if (!data || typeof data.version !== "number") throw new Error("Save file has no version");
  if (data.version > current) {
    throw new Error(`Save is from a newer version (${data.version}), this build supports ${current}`);
  }
  while (data.version < current) {
    const step = migrations[data.version];
    if (!step) throw new Error(`No migration from save version ${data.version}`);
    data = step(data);
    data.version = data.version + 1;
  }
  if (typeof data.seed !== "string" || !data.state || !Array.isArray(data.events)) {
    throw new Error("Save file is missing required fields");
  }
  return data as SaveGame;
}
