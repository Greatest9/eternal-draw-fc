import type { GameEvent, Id } from "../events/types";

export interface Standing {
  clubId: Id;
  p: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
}

export interface FulltimePayload {
  compId: Id;
  season: number;
  home: Id;
  away: Id;
  hg: number;
  ag: number;
}

function blank(clubId: Id): Standing {
  return { clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

function apply(s: Standing, gf: number, ga: number): void {
  s.p++; s.gf += gf; s.ga += ga; s.gd = s.gf - s.ga;
  if (gf > ga) { s.w++; s.pts += 3; }
  else if (gf === ga) { s.d++; s.pts += 1; }
  else s.l++;
}

/** Points, goal difference, goals scored, then club id so order is always deterministic. */
export function compareStandings(a: Standing, b: Standing): number {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.clubId.localeCompare(b.clubId);
}

/** The table is derived from the event log, never stored separately. */
export function buildTable(
  events: readonly GameEvent[],
  compId: Id,
  season: number,
  clubIds: readonly Id[],
): Standing[] {
  const rows = new Map(clubIds.map((id) => [id, blank(id)] as const));
  for (const e of events) {
    if (e.type !== "match.fulltime") continue;
    const p = e.payload as unknown as FulltimePayload;
    if (p.compId !== compId || p.season !== season) continue;
    const h = rows.get(p.home);
    const a = rows.get(p.away);
    if (!h || !a) continue;
    apply(h, p.hg, p.ag);
    apply(a, p.ag, p.hg);
  }
  return [...rows.values()].sort(compareStandings);
}
