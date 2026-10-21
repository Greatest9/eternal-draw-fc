import { describe, expect, it } from "vitest";
import { deriveAchievements, runDerivers } from "../src/derive/derive";
import { endSeason, fixturesForRound, recordResult } from "../src/engine/season";
import type { Fixture } from "../src/state/types";
import { newSeason } from "./helpers";

type Fn = (f: Fixture, round: number) => [number, number];

function rounds(state: ReturnType<typeof newSeason>["state"], log: ReturnType<typeof newSeason>["log"], from: number, to: number, fn: Fn) {
  for (let r = from; r <= to; r++) {
    for (const comp of ["d1", "d2"]) for (const f of fixturesForRound(state, comp, r)) recordResult(state, log, f.id, ...fn(f, r));
    runDerivers(state, log);
  }
}
const involves = (f: Fixture, id: string) => f.home === id || f.away === id;
const lens = (log: ReturnType<typeof newSeason>["log"], club: string, kind: string) =>
  log.byType("streak.updated").filter((e) => e.payload.clubId === club && e.payload.kind === kind).map((e) => e.payload.length);

describe("streak derivers", () => {
  it("emits each streak length once, with a milestone at 5", () => {
    const { state, log } = newSeason("d1");
    rounds(state, log, 1, 6, (f) => (involves(f, "c01") ? [1, 1] : [0, 0]));
    expect(lens(log, "c01", "draws")).toEqual([3, 4, 5, 6]);
    expect(lens(log, "c01", "unbeaten")).toEqual([3, 4, 5, 6]);
    expect(log.byType("milestone.reached").filter((e) => e.payload.clubId === "c01" && e.payload.kind === "streak-draws")).toHaveLength(1);
  });

  it("is idempotent", () => {
    const { state, log } = newSeason("d1");
    rounds(state, log, 1, 4, () => [1, 1]);
    const n = log.length;
    expect(runDerivers(state, log)).toEqual([]);
    expect(log.length).toBe(n);
  });

  it("a win resets the draw streak and counts wins inside an unbeaten run", () => {
    const { state, log } = newSeason("d1");
    rounds(state, log, 1, 7, (f, r) => (involves(f, "c01") ? (r === 4 ? (f.home === "c01" ? [2, 0] : [0, 2]) : [1, 1]) : [0, 0]));
    expect(lens(log, "c01", "draws")).toEqual([3, 3]);
    const last = log.byType("streak.updated").filter((e) => e.payload.clubId === "c01" && e.payload.kind === "unbeaten").at(-1)!;
    expect(last.payload.length).toBe(7);
    expect(last.payload.winsInRun).toBe(1);
  });

  it("tracks loss runs and tags events for the narrative layer", () => {
    const { state, log } = newSeason("d1");
    rounds(state, log, 1, 5, (f) => (f.home === "c02" ? [0, 1] : f.away === "c02" ? [1, 0] : [0, 0]));
    expect(lens(log, "c02", "losses")).toEqual([3, 4, 5]);
    expect(log.byTag("streak:losses:5")).toHaveLength(1);
    expect(log.byTag("milestone:losses:5")).toHaveLength(1);
  });
});

describe("zones, rivalries, achievements", () => {
  it("reports a club moving between zones", () => {
    const { state, log } = newSeason("d1");
    rounds(state, log, 1, 4, () => [1, 1]);
    rounds(state, log, 5, 5, (f) => (f.home === "c12" ? [1, 0] : f.away === "c12" ? [0, 1] : [1, 1]));
    rounds(state, log, 6, 20, (f) => (f.home === "c12" ? [0, 1] : f.away === "c12" ? [1, 0] : [1, 1]));
    const zones = log.byType("milestone.reached").filter((e) => e.payload.kind === "zone" && e.payload.clubId === "c12").map((e) => e.payload.zone);
    expect(zones[0]).toBe("top");
    expect(zones).toContain("relegation");
    expect(zones.every((z, i) => i === 0 || z !== zones[i - 1])).toBe(true);
  });

  it("forms a rivalry once from a red card plus a late goal", () => {
    const { state, log } = newSeason("d1");
    const f = fixturesForRound(state, "d1", 1)[0]!;
    log.append({ type: "match.card", date: f.date, fixtureId: f.id, minute: 60, actors: [f.home], payload: { team: f.home, card: "red", reason: "foul" } });
    log.append({ type: "match.goal", date: f.date, fixtureId: f.id, minute: 90, actors: [f.away], payload: { team: f.away }, tags: ["late-goal"] });
    recordResult(state, log, f.id, 0, 1);
    runDerivers(state, log);
    expect(log.byType("rivalry.formed")).toHaveLength(1);
    const g = fixturesForRound(state, "d1", 12).find((x) => x.home === f.away && x.away === f.home) ?? Object.values(state.fixtures).find((x) => x.home === f.away && x.away === f.home)!;
    log.append({ type: "match.card", date: g.date, fixtureId: g.id, minute: 60, actors: [g.home], payload: { team: g.home, card: "red", reason: "foul" } });
    log.append({ type: "match.goal", date: g.date, fixtureId: g.id, minute: 91, actors: [g.away], payload: { team: g.away }, tags: ["late-goal"] });
    recordResult(state, log, g.id, 0, 1);
    runDerivers(state, log);
    expect(log.byType("rivalry.formed")).toHaveLength(1);
  });

  it("unlocks season achievements for the player's club, once", () => {
    const { state, log } = newSeason("d1", "c01");
    rounds(state, log, 1, 22, (f) => (involves(f, "c01") ? [1, 1] : f.home < f.away ? [1, 0] : [0, 1]));
    const summary = endSeason(state, log, ["c25", "c26", "c27"]);
    const got = deriveAchievements(state, log, summary).map((e) => e.payload.key);
    expect(got).toEqual(expect.arrayContaining(["perfectly-mediocre", "unconquered", "unvictorious"]));
    const pos = summary.tables["d1"]!.findIndex((r) => r.clubId === "c01");
    expect(got.includes("mathematically-safe")).toBe(pos < 9);
    expect(deriveAchievements(state, log, summary)).toEqual([]);
  });
});
