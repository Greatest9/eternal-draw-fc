import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/curses/definitions";
import { deriveAchievements, runDerivers } from "../src/derive/derive";
import { buildTable } from "../src/engine/league";
import { playFixture, type PlayContext } from "../src/engine/play";
import { endSeason, fixturesForRound } from "../src/engine/season";
import { COMMENTARY, CUES, FAN, NEWS, SLOTS } from "../src/narrative/templates";
import { fill, ordinal, runNarrative } from "../src/narrative/narrative";
import { makeSide, newSeason } from "./helpers";

const EQ = "c01", FALL = "c02";

function career(seed: string, narrative: boolean) {
  const { state, log } = newSeason(seed, EQ);
  state.clubs[EQ]!.curses = ["equilibrium"];
  state.clubs[FALL]!.curses = ["fall"];
  for (const [id, c] of Object.entries(state.clubs)) c.name = id === EQ ? "Eternal Draw FC" : id === FALL ? "FC Doomed" : `Club ${id.slice(1)}`;
  const sides = new Map<string, ReturnType<typeof makeSide>>();
  const names = new Map<string, string>();
  const sideFor = (id: string) => {
    let s = sides.get(id);
    if (!s) { s = makeSide(id, seed, 45 + (Number(id.slice(1)) % 12) * 3); sides.set(id, s); [...s.lineup, ...s.bench].forEach((p) => names.set(p.id, p.name)); }
    return s;
  };
  const ctx: PlayContext = { state, log, seed, registry: createRegistry(), sideFor };
  const nctx = { state, log, seed, name: (id: string) => state.clubs[id]?.name ?? names.get(id) ?? id, managers: { [EQ]: "Peter Tactical" } };
  for (let r = 1; r <= 22; r++) {
    for (const c of ["d1", "d2"]) for (const f of fixturesForRound(state, c, r)) playFixture(ctx, f.id);
    runDerivers(state, log);
    if (narrative) runNarrative(nctx);
  }
  const summary = endSeason(state, log, ["c25", "c26", "c27"]);
  deriveAchievements(state, log, summary);
  if (narrative) runNarrative(nctx);
  return { state, log };
}

const slotsIn = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

describe("templates", () => {
  it("only use known slots", () => {
    const texts: string[] = [];
    for (const list of Object.values(NEWS)) list.forEach((t) => texts.push(t.h, t.d));
    for (const m of Object.values(FAN)) for (const l of Object.values(m)) texts.push(...l);
    texts.push(...COMMENTARY.kickoff, ...COMMENTARY.goal, ...COMMENTARY.goalAssist, ...COMMENTARY.yellow, ...COMMENTARY.red, ...COMMENTARY.secondYellow, ...COMMENTARY.fulltime, ...Object.values(COMMENTARY.hint));
    for (const m of Object.values(CUES.bench)) for (const l of Object.values(m)) texts.push(...l);
    texts.push(...CUES.crowdLate, ...CUES.crowdAgainst, ...CUES.refRed, ...CUES.refVar, ...CUES.replayGoal, ...CUES.replayOdd);
    for (const t of texts) for (const s of slotsIn(t)) expect(SLOTS.has(s), `${s} in "${t}"`).toBe(true);
  });

  it("fill refuses missing or unknown slots", () => {
    expect(fill("{club} win", { club: "X" })).toBe("X win");
    expect(() => fill("{club} win", {})).toThrow(/Missing/);
    expect(() => fill("{nope}", { nope: 1 })).toThrow(/Unknown/);
  });

  it("ordinals", () => expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]));
});

describe("narrative layer", () => {
  const a = career("n1", true);
  const bare = career("n1", false);
  const nar = a.log.all().filter((e) => ["news.published", "fan.post", "commentary.line", "cutaway.cue"].includes(e.type));
  const ids = new Set(a.log.all().map((e) => e.id));

  it("never changes the simulation", () => {
    expect(a.log.simHash()).toBe(bare.log.simHash());
    expect(nar.length).toBeGreaterThan(100);
  });

  it("is deterministic", () => {
    expect(career("n1", true).log.fullHash()).toBe(a.log.fullHash());
    expect(career("n2", true).log.fullHash()).not.toBe(a.log.fullHash());
  });

  it("every narrative event points at a real source event", () => {
    for (const e of nar) {
      if (e.type === "news.published") (e.payload.sourceEvents as string[]).forEach((id) => expect(ids.has(id)).toBe(true));
      expect(e.causedBy && ids.has(e.causedBy)).toBe(true);
    }
  });

  it("goal commentary carries the real running score, and stays in minute order", () => {
    const goals = nar.filter((e) => e.type === "commentary.line" && e.payload.kind === "goal");
    expect(goals.length).toBeGreaterThan(20);
    for (const c of goals) {
      const g = a.log.all().find((e) => e.id === c.causedBy)!;
      const [h, aw] = g.payload.score as [number, number];
      expect(c.payload.text as string).toContain(`${h}-${aw}`);
    }
    const byFx = new Map<string, number[]>();
    for (const c of nar.filter((e) => e.type === "commentary.line")) byFx.set(c.fixtureId!, [...(byFx.get(c.fixtureId!) ?? []), c.minute ?? 0]);
    for (const mins of byFx.values()) expect(mins).toEqual([...mins].sort((x, y) => x - y));
  });

  it("only makes record claims that match the table at that moment", () => {
    const claimed = nar.flatMap((e) => ((e.payload.claims as any[]) ?? []).map((c) => ({ e, c })));
    expect(claimed.length).toBeGreaterThan(20);
    for (const { c } of claimed) {
      if (c.seq === undefined) continue;
      const evs = a.log.all().filter((x) => x.type === "match.fulltime" && x.seq <= c.seq && (x.payload as any).compId === c.compId && (x.payload as any).season === c.season);
      const ids2 = new Set<string>(); evs.forEach((x) => { ids2.add((x.payload as any).home); ids2.add((x.payload as any).away); });
      const row = buildTable(evs, c.compId, c.season, [...ids2]).find((r) => r.clubId === c.clubId)!;
      if (c.seq && evs.length) expect([row.w, row.d, row.l, row.p]).toEqual([c.w, c.d, c.l, c.p]);
    }
    for (const e of nar.filter((x) => x.type === "fan.post" && x.payload.trigger === "banter")) {
      const c = (e.payload.claims as any[])[0];
      if ((e.payload.text as string).includes("Unbeaten, though")) expect(c.l).toBe(0);
      if ((e.payload.text as string).startsWith("You have won 0 matches")) expect(c.w).toBe(0);
    }
  });

  it("limits news per run and cools down repeated stories", () => {
    const news = nar.filter((e) => e.type === "news.published");
    expect(news.length).toBeGreaterThan(10);
    expect(news.length).toBeLessThanOrEqual(3 * 23);
    const eqDraws = news.filter((e) => e.payload.key === `streak-draws:${EQ}`);
    expect(eqDraws.length).toBeLessThanOrEqual(6);
    news.forEach((e) => { expect((e.payload.headline as string).length).toBeGreaterThan(5); expect(e.payload.outlet).toBe("The Daily Deadlock"); });
  });

  it("gives the player's club bench, crowd and replay cutaways on the right events", () => {
    const mineFx = new Set(a.log.byType("match.fulltime").filter((e) => e.actors.includes(EQ)).map((e) => e.fixtureId));
    const cuesBy = (id: string, target: string) => nar.some((c) => c.type === "cutaway.cue" && c.causedBy === id && c.payload.target === target);
    let goals = 0, odd = 0;
    for (const e of a.log.all()) {
      if (!e.fixtureId || !mineFx.has(e.fixtureId)) continue;
      if (e.type === "match.goal") { goals++; expect(cuesBy(e.id, "bench")).toBe(true); expect(cuesBy(e.id, "replay")).toBe(true); }
      if (e.type === "match.rewrite") { odd++; expect(cuesBy(e.id, "replay")).toBe(true); }
    }
    expect(goals).toBeGreaterThan(10);
    expect(odd).toBeGreaterThan(0);
  });

  it("bench reactions match what the goal did to the score", () => {
    const home = (fx: string) => (a.log.all().find((e) => e.fixtureId === fx && e.type === "match.fulltime")!.payload as any).home;
    let checked = 0;
    for (const cue of nar.filter((e) => e.type === "cutaway.cue" && e.payload.target === "bench")) {
      const g = a.log.all().find((e) => e.id === cue.causedBy)!;
      const [sh, sa] = g.payload.score as [number, number];
      const mine = home(g.fixtureId!) === EQ ? sh : sa, theirs = home(g.fixtureId!) === EQ ? sa : sh;
      const line = cue.payload.line as string;
      if (g.payload.team === EQ && mine > theirs) expect(line).not.toMatch(/level out|Level again/);
      if (g.payload.team === EQ && mine === theirs) expect(line).toMatch(/level out|Level again/);
      if (g.payload.team !== EQ && mine === theirs) expect(line).not.toMatch(/Plenty of time left/);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("writes the called-off story and the season review without leaking the secret", () => {
    const news = nar.filter((e) => e.type === "news.published");
    const off = news.filter((e) => e.payload.kind === "called-off");
    expect(off.length).toBeGreaterThan(0);
    expect(off[0]!.payload.dek as string).toContain("1996");
    const review = news.find((e) => e.payload.kind === "season-review")!;
    expect(review).toBeTruthy();
    const table = a.log.byType("table.updated").find((e) => (e.payload as any).table.some((r: any) => r.clubId === EQ))!;
    const row = (table.payload as any).table.find((r: any) => r.clubId === EQ);
    expect(row.l).toBe(0);
    expect(review.payload.dek as string).toContain(`${row.pts} points`);
    const text = news.map((e) => `${e.payload.headline} ${e.payload.dek}`).join(" ").toLowerCase();
    expect(text).not.toMatch(/unlock|curse is broken|break the curse|if they play/);
  });

  it("covers every kind of narrative event", () => {
    const types = new Set(nar.map((e) => e.type));
    ["news.published", "fan.post", "commentary.line", "cutaway.cue"].forEach((t) => expect(types.has(t as any)).toBe(true));
  });
});
