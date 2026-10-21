import { describe, expect, it } from "vitest";
import { generateFixtures } from "../src/engine/fixtures";
import { buildTable, compareStandings } from "../src/engine/league";
import { endSeason, recordResult, startSeason, voidFixture } from "../src/engine/season";
import { makeWorld, newSeason, playSeason } from "./helpers";

const ids12 = Array.from({ length: 12 }, (_, i) => `c${i + 1}`);

describe("fixtures", () => {
  const fx = generateFixtures("d1", ids12, 1, "2026-08-01", "seed");

  it("has 22 rounds of 6 matches", () => {
    expect(fx).toHaveLength(132);
    for (let r = 1; r <= 22; r++) expect(fx.filter((f) => f.round === r)).toHaveLength(6);
  });

  it("each club plays once per round", () => {
    for (let r = 1; r <= 22; r++) {
      const clubs = fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(clubs).size).toBe(12);
    }
  });

  it("every ordered pair happens exactly once", () => {
    const seen = new Set(fx.map((f) => `${f.home}>${f.away}`));
    expect(seen.size).toBe(132);
    for (const a of ids12) for (const b of ids12) if (a !== b) expect(seen.has(`${a}>${b}`)).toBe(true);
  });

  it("home games are balanced and streaks stay short", () => {
    for (const id of ids12) {
      const venues = fx.filter((f) => f.home === id || f.away === id).sort((a, b) => a.round - b.round).map((f) => f.home === id);
      expect(venues.filter(Boolean)).toHaveLength(11);
      let run = 1, max = 1;
      for (let i = 1; i < venues.length; i++) { run = venues[i] === venues[i - 1] ? run + 1 : 1; max = Math.max(max, run); }
      expect(max).toBeLessThanOrEqual(4);
    }
  });

  it("same inputs give the same fixtures, different season gives a different order", () => {
    expect(generateFixtures("d1", ids12, 1, "2026-08-01", "seed")).toEqual(fx);
    expect(generateFixtures("d1", ids12, 2, "2026-08-01", "seed")).not.toEqual(fx);
  });
});

describe("league table", () => {
  it("keeps all invariants over a full simulated season", () => {
    const { state, log } = newSeason("career-1");
    playSeason(state, log, "career-1");
    for (const comp of Object.values(state.competitions)) {
      const t = buildTable(log.all(), comp.id, 1, comp.clubIds);
      for (const r of t) {
        expect(r.p).toBe(22);
        expect(r.p).toBe(r.w + r.d + r.l);
        expect(r.pts).toBe(3 * r.w + r.d);
        expect(r.gd).toBe(r.gf - r.ga);
      }
      expect(t.reduce((s, r) => s + r.gf, 0)).toBe(t.reduce((s, r) => s + r.ga, 0));
      expect(t.reduce((s, r) => s + r.w, 0)).toBe(t.reduce((s, r) => s + r.l, 0));
      for (let i = 1; i < t.length; i++) expect(compareStandings(t[i - 1]!, t[i]!)).toBeLessThanOrEqual(0);
    }
  });

  it("same seed gives the same sim hash", () => {
    const a = newSeason("career-1"); playSeason(a.state, a.log, "career-1");
    const b = newSeason("career-1"); playSeason(b.state, b.log, "career-1");
    const c = newSeason("career-2"); playSeason(c.state, c.log, "career-2");
    expect(a.log.simHash()).toBe(b.log.simHash());
    expect(a.log.simHash()).not.toBe(c.log.simHash());
  });

  it("voided fixtures give no points and cannot be played afterwards", () => {
    const { state, log } = newSeason("career-1");
    const f = Object.values(state.fixtures).find((x) => x.compId === "d1" && x.round === 1)!;
    voidFixture(state, log, f.id, "postponed", "waterlogged pitch");
    playSeason(state, log, "career-1");
    const t = buildTable(log.all(), "d1", 1, state.competitions["d1"]!.clubIds);
    expect(t.find((r) => r.clubId === f.home)!.p).toBe(21);
    expect(t.find((r) => r.clubId === f.away)!.p).toBe(21);
    expect(() => recordResult(state, log, f.id, 1, 1)).toThrow(/postponed/);
  });
});

describe("season end", () => {
  const incoming = ["c25", "c26", "c27"];

  it("swaps three up and three down and replaces the dropped clubs", () => {
    const { state, log } = newSeason("career-1");
    playSeason(state, log, "career-1");
    const d1 = buildTable(log.all(), "d1", 1, state.competitions["d1"]!.clubIds).map((r) => r.clubId);
    const d2 = buildTable(log.all(), "d2", 1, state.competitions["d2"]!.clubIds).map((r) => r.clubId);
    const s = endSeason(state, log, incoming);
    const n1 = state.competitions["d1"]!.clubIds, n2 = state.competitions["d2"]!.clubIds;
    expect(n1).toHaveLength(12); expect(n2).toHaveLength(12);
    expect(s.relegated.sort()).toEqual(d1.slice(-3).sort());
    expect(s.promoted.sort()).toEqual(d2.slice(0, 3).sort());
    expect(s.dropped.sort()).toEqual(d2.slice(-3).sort());
    d2.slice(0, 3).forEach((id) => expect(n1).toContain(id));
    d1.slice(-3).forEach((id) => expect(n2).toContain(id));
    incoming.forEach((id) => expect(n2).toContain(id));
    d2.slice(-3).forEach((id) => { expect(n1).not.toContain(id); expect(n2).not.toContain(id); });
    expect(state.season).toBe(2);
    expect(state.date).toBe("2027-08-01");
    expect(Object.keys(state.fixtures)).toHaveLength(0);
    expect(log.byType("club.promoted")).toHaveLength(3);
    expect(log.byType("club.relegated")).toHaveLength(3);
    expect(log.byType("club.dropped")).toHaveLength(3);
  });

  it("can run a second season from the new layout", () => {
    const { state, log } = newSeason("career-1");
    playSeason(state, log, "career-1");
    endSeason(state, log, incoming);
    startSeason(state, log, "career-1");
    playSeason(state, log, "career-1");
    const t = buildTable(log.all(), "d1", 2, state.competitions["d1"]!.clubIds);
    t.forEach((r) => expect(r.p).toBe(22));
  });

  it("ends the career when the player's club drops out of the bottom tier", () => {
    const { state, log } = newSeason("career-1", "c24");
    // c24 loses every game, so it finishes bottom of Division 2
    playSeason(state, log, "career-1", (_id, h, a) => (h === "c24" ? [0, 1] : a === "c24" ? [1, 0] : [1, 1]));
    const s = endSeason(state, log, incoming);
    expect(s.dropped).toContain("c24");
    expect(s.careerOver).toBe(true);
    expect(state.careerOver).toBe(true);
    expect(log.byTag("career:ended")).toHaveLength(1);
  });

  it("does not end the career when the player's club is only relegated from tier 1", () => {
    const { state, log } = newSeason("career-1", "c12");
    playSeason(state, log, "career-1", (_id, h, a) => (h === "c12" ? [0, 1] : a === "c12" ? [1, 0] : [1, 1]));
    const s = endSeason(state, log, incoming);
    expect(s.relegated).toContain("c12");
    expect(s.careerOver).toBe(false);
    expect(state.competitions["d2"]!.clubIds).toContain("c12");
  });

  it("rejects bad incoming clubs", () => {
    const { state, log } = newSeason("career-1");
    playSeason(state, log, "career-1");
    expect(() => endSeason(state, log, ["c25"])).toThrow(/exactly 3/);
    expect(() => endSeason(state, log, ["c01", "c26", "c27"])).toThrow(/already in the league/);
    expect(() => endSeason(state, log, ["c25", "c26", "nope"])).toThrow(/Unknown/);
  });
});

void makeWorld;
