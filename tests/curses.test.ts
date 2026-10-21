import { describe, expect, it } from "vitest";
import { createRegistry, unlockLegend, LEGEND_DISRUPTIONS } from "../src/curses/definitions";
import { chooseTarget, collectConstraints, resolveOutcome, resultOf } from "../src/curses/resolve";
import { rewriteToResult } from "../src/curses/rewrite";
import { CurseRegistry } from "../src/curses/types";
import { buildTable } from "../src/engine/league";
import { generateTimeline, timelineScore, validateTimeline } from "../src/engine/match";
import { playFixture, type PlayContext } from "../src/engine/play";
import { stream } from "../src/engine/rng";
import { fixturesForRound } from "../src/engine/season";
import { newSeason, makeInput, makeSide } from "./helpers";

const EQ = "c01", FALL = "c02";

function world(seed: string, opts: { legend?: boolean; policy?: "priority" | "strength" | "cancel"; quality?: (id: string) => number } = {}) {
  const { state, log } = newSeason(seed);
  state.clubs[EQ]!.curses = ["equilibrium"];
  state.clubs[FALL]!.curses = ["fall"];
  if (opts.policy) state.settings.paradoxPolicy = opts.policy;
  const sides = new Map<string, ReturnType<typeof makeSide>>();
  const q = opts.quality ?? ((id: string) => 45 + (Number(id.slice(1)) % 12) * 3);
  const ctx: PlayContext = {
    state, log, seed,
    registry: createRegistry({ legend: opts.legend }),
    sideFor: (id) => sides.get(id) ?? (sides.set(id, makeSide(id, seed, q(id))), sides.get(id)!),
  };
  return ctx;
}

describe("resolver", () => {
  const reg = createRegistry();
  const mk = (homeCurse: string | null, awayCurse: string | null) => {
    const { state } = newSeason("r");
    state.clubs["c01"]!.curses = homeCurse ? [homeCurse] : [];
    state.clubs["c02"]!.curses = awayCurse ? [awayCurse] : [];
    return collectConstraints(makeInput("f", makeSide("c01", "r"), makeSide("c02", "r")), state, reg);
  };

  it("translates each curse to the home point of view", () => {
    expect(mk("equilibrium", null)[0]!.allowedHome).toEqual(["D"]);
    expect(mk("fall", null)[0]!.allowedHome).toEqual(["L"]);
    expect(mk(null, "fall")[0]!.allowedHome).toEqual(["W"]);
    expect(mk(null, "equilibrium")[0]!.allowedHome).toEqual(["D"]);
  });

  it("no constraint means anything goes", () => {
    expect(resolveOutcome(mk(null, null), "priority", reg).allowedHome).toEqual(["W", "D", "L"]);
  });

  it("detects the paradox and applies each policy", () => {
    const c = mk("equilibrium", "fall");
    const p = resolveOutcome(c, "priority", reg);
    expect(p.conflict).toBe(true);
    expect(p.allowedHome).toEqual(["D"]);
    expect(p.applied).toEqual(["equilibrium"]);
    expect(p.overridden).toEqual(["fall"]);
    expect(resolveOutcome(c, "strength", reg).allowedHome).toEqual(["D"]);
    const x = resolveOutcome(c, "cancel", reg);
    expect(x.allowedHome).toEqual(["W", "D", "L"]);
    expect(x.overridden.sort()).toEqual(["equilibrium", "fall"]);
  });

  it("a tie between conflicting curses becomes a stalemate and cancels both", () => {
    const tied = new CurseRegistry()
      .register({ id: "a", name: "a", category: "outcome", priority: 5, strength: 5, outcome: ["D"] })
      .register({ id: "b", name: "b", category: "outcome", priority: 5, strength: 5, outcome: ["L"] });
    const { state } = newSeason("r");
    state.clubs["c01"]!.curses = ["a"]; state.clubs["c02"]!.curses = ["b"];
    const r = resolveOutcome(collectConstraints(makeInput("f", makeSide("c01", "r"), makeSide("c02", "r")), state, tied), "priority", tied);
    expect(r.stalemate).toBe(true);
    expect(r.allowedHome).toEqual(["W", "D", "L"]);
  });

  it("picks the closest allowed result", () => {
    expect(chooseTarget("W", ["D"])).toBe("D");
    expect(chooseTarget("L", ["D"])).toBe("D");
    expect(chooseTarget("W", ["D", "L"])).toBe("D");
    expect(chooseTarget("D", ["L"])).toBe("L");
    expect(chooseTarget("W", ["W", "D"])).toBe("W");
  });
});

describe("rewrite", () => {
  it("reaches every target from many natural matches, stays valid, and leaves hints", () => {
    for (const target of ["W", "D", "L"] as const) {
      let edited = 0;
      for (let i = 0; i < 250; i++) {
        const input = makeInput(`fx${i}`, makeSide("h", `s${i}`, 40 + (i % 40)), makeSide("a", `s${i}`, 80 - (i % 40)));
        const natural = generateTimeline(input, stream("n", i));
        const [h, a] = timelineScore(natural);
        const { drafts, changes } = rewriteToResult(input, natural, target, "test", stream("rw", i));
        expect(validateTimeline(input, drafts)).toEqual([]);
        const [fh, fa] = timelineScore(drafts);
        expect(resultOf(fh, fa)).toBe(target);
        if (resultOf(h, a) !== target) {
          edited++;
          expect(changes.length).toBeGreaterThan(0);
          expect(drafts.filter((d) => d.type === "match.rewrite").length).toBeGreaterThanOrEqual(changes.length);
        } else expect(changes).toHaveLength(0);
      }
      expect(edited).toBeGreaterThan(0);
    }
  });
});

describe("curses in play", () => {
  it("the club that always draws never wins or loses, home or away, against any opposition", () => {
    const ctx = world("eq", { legend: false });
    const f = Object.values(ctx.state.fixtures).filter((x) => x.compId === "d1" && (x.home === EQ || x.away === EQ) && x.home !== FALL && x.away !== FALL);
    expect(f.length).toBeGreaterThan(15);
    let rewrites = 0;
    for (const fx of f) {
      const out = playFixture(ctx, fx.id);
      expect(out.status).toBe("played");
      if (out.status === "played") { expect(out.hg).toBe(out.ag); rewrites += out.changes.length > 0 ? 1 : 0; }
    }
    expect(rewrites).toBeGreaterThan(0);
    const t = buildTable(ctx.log.all(), "d1", 1, ctx.state.competitions["d1"]!.clubIds).find((r) => r.clubId === EQ)!;
    expect([t.w, t.l]).toEqual([0, 0]);
    expect(t.pts).toBe(t.p);
  });

  it("the club that always loses loses even when it is far stronger", () => {
    const ctx = world("fall", { legend: false, quality: (id) => (id === FALL ? 90 : 30) });
    const f = Object.values(ctx.state.fixtures).filter((x) => x.compId === "d1" && (x.home === FALL || x.away === FALL) && x.home !== EQ && x.away !== EQ);
    for (const fx of f) {
      const out = playFixture(ctx, fx.id);
      if (out.status !== "played") throw new Error("should play");
      const doomedGoals = fx.home === FALL ? out.hg : out.ag, other = fx.home === FALL ? out.ag : out.hg;
      expect(doomedGoals).toBeLessThan(other);
    }
    const t = buildTable(ctx.log.all(), "d1", 1, ctx.state.competitions["d1"]!.clubIds).find((r) => r.clubId === FALL)!;
    expect([t.w, t.d, t.pts]).toEqual([0, 0, 0]);
  });

  it("the Doomed fixture is always called off, both legs, and logs the legend", () => {
    const ctx = world("legend");
    const pair = Object.values(ctx.state.fixtures).filter((x) => (x.home === EQ && x.away === FALL) || (x.home === FALL && x.away === EQ));
    expect(pair).toHaveLength(2);
    for (const fx of pair) {
      const out = playFixture(ctx, fx.id);
      expect(["postponed", "abandoned"]).toContain(out.status);
      expect(ctx.state.fixtures[fx.id]!.status).not.toBe("played");
    }
    expect(ctx.state.flags[LEGEND_DISRUPTIONS]).toBe(2);
    expect(ctx.log.byTag("legend:doomed-fixture").length).toBeGreaterThanOrEqual(4);
    expect(ctx.log.byType("curse.legend.progress")).toHaveLength(2);
  });

  it("paradox policies decide a match when the gate is not there", () => {
    for (const [policy, check] of [
      ["priority", (h: number, a: number) => expect(h).toBe(a)],
      ["strength", (h: number, a: number) => expect(h).toBe(a)],
    ] as const) {
      const ctx = world("para-" + policy, { legend: false, policy });
      const fx = Object.values(ctx.state.fixtures).find((x) => x.home === EQ && x.away === FALL)!;
      const out = playFixture(ctx, fx.id);
      if (out.status !== "played") throw new Error("should play");
      check(out.hg, out.ag);
      expect(ctx.log.byType("curse.conflict")).toHaveLength(1);
      expect(ctx.log.byType("curse.resolved")[0]!.payload).toMatchObject({ policy, applied: ["equilibrium"], overridden: ["fall"] });
    }
    const ctx = world("para-cancel", { legend: false, policy: "cancel" });
    const fx = Object.values(ctx.state.fixtures).find((x) => x.home === EQ && x.away === FALL)!;
    const out = playFixture(ctx, fx.id);
    if (out.status !== "played") throw new Error("should play");
    expect([out.hg, out.ag]).toEqual(out.natural);
    expect(out.changes).toHaveLength(0);
  });

  it("once the legend is unlocked the match happens and both curses are gone", () => {
    const ctx = world("unlock");
    unlockLegend(ctx.state);
    const fx = Object.values(ctx.state.fixtures).find((x) => x.home === EQ && x.away === FALL)!;
    const out = playFixture(ctx, fx.id);
    expect(out.status).toBe("played");
    if (out.status === "played") { expect(out.resolution.policy).toBe("legend"); expect([out.hg, out.ag]).toEqual(out.natural); }
    expect(ctx.state.clubs[EQ]!.curses).toEqual([]);
    expect(ctx.state.clubs[FALL]!.curses).toEqual([]);
    expect(ctx.log.byTag("legend:broken")).toHaveLength(1);
  });

  function fullSeason(seed: string) {
    const ctx = world(seed);
    for (let r = 1; r <= 22; r++) for (const c of ["d1", "d2"]) for (const f of fixturesForRound(ctx.state, c, r)) playFixture(ctx, f.id);
    return ctx;
  }

  it("a full season keeps every curse rule and the table invariants", () => {
    const ctx = fullSeason("season-1");
    const t = buildTable(ctx.log.all(), "d1", 1, ctx.state.competitions["d1"]!.clubIds);
    const eq = t.find((r) => r.clubId === EQ)!, fall = t.find((r) => r.clubId === FALL)!;
    expect([eq.p, eq.w, eq.d, eq.l, eq.pts]).toEqual([20, 0, 20, 0, 20]);
    expect([fall.p, fall.w, fall.d, fall.l, fall.pts]).toEqual([20, 0, 0, 20, 0]);
    t.forEach((r) => { expect(r.pts).toBe(3 * r.w + r.d); expect(r.gd).toBe(r.gf - r.ga); });
    expect(t.reduce((s, r) => s + r.gf, 0)).toBe(t.reduce((s, r) => s + r.ga, 0));
    const hints = ctx.log.byTag("unnatural").length;
    expect(hints).toBeGreaterThan(0);
  });

  it("is deterministic across a whole cursed season", () => {
    expect(fullSeason("season-1").log.simHash()).toBe(fullSeason("season-1").log.simHash());
  });
});
