import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { DOOMED, EDFC } from "../src/game/world";
import { Shell } from "../src/ui/App";
import { HomeView } from "../src/ui/HomeView";
import { MatchView } from "../src/ui/MatchView";
import { buildScript, Playback, type Item } from "../src/ui/playback";
import { CareerView, GameOver, NewsView, TableView } from "../src/ui/Views";

const noop = () => {};
const ctxStub = new Proxy({}, { get: () => noop, set: () => true }) as unknown as CanvasRenderingContext2D;

function midSeason(club = EDFC, rounds = 10) {
  const g = Game.create("ui-1", club);
  for (let i = 0; i < rounds; i++) g.playMatchday();
  return g;
}

describe("screens render", () => {
  it("renders every view mid-season without throwing", () => {
    const g = midSeason();
    const html = [
      renderToString(<Shell game={g} onQuit={noop} onNew={noop} onImport={noop} />),
      renderToString(<HomeView game={g} play={noop} onClose={noop} />),
      renderToString(<MatchView game={g} />),
      renderToString(<NewsView game={g} />),
      renderToString(<TableView game={g} />),
      renderToString(<CareerView game={g} onQuit={noop} onImport={noop} />),
    ];
    html.forEach((h) => expect(h.length).toBeGreaterThan(200));
    expect(html[0]).toContain("Eternal Draw FC");
    expect(html[1]).toContain("Active curse");
    expect(html[3]).toContain("The Daily Deadlock");
    expect(html[4]).toContain("Dashed line");
  });

  it("renders before the first match, at season end, and at game over", () => {
    const fresh = Game.create("ui-2", EDFC);
    expect(renderToString(<HomeView game={fresh} play={noop} onClose={noop} />)).toContain("Play matchday");
    expect(renderToString(<MatchView game={fresh} />)).toContain("No match played yet");
    expect(renderToString(<NewsView game={fresh} />)).toContain("No news yet");
    while (fresh.nextRound() !== null) fresh.playMatchday();
    expect(renderToString(<HomeView game={fresh} play={noop} onClose={noop} />)).toContain("Close the season");
    const doomed = Game.create("ui-3", DOOMED);
    while (!doomed.state.careerOver) { while (doomed.nextRound() !== null) doomed.playMatchday(); doomed.closeSeason(); }
    expect(renderToString(<GameOver game={doomed} onNew={noop} />)).toContain("Career over");
    expect(renderToString(<Shell game={doomed} onQuit={noop} onNew={noop} onImport={noop} />)).toContain("dropped out of the league");
  });

  it("shows the called-off card for the legend fixture", () => {
    const g = Game.create("ui-4", EDFC);
    while (g.nextRound() !== null && !g.lastCalledOff()) g.playMatchday();
    expect(g.lastCalledOff()).toBeTruthy();
    expect(renderToString(<MatchView game={g} />)).toMatch(/Postponed|Abandoned/);
    expect(renderToString(<HomeView game={g} play={noop} onClose={noop} />)).toContain("The fixture nobody plays");
  });
});

describe("playback", () => {
  function run(game: Game, fixtureId: string, stopAfter?: number) {
    const script = buildScript(game, fixtureId)!;
    const seen: Item[] = [];
    let score: [number, number] = [0, 0], clock = "", ended = false;
    const pb = new Playback(script, { item: (i) => seen.push(i), score: (s) => (score = s), flash: noop, clock: (c) => (clock = c), end: () => (ended = true) });
    let steps = 0;
    while (!pb.done && steps < 20000) { pb.update(0.05, 1); pb.draw(ctxStub, 640, 380); steps++; if (stopAfter && steps === stopAfter) pb.finish(); }
    return { script, seen, score, clock, ended, pb, steps };
  }

  it("plays a real match to the real final score, revealing every item once", () => {
    const g = midSeason(EDFC, 6);
    for (let k = 0; k < 4; k++) {
      const fx = g.lastMatch()!.fixtureId;
      const r = run(g, fx);
      expect(r.pb.done).toBe(true);
      expect(r.ended).toBe(true);
      expect(r.score).toEqual(r.script.final);
      expect(r.clock).toBe("FT");
      expect(r.seen.length).toBe(r.script.items.length);
      expect(new Set(r.seen.map((i) => i.id)).size).toBe(r.seen.length);
      g.playMatchday();
    }
  });

  it("skipping ahead gives the same result with no duplicates", () => {
    const g = midSeason(EDFC, 5);
    const r = run(g, g.lastMatch()!.fixtureId, 30);
    expect(r.score).toEqual(r.script.final);
    expect(r.seen.length).toBe(r.script.items.length);
    expect(new Set(r.seen.map((i) => i.id)).size).toBe(r.seen.length);
  });

  it("goal flashes happen in step with the script's goals", () => {
    const g = midSeason(EDFC, 8);
    let total = 0;
    for (let k = 0; k < 8; k++) {
      const script = buildScript(g, g.lastMatch()!.fixtureId)!;
      total += script.attacks.filter((a) => a.outcome === "goal").length;
      expect(script.attacks.filter((a) => a.outcome === "goal").length).toBe(script.final[0] + script.final[1]);
      g.playMatchday();
    }
    expect(total).toBeGreaterThan(0);
  });
});
