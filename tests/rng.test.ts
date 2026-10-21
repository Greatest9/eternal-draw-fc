import { describe, expect, it } from "vitest";
import { stream } from "../src/engine/rng";

const seq = (s: ReturnType<typeof stream>, n = 8) => Array.from({ length: n }, () => s.next());

describe("rng streams", () => {
  it("same seed and keys give the same sequence", () => {
    expect(seq(stream("career-1", "match", "fx1"))).toEqual(seq(stream("career-1", "match", "fx1")));
  });

  it("different keys or seeds give different sequences", () => {
    const base = seq(stream("career-1", "match", "fx1"));
    expect(seq(stream("career-1", "match", "fx2"))).not.toEqual(base);
    expect(seq(stream("career-2", "match", "fx1"))).not.toEqual(base);
  });

  it("using another stream does not shift a match stream", () => {
    const a = seq(stream("career-1", "match", "fx1"));
    const match = stream("career-1", "match", "fx1");
    const media = stream("career-1", "media", "e42");
    const b: number[] = [];
    for (let i = 0; i < 8; i++) {
      media.next(); media.next(); // cosmetic rolls interleaved
      b.push(match.next());
    }
    expect(b).toEqual(a);
  });

  it("int stays inside bounds and hits both ends", () => {
    const r = stream("t", "int");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const n = r.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      seen.add(n);
    }
    expect(seen.size).toBe(6);
  });

  it("poisson mean is close to lambda", () => {
    const r = stream("t", "poisson");
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += r.poisson(1.4);
    expect(sum / n).toBeGreaterThan(1.35);
    expect(sum / n).toBeLessThan(1.45);
  });

  it("weighted respects zero weights", () => {
    const r = stream("t", "w");
    for (let i = 0; i < 500; i++) expect(r.weighted(["a", "b"], [0, 1])).toBe("b");
  });

  it("shuffle keeps all items and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = stream("t", "s").shuffle(input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
