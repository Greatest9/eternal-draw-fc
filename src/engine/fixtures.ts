import type { Id } from "../events/types";
import type { Fixture } from "../state/types";
import { addDays } from "./calendar";
import { stream } from "./rng";

type Pair = [Id, Id];

/** Circle method. Returns n-1 rounds of n/2 pairs; every pair meets once. */
export function roundRobin(ids: readonly Id[]): Pair[][] {
  const n = ids.length;
  if (n < 2 || n % 2 !== 0) throw new Error("round robin needs an even number of clubs");
  let a = ids.slice();
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const m: Pair[] = [];
    for (let i = 0; i < n / 2; i++) m.push([a[i] as Id, a[n - 1 - i] as Id]);
    rounds.push(m);
    a = [a[0] as Id, a[n - 1] as Id, ...a.slice(1, n - 1)];
  }
  return rounds;
}

/** Greedy home/away assignment that keeps each club's home count and streaks balanced. */
function assignVenues(rounds: Pair[][]): Pair[][] {
  const bal = new Map<Id, number>();
  const lastHome = new Map<Id, boolean>();
  return rounds.map((round) =>
    round.map(([x, y]) => {
      const bx = bal.get(x) ?? 0;
      const by = bal.get(y) ?? 0;
      let xHome: boolean;
      if (bx !== by) xHome = bx < by;
      else if (lastHome.get(x) === true && lastHome.get(y) !== true) xHome = false;
      else if (lastHome.get(y) === true && lastHome.get(x) !== true) xHome = true;
      else xHome = true;
      const [h, a] = xHome ? [x, y] : [y, x];
      bal.set(h, (bal.get(h) ?? 0) + 1);
      bal.set(a, (bal.get(a) ?? 0) - 1);
      lastHome.set(h, true);
      lastHome.set(a, false);
      return [h, a] as Pair;
    }),
  );
}

/** Double round robin: second half mirrors the first with venues swapped. */
export function generateFixtures(
  compId: Id,
  clubIds: readonly Id[],
  season: number,
  startDate: string,
  seed: string,
): Fixture[] {
  const order = stream(seed, "fixtures", compId, season).shuffle(clubIds);
  const first = assignVenues(roundRobin(order));
  const second = first.map((r) => r.map(([h, a]): Pair => [a, h]));
  const out: Fixture[] = [];
  [...first, ...second].forEach((round, ri) => {
    round.forEach(([home, away], i) => {
      const r = ri + 1;
      out.push({
        id: `${compId}-s${season}-r${r}-${i + 1}`,
        compId,
        round: r,
        date: addDays(startDate, 7 * r),
        home,
        away,
        status: "scheduled",
      });
    });
  });
  return out;
}
