import { describe, expect, it } from "vitest";
import { parseFormation, pickLineup } from "../src/engine/lineup";
import { commitMatch, finalizeTimeline, generateTimeline, timelineScore, validateTimeline } from "../src/engine/match";
import { buildTable, type Standing } from "../src/engine/league";
import { stream } from "../src/engine/rng";
import { fixturesForRound } from "../src/engine/season";
import { makeInput, makeSide, makeSquad, newSeason } from "./helpers";

const FORMATIONS = ["4-4-2", "4-5-1", "3-5-2", "4-3-3", "4-2-3-1", "5-3-2", "3-4-3"];

describe("lineup", () => {
  it("parses formations", () => {
    expect(parseFormation("4-2-3-1")).toEqual({ df: 4, mf: 5, fw: 1 });
    expect(() => parseFormation("4-4-3")).toThrow();
  });

  it("picks 11 unique players with one keeper for every formation", () => {
    for (const f of FORMATIONS) {
      const { lineup, bench } = pickLineup(f, makeSquad("x", "s"));
      expect(lineup).toHaveLength(11);
      expect(new Set(lineup.map((p) => p.id)).size).toBe(11);
      expect(lineup.filter((p) => p.pos === "GK")).toHaveLength(1);
      expect(bench.length).toBe(8);
    }
  });
});

describe("timeline generation", () => {
  it("passes validation for 600 random matches across formations and strengths", () => {
    for (let i = 0; i < 600; i++) {
      const r = stream("fuzz", i);
      const home = makeSide("h", `s${i}`, r.int(35, 85), r.pick(FORMATIONS));
      const away = makeSide("a", `s${i}`, r.int(35, 85), r.pick(FORMATIONS));
      const input = makeInput(`fx${i}`, home, away);
      const t = generateTimeline(input, stream("m", i));
      expect(validateTimeline(input, t)).toEqual([]);
    }
  });

  it("is deterministic for the same stream and differs for another", () => {
    const input = makeInput("fx1", makeSide("h", "s"), makeSide("a", "s"));
    const a = generateTimeline(input, stream("m", "fx1"));
    expect(generateTimeline(input, stream("m", "fx1"))).toEqual(a);
    expect(generateTimeline(input, stream("m", "fx2"))).not.toEqual(a);
  });

  it("equal teams give realistic scorelines with a home edge", () => {
    let goals = 0, draws = 0, hw = 0, aw = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const input = makeInput(`fx${i}`, makeSide("h", `s${i}`), makeSide("a", `s${i}`));
      const [h, a] = timelineScore(generateTimeline(input, stream("cal", i)));
      goals += h + a;
      if (h === a) draws++; else if (h > a) hw++; else aw++;
    }
    expect(goals / n).toBeGreaterThan(2.3);
    expect(goals / n).toBeLessThan(3.1);
    expect(draws / n).toBeGreaterThan(0.2);
    expect(draws / n).toBeLessThan(0.33);
    expect(hw).toBeGreaterThan(aw);
  });

  it("a stronger team wins more often", () => {
    let strong = 0, weak = 0;
    for (let i = 0; i < 1000; i++) {
      const input = makeInput(`fx${i}`, makeSide("h", `s${i}`, 75), makeSide("a", `s${i}`, 50));
      const [h, a] = timelineScore(generateTimeline(input, stream("str", i)));
      if (h > a) strong++; else if (a > h) weak++;
    }
    expect(strong / 1000).toBeGreaterThan(0.55);
    expect(strong).toBeGreaterThan(weak * 3);
  });

  it("produces cards, subs and saves over many matches", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const input = makeInput(`fx${i}`, makeSide("h", `s${i}`), makeSide("a", `s${i}`));
      generateTimeline(input, stream("kinds", i)).forEach((e) => seen.add(e.type + (e.payload?.card ? `:${e.payload.card}` : "")));
    }
    for (const k of ["match.goal", "match.save", "match.sub", "match.foul", "match.card:yellow", "match.card:red"]) expect(seen.has(k)).toBe(true);
  });
});

describe("validator", () => {
  const input = makeInput("fx1", makeSide("h", "s"), makeSide("a", "s"));
  const good = generateTimeline(input, stream("m", "v"));
  const clone = () => good.map((e) => ({ ...e, payload: { ...e.payload } }));

  it("accepts the generated timeline", () => expect(validateTimeline(input, good)).toEqual([]));

  it("catches a wrong fulltime score", () => {
    const t = clone();
    const ft = t[t.length - 1]!;
    ft.payload.hg = (ft.payload.hg as number) + 1;
    expect(validateTimeline(input, t).join()).toMatch(/does not match the goal events/);
  });

  it("catches a goal removed without fixing the score", () => {
    const t = clone();
    const i = t.findIndex((e) => e.type === "match.goal");
    if (i < 0) throw new Error("fixture seed produced no goal; pick another seed");
    t.splice(i, 1);
    expect(validateTimeline(input, t).length).toBeGreaterThan(0);
  });

  it("catches a player who is not on the pitch", () => {
    const t = clone();
    const i = t.findIndex((e) => e.type === "match.foul");
    t[i]!.payload.player = "ghost";
    expect(validateTimeline(input, t).join()).toMatch(/not on the pitch/);
  });

  it("catches events out of order", () => {
    const t = clone();
    const i = t.findIndex((e) => (e.minute ?? 0) > 10 && e.type === "match.foul");
    t[i]!.minute = 1;
    expect(validateTimeline(input, t).join()).toMatch(/out of time order/);
  });

  it("finalizeTimeline repairs score and stats after an edit", () => {
    const t = clone().filter((e) => e.type !== "match.goal" && !(e.type === "match.shot" && e.payload.outcome === "goal"));
    const tidy = t.filter((e) => e.type !== "match.attack" || t.some((s) => s.causedByKey === e.key));
    expect(validateTimeline(input, finalizeTimeline(input, tidy))).toEqual([]);
  });
});

describe("commit and full seasons", () => {
  it("writes events, resolves causedBy ids, and marks the fixture played", () => {
    const { state, log } = newSeason("career-1");
    const f = fixturesForRound(state, "d1", 1)[0]!;
    const input = makeInput(f.id, makeSide(f.home, "w"), makeSide(f.away, "w"));
    const drafts = generateTimeline(input, stream("career-1", "match", f.id));
    const events = commitMatch(state, log, input, drafts);
    expect(state.fixtures[f.id]!.status).toBe("played");
    expect(events.length).toBe(drafts.length);
    const ids = new Set(log.all().map((e) => e.id));
    events.filter((e) => e.causedBy).forEach((e) => expect(ids.has(e.causedBy!)).toBe(true));
    expect(log.byType("match.goal").length).toBe(timelineScore(drafts)[0] + timelineScore(drafts)[1]);
    expect(() => commitMatch(state, log, input, drafts)).toThrow(/already played/);
  });

  it("rejects an invalid timeline without writing anything", () => {
    const { state, log } = newSeason("career-1");
    const f = fixturesForRound(state, "d1", 1)[0]!;
    const input = makeInput(f.id, makeSide(f.home, "w"), makeSide(f.away, "w"));
    const bad = generateTimeline(input, stream("x", 1));
    bad[bad.length - 1]!.payload!.hg = 99;
    expect(() => commitMatch(state, log, input, bad)).toThrow(/Invalid timeline/);
    expect(log.length).toBe(1); // only season.started
    expect(state.fixtures[f.id]!.status).toBe("scheduled");
  });

  function season(seed: string) {
    const { state, log } = newSeason(seed);
    const sides = new Map<string, ReturnType<typeof makeSide>>();
    const side = (id: string) => sides.get(id) ?? (sides.set(id, makeSide(id, seed, 45 + (Number(id.slice(1)) % 12) * 3)), sides.get(id)!);
    for (let r = 1; r <= 22; r++) {
      for (const compId of ["d1", "d2"]) {
        for (const f of fixturesForRound(state, compId, r)) {
          const input = makeInput(f.id, side(f.home), side(f.away), compId);
          commitMatch(state, log, input, generateTimeline(input, stream(seed, "match", f.id)));
        }
      }
    }
    return { state, log };
  }

  it("plays two full divisions; table matches goal events and invariants hold", () => {
    const { state, log } = season("career-1");
    for (const comp of ["d1", "d2"]) {
      const t: Standing[] = buildTable(log.all(), comp, 1, state.competitions[comp]!.clubIds);
      t.forEach((r) => { expect(r.p).toBe(22); expect(r.pts).toBe(3 * r.w + r.d); expect(r.gd).toBe(r.gf - r.ga); });
      const goalEvents = log.byType("match.goal").filter((e) => e.fixtureId!.startsWith(comp + "-")).length;
      expect(t.reduce((s, r) => s + r.gf, 0)).toBe(goalEvents);
    }
  });

  it("is deterministic for a whole season", () => {
    expect(season("career-1").log.simHash()).toBe(season("career-1").log.simHash());
    expect(season("career-1").log.simHash()).not.toBe(season("career-2").log.simHash());
  });
});
