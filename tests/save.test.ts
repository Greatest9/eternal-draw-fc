import { describe, expect, it } from "vitest";
import { EventLog } from "../src/events/store";
import { emptyState } from "../src/state/types";
import { createSave, deserialize, serialize, SAVE_VERSION } from "../src/save/save";

describe("save format", () => {
  it("round-trips state and events, keeping the sim hash", () => {
    const log = new EventLog();
    log.append({ type: "match.goal", date: "2026-08-08", minute: 89, tags: ["late-goal"] });
    const loaded = deserialize(serialize(createSave("career-1", emptyState(), log)));
    expect(loaded.seed).toBe("career-1");
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(new EventLog(loaded.events).simHash()).toBe(log.simHash());
  });

  it("runs migrations in order", () => {
    const old = JSON.stringify({ version: 0, seed: "s", state: emptyState(), events: [] });
    const migrated = deserialize(
      old,
      { 0: (s) => ({ ...s, state: { ...s.state, season: 7 } }) },
      1,
    );
    expect(migrated.version).toBe(1);
    expect(migrated.state.season).toBe(7);
  });

  it("rejects saves from a newer version", () => {
    const future = JSON.stringify({ version: 99, seed: "s", state: emptyState(), events: [] });
    expect(() => deserialize(future)).toThrow(/newer version/);
  });

  it("rejects bad input", () => {
    expect(() => deserialize("not json")).toThrow(/valid JSON/);
    expect(() => deserialize(JSON.stringify({ seed: "s" }))).toThrow(/no version/);
    expect(() => deserialize(JSON.stringify({ version: 1, seed: "s" }))).toThrow(/missing/);
  });
});
