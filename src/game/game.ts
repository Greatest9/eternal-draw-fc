import { createRegistry } from "../curses/definitions";
import type { CurseRegistry } from "../curses/types";
import { deriveAchievements, runDerivers } from "../derive/derive";
import { pickLineup } from "../engine/lineup";
import { buildTable, type Standing } from "../engine/league";
import type { Side } from "../engine/match";
import { playFixture } from "../engine/play";
import { endSeason, fixturesForRound, startSeason, type SeasonSummary } from "../engine/season";
import { EventLog } from "../events/store";
import type { GameEvent, Id } from "../events/types";
import { runNarrative } from "../narrative/narrative";
import { createSave, deserialize, serialize, type SaveGame } from "../save/save";
import type { GameState } from "../state/types";
import { buildWorld, makeSquad, newIncomingClubs } from "./world";

export interface HistoryRow { season: number; compName: string; pos: number; of: number; pts: number; w: number; d: number; l: number; relegated: boolean }

export class Game {
  readonly registry: CurseRegistry = createRegistry();
  private sides = new Map<Id, Side>();
  private names = new Map<Id, string>();
  private listeners = new Set<() => void>();
  version = 0;

  constructor(readonly seed: string, public state: GameState, public log: EventLog) {}

  static create(seed: string, playerClubId: Id): Game {
    const g = new Game(seed, buildWorld(seed, playerClubId), new EventLog());
    startSeason(g.state, g.log, seed);
    return g;
  }

  static load(save: SaveGame): Game {
    return new Game(save.seed, save.state, new EventLog(save.events));
  }

  static fromJSON(json: string): Game {
    return Game.load(deserialize(json));
  }

  toSave(): SaveGame { return createSave(this.seed, this.state, this.log); }
  toJSON(): string { return serialize(this.toSave()); }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((f) => f()); }

  // ---- names and squads
  sideFor = (clubId: Id): Side => {
    let s = this.sides.get(clubId);
    if (!s) {
      const club = this.state.clubs[clubId]!;
      const squad = makeSquad(clubId, this.seed, (this.state.flags[`q.${clubId}`] as number) ?? 55);
      s = { clubId, formation: club.formation, ...pickLineup(club.formation, squad) };
      this.sides.set(clubId, s);
      squad.forEach((p) => this.names.set(p.id, p.name));
    }
    return s;
  };
  name = (id: Id): string => {
    const club = this.state.clubs[id];
    if (club) return club.name;
    if (!this.names.has(id)) {
      const owner = id.split("-p")[0]!;
      if (this.state.clubs[owner]) this.sideFor(owner);
      const sq = this.state.clubs[owner] ? makeSquad(owner, this.seed, (this.state.flags[`q.${owner}`] as number) ?? 55) : [];
      sq.forEach((p) => this.names.set(p.id, p.name));
    }
    return this.names.get(id) ?? id;
  };
  manager = (clubId: Id): string => (this.state.flags[`mgr.${clubId}`] as string) ?? "The manager";

  // ---- queries
  get me(): Id { return this.state.playerClubId!; }
  compOf(clubId: Id) { return Object.values(this.state.competitions).find((c) => c.clubIds.includes(clubId)); }
  table(compId: Id): Standing[] {
    const c = this.state.competitions[compId]!;
    return buildTable(this.log.all(), compId, this.state.season, c.clubIds);
  }
  record(clubId: Id) {
    const c = this.compOf(clubId);
    if (!c) return null;
    const t = this.table(c.id);
    const i = t.findIndex((r) => r.clubId === clubId);
    return { row: t[i]!, pos: i + 1, of: t.length, comp: c, table: t };
  }
  pointsAboveDrop(clubId: Id): number | null {
    const r = this.record(clubId);
    if (!r) return null;
    const k = this.state.settings.relegationSlots;
    const lastSafe = r.table[r.table.length - k - 1]!;
    const firstDrop = r.table[r.table.length - k]!;
    return r.pos <= r.table.length - k ? r.row.pts - firstDrop.pts : r.row.pts - lastSafe.pts;
  }
  form(clubId: Id, n = 5): Array<"W" | "D" | "L"> {
    const out: Array<"W" | "D" | "L"> = [];
    for (let i = this.log.length - 1; i >= 0 && out.length < n; i--) {
      const e = this.log.all()[i]!;
      if (e.type !== "match.fulltime") continue;
      const p = e.payload as any;
      if (p.home !== clubId && p.away !== clubId) continue;
      const [gf, ga] = p.home === clubId ? [p.hg, p.ag] : [p.ag, p.hg];
      out.unshift(gf > ga ? "W" : gf === ga ? "D" : "L");
    }
    return out;
  }
  nextRound(): number | null {
    const rounds = Object.values(this.state.fixtures).filter((f) => f.status === "scheduled").map((f) => f.round);
    return rounds.length ? Math.min(...rounds) : null;
  }
  roundsTotal(): number { return Math.max(0, ...Object.values(this.state.fixtures).map((f) => f.round)); }
  seasonComplete(): boolean { return Object.keys(this.state.fixtures).length > 0 && this.nextRound() === null; }
  nextFixture() {
    const r = this.nextRound();
    if (r === null) return null;
    return Object.values(this.state.fixtures).find((f) => f.round === r && f.status === "scheduled" && (f.home === this.me || f.away === this.me)) ?? null;
  }
  lastMatch(): { fixtureId: Id; seq: number } | null {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log.all()[i]!;
      if (e.type === "match.fulltime" && e.actors.includes(this.me)) return { fixtureId: e.fixtureId!, seq: e.seq };
    }
    return null;
  }
  lastCalledOff(): GameEvent | null {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log.all()[i]!;
      if ((e.type === "fixture.postponed" || e.type === "fixture.abandoned") && e.actors.includes(this.me)) return e;
    }
    return null;
  }
  fixtureEvents(fixtureId: Id): GameEvent[] { return this.log.byFixture(fixtureId); }
  news(): GameEvent[] { return this.log.byType("news.published").slice().reverse(); }
  disruptions(): number { return (this.state.flags["legend.doomed.disruptions"] as number | undefined) ?? 0; }
  history(): HistoryRow[] {
    const out: HistoryRow[] = [];
    for (const e of this.log.byType("table.updated")) {
      const p = e.payload as any;
      const rows = p.table as Standing[];
      const i = rows.findIndex((r) => r.clubId === this.me);
      if (i < 0) continue;
      const r = rows[i]!;
      out.push({ season: p.season, compName: this.state.competitions[p.compId]?.name ?? p.compId, pos: i + 1, of: rows.length, pts: r.pts, w: r.w, d: r.d, l: r.l, relegated: i >= rows.length - this.state.settings.relegationSlots });
    }
    return out;
  }
  achievements(): GameEvent[] { return this.log.byType("achievement.unlocked"); }

  // ---- actions
  private narrativeCtx() { return { state: this.state, log: this.log, seed: this.seed, name: this.name, managers: Object.fromEntries(Object.keys(this.state.clubs).map((id) => [id, this.manager(id)])) }; }

  playMatchday(): { round: number; seasonComplete: boolean } | null {
    const round = this.nextRound();
    if (round === null || this.state.careerOver) return null;
    const ctx = { state: this.state, log: this.log, seed: this.seed, registry: this.registry, sideFor: this.sideFor };
    const comps = Object.values(this.state.competitions).sort((a, b) => a.tier - b.tier);
    for (const c of comps) for (const f of fixturesForRound(this.state, c.id, round)) if (f.status === "scheduled") playFixture(ctx, f.id);
    runDerivers(this.state, this.log);
    runNarrative(this.narrativeCtx());
    this.emit();
    return { round, seasonComplete: this.seasonComplete() };
  }

  closeSeason(): SeasonSummary | null {
    if (!this.seasonComplete()) return null;
    const incoming = newIncomingClubs(this.state, this.seed, this.state.settings.relegationSlots);
    const summary = endSeason(this.state, this.log, incoming);
    deriveAchievements(this.state, this.log, summary);
    runNarrative(this.narrativeCtx());
    if (!this.state.careerOver) startSeason(this.state, this.log, this.seed);
    this.emit();
    return summary;
  }
}
