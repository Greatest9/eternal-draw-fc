import { describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { DOOMED, EDFC } from "../src/game/world";

function playSeason(g: Game) {
  let n = 0;
  while (g.nextRound() !== null) { g.playMatchday(); n++; }
  return n;
}

describe("game controller", () => {
  it("starts with two divisions of 12 and the cursed clubs in Division 1", () => {
    const g = Game.create("t1", EDFC);
    expect(g.state.competitions["d1"]!.clubIds).toHaveLength(12);
    expect(g.state.competitions["d2"]!.clubIds).toHaveLength(12);
    expect(g.state.competitions["d1"]!.clubIds).toEqual(expect.arrayContaining([EDFC, DOOMED]));
    expect(g.nextRound()).toBe(1);
    expect(g.roundsTotal()).toBe(22);
    expect(g.nextFixture()).toBeTruthy();
  });

  it("plays a whole season with the curse rules intact and a legend that never plays", () => {
    const g = Game.create("t1", EDFC);
    const t0 = Date.now();
    expect(playSeason(g)).toBe(22);
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(g.seasonComplete()).toBe(true);
    const e = g.record(EDFC)!.row, d = g.record(DOOMED)!.row;
    expect([e.w, e.l, e.d, e.p]).toEqual([0, 0, 20, 20]);
    expect([d.w, d.d, d.l, d.pts]).toEqual([0, 0, 20, 0]);
    expect(g.disruptions()).toBe(2);
    expect(g.lastCalledOff()).toBeTruthy();
    expect(g.news().length).toBeGreaterThan(10);
    expect(g.form(EDFC)).toEqual(["D", "D", "D", "D", "D"]);
  });

  it("closes the season, moves clubs, and starts the next one", () => {
    const g = Game.create("t2", EDFC);
    playSeason(g);
    const s = g.closeSeason()!;
    expect(s.season).toBe(1);
    expect(g.state.season).toBe(2);
    expect(g.state.competitions["d1"]!.clubIds).toHaveLength(12);
    expect(g.state.competitions["d2"]!.clubIds).toHaveLength(12);
    if (!g.state.careerOver) expect(g.nextRound()).toBe(1);
    expect(g.history()).toHaveLength(1);
    expect(g.achievements().length).toBeGreaterThan(0);
  });

  it("ends the career when the player's club drops out of Division 2 (FC Doomed always loses)", () => {
    const g = Game.create("t3", DOOMED);
    let seasons = 0;
    while (!g.state.careerOver && seasons < 4) {
      playSeason(g);
      g.closeSeason();
      seasons++;
    }
    expect(g.state.careerOver).toBe(true);
    expect(seasons).toBeLessThanOrEqual(3);
    expect(g.log.byType("career.ended")).toHaveLength(1);
    expect(g.playMatchday()).toBeNull();
  });

  it("saves and loads without changing history, and keeps going deterministically", () => {
    const a = Game.create("t4", EDFC);
    for (let i = 0; i < 8; i++) a.playMatchday();
    const b = Game.fromJSON(a.toJSON());
    expect(b.log.fullHash()).toBe(a.log.fullHash());
    for (let i = 0; i < 6; i++) { a.playMatchday(); b.playMatchday(); }
    expect(b.log.fullHash()).toBe(a.log.fullHash());
    expect(b.name(a.log.byType("match.goal")[0]!.payload.scorer as string)).toBe(a.name(a.log.byType("match.goal")[0]!.payload.scorer as string));
  });
});
