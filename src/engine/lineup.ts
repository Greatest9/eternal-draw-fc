import type { Player } from "../state/types";

export interface Lineup {
  lineup: Player[];
  bench: Player[];
}

/** "4-2-3-1" -> 4 defenders, 5 midfielders, 1 forward. */
export function parseFormation(formation: string): { df: number; mf: number; fw: number } {
  const parts = formation.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Bad formation ${formation}`);
  }
  const df = parts[0] as number;
  const fw = parts[parts.length - 1] as number;
  const mf = parts.slice(1, -1).reduce((s, n) => s + n, 0);
  if (df + mf + fw !== 10) throw new Error(`Formation ${formation} must have 10 outfield players`);
  return { df, mf, fw };
}

/** Best player per slot: GK by def, DF by def, MF by att + def, FW by att. Ties break on id. */
export function pickLineup(formation: string, squad: readonly Player[]): Lineup {
  const { df, mf, fw } = parseFormation(formation);
  const best = (pos: Player["pos"], n: number, score: (p: Player) => number): Player[] => {
    const pool = squad.filter((p) => p.pos === pos).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    if (pool.length < n) throw new Error(`Squad has ${pool.length} ${pos}, formation ${formation} needs ${n}`);
    return pool.slice(0, n);
  };
  const lineup = [
    ...best("GK", 1, (p) => p.def),
    ...best("DF", df, (p) => p.def),
    ...best("MF", mf, (p) => p.att + p.def),
    ...best("FW", fw, (p) => p.att),
  ];
  const used = new Set(lineup.map((p) => p.id));
  const bench = squad.filter((p) => !used.has(p.id)).sort((a, b) => a.id.localeCompare(b.id));
  return { lineup, bench };
}
