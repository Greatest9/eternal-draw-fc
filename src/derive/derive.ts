import { buildTable } from "../engine/league";
import type { SeasonSummary } from "../engine/season";
import type { EventLog } from "../events/store";
import type { GameEvent, Id, NewEvent } from "../events/types";
import type { GameState } from "../state/types";

/** Derivers are pure functions of the log. They only ever append derived events. */

const THRESHOLDS = new Set([5, 10, 15, 20, 25, 30]);

interface Tracker { draws: number; unbeaten: number; unbeatenWins: number; winless: number; losses: number; wins: number }
const blank = (): Tracker => ({ draws: 0, unbeaten: 0, unbeatenWins: 0, winless: 0, losses: 0, wins: 0 });

function step(t: Tracker, gf: number, ga: number): void {
  if (gf > ga) { t.wins++; t.draws = 0; t.unbeaten++; t.unbeatenWins++; t.winless = 0; t.losses = 0; }
  else if (gf === ga) { t.draws++; t.unbeaten++; t.winless++; t.wins = 0; t.losses = 0; }
  else { t.losses++; t.winless++; t.wins = 0; t.draws = 0; t.unbeaten = 0; t.unbeatenWins = 0; }
}

export const pairKey = (a: Id, b: Id) => [a, b].sort().join(":");

export function runDerivers(state: GameState, log: EventLog): GameEvent[] {
  const watermark = (state.flags["derive.seq"] as number | undefined) ?? 0;
  const upto = log.length;
  const trackers = new Map<Id, Tracker>();
  const out: NewEvent[] = [];
  const touched = new Map<string, { compId: Id; season: number; date: string }>();
  const newRivals = new Set<string>();

  for (const e of log.all().slice(0, upto)) {
    if (e.type !== "match.fulltime") continue;
    const p = e.payload as any;
    const fresh = e.seq > watermark;
    for (const [club, gf, ga] of [[p.home, p.hg, p.ag], [p.away, p.ag, p.hg]] as Array<[Id, number, number]>) {
      const t = trackers.get(club) ?? blank();
      trackers.set(club, t);
      step(t, gf, ga);
      if (!fresh) continue;
      const kinds: Array<[string, number]> = [["draws", t.draws], ["unbeaten", t.unbeaten], ["winless", t.winless], ["losses", t.losses], ["wins", t.wins]];
      for (const [kind, length] of kinds) {
        if (length < 3) continue;
        const base = { date: e.date, fixtureId: e.fixtureId as Id, causedBy: e.id, actors: [club] };
        out.push({ ...base, type: "streak.updated", payload: { clubId: club, kind, length, winsInRun: kind === "unbeaten" ? t.unbeatenWins : undefined }, tags: [`streak:${kind}:${length}`, `club:${club}`] });
        if (THRESHOLDS.has(length)) out.push({ ...base, type: "milestone.reached", payload: { clubId: club, kind: `streak-${kind}`, length }, tags: [`milestone:${kind}:${length}`, `club:${club}`] });
      }
    }
    if (!fresh) continue;
    touched.set(`${p.compId}|${p.season}`, { compId: p.compId, season: p.season, date: e.date });

    // rivalry: a red card plus a late goal, or two or more strange moments in one match
    const fx = log.byFixture(e.fixtureId as Id);
    const red = fx.some((x) => x.type === "match.card" && (x.payload as any).card === "red");
    const late = fx.some((x) => x.type === "match.goal" && x.tags.includes("late-goal"));
    const odd = fx.filter((x) => x.tags.includes("unnatural") && x.type === "match.rewrite").length >= 2;
    const key = pairKey(p.home, p.away);
    if ((red && late) || odd) {
      if (log.byTag(`rivalry:${key}`).length === 0 && !newRivals.has(key)) {
        newRivals.add(key);
        out.push({ type: "rivalry.formed", date: e.date, fixtureId: e.fixtureId as Id, causedBy: e.id, actors: [p.home, p.away], payload: { a: p.home, b: p.away, cause: odd ? "controversy" : "red-and-late" }, tags: [`rivalry:${key}`] });
      }
    }
  }

  // table zones, once per touched competition
  const k = state.settings.relegationSlots;
  for (const t of touched.values()) {
    const comp = state.competitions[t.compId];
    if (!comp || t.season !== state.season) continue;
    const table = buildTable(log.all().slice(0, upto), t.compId, t.season, comp.clubIds);
    table.forEach((row, i) => {
      if (row.p < 4) return;
      const zone = i < 3 ? "top" : i >= table.length - k ? "relegation" : "mid";
      const flag = `zone.${t.season}.${row.clubId}`;
      const prev = state.flags[flag] as string | undefined;
      state.flags[flag] = zone;
      if (prev === undefined || prev === zone) return;
      if (zone === "mid" && prev !== "relegation") return;
      out.push({ type: "milestone.reached", date: t.date, actors: [row.clubId], payload: { clubId: row.clubId, kind: "zone", zone, position: i + 1, pts: row.pts, played: row.p, compId: t.compId }, tags: [`zone:${zone}`, `club:${row.clubId}`] });
    });
  }

  state.flags["derive.seq"] = upto;
  return out.map((o) => log.append(o));
}

const ACHIEVEMENTS: Record<string, string> = {
  "perfectly-mediocre": "The Perfectly Mediocre",
  unconquered: "The Unconquered",
  unvictorious: "The Unvictorious",
  "mathematically-safe": "The Mathematically Safe",
};

/** Call right after endSeason, with its summary. Achievements are for the player's club only. */
export function deriveAchievements(state: GameState, log: EventLog, summary: SeasonSummary): GameEvent[] {
  const id = state.playerClubId;
  if (!id) return [];
  const out: NewEvent[] = [];
  const unlock = (key: string) => {
    if (log.byTag(`achievement:${key}`).some((e) => e.payload.clubId === id && e.payload.season === summary.season)) return;
    out.push({ type: "achievement.unlocked", date: log.all().at(-1)?.date ?? state.date, actors: [id], payload: { key, name: ACHIEVEMENTS[key], clubId: id, season: summary.season }, tags: [`achievement:${key}`, `club:${id}`] });
  };
  for (const table of Object.values(summary.tables)) {
    const i = table.findIndex((r) => r.clubId === id);
    if (i < 0) continue;
    const r = table[i]!;
    if (r.p < 20) continue;
    if (r.d === r.p) unlock("perfectly-mediocre");
    if (r.l === 0) unlock("unconquered");
    if (r.w === 0) unlock("unvictorious");
    if (r.w === 0 && i < table.length - state.settings.relegationSlots) unlock("mathematically-safe");
  }
  return out.map((o) => log.append(o));
}
