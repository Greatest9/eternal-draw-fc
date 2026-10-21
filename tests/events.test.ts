import { describe, expect, it } from "vitest";
import { EventLog } from "../src/events/store";

function sampleLog(): EventLog {
  const log = new EventLog();
  const k = log.append({ type: "match.kickoff", date: "2026-08-08", fixtureId: "fx1" });
  log.append({ type: "match.goal", date: "2026-08-08", fixtureId: "fx1", minute: 23, actors: ["dunmore", "p9"], tags: ["late-goal"], causedBy: k.id });
  log.append({ type: "match.fulltime", date: "2026-08-08", fixtureId: "fx1", payload: { score: [1, 1] }, tags: ["streak:draws:15"] });
  return log;
}

describe("event log", () => {
  it("assigns ids and sequence numbers in order", () => {
    const log = sampleLog();
    expect(log.all().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.all().map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("queries by type, tag and fixture", () => {
    const log = sampleLog();
    expect(log.byType("match.goal")).toHaveLength(1);
    expect(log.byTag("streak:draws:15")).toHaveLength(1);
    expect(log.byFixture("fx1")).toHaveLength(3);
  });

  it("same events give the same hash", () => {
    expect(sampleLog().simHash()).toBe(sampleLog().simHash());
  });

  it("a changed sim event changes the hash", () => {
    const a = sampleLog();
    const b = sampleLog();
    b.append({ type: "match.card", date: "2026-08-08", fixtureId: "fx1", minute: 55 });
    expect(a.simHash()).not.toBe(b.simHash());
  });

  it("narrative events never change the sim hash", () => {
    const a = sampleLog();
    const b = sampleLog();
    b.append({ type: "news.published", date: "2026-08-09", payload: { headline: "UNBEATEN, RELEGATED" } });
    b.append({ type: "fan.post", date: "2026-08-09", payload: { text: "Unbeaten, though." } });
    expect(b.length).toBe(a.length + 2);
    expect(b.simHash()).toBe(a.simHash());
  });

  it("key order in payloads does not change the hash", () => {
    const a = new EventLog();
    const b = new EventLog();
    a.append({ type: "table.updated", date: "d", payload: { x: 1, y: 2 } });
    b.append({ type: "table.updated", date: "d", payload: { y: 2, x: 1 } });
    expect(a.simHash()).toBe(b.simHash());
  });
});
