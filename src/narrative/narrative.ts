import { stream, type Rng } from "../engine/rng";
import { buildTable, type Standing } from "../engine/league";
import type { EventLog } from "../events/store";
import type { GameEvent, Id, NewEvent } from "../events/types";
import type { GameState } from "../state/types";
import { COMMENTARY, CUES, FAN, NEWS, SLOTS, type NewsTemplate } from "./templates";

/**
 * The narrative layer reads events and writes narrative events (news, fan posts, commentary, cutaway cues).
 * It never touches game state other than its own watermark flag, and its rolls come from per-event streams.
 */
export interface NarrativeContext {
  state: GameState;
  log: EventLog;
  seed: string;
  name: (id: Id) => string;
  managers?: Record<Id, string>;
}

export const OUTLET = "The Daily Deadlock";
const COOLDOWN_DAYS = 28;
const day = (d: string) => Math.floor(Date.parse(d) / 86400000);

export function ordinal(n: number): string {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
}

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => {
    if (!SLOTS.has(k)) throw new Error(`Unknown slot {${k}}`);
    if (!(k in vars)) throw new Error(`Missing value for slot {${k}} in "${tpl}"`);
    return String(vars[k]);
  });
}

export interface Claim { clubId: Id; compId: Id; season: number; seq: number; w: number; d: number; l: number; p: number; pos: number }

interface Cand {
  kind: string; key: string; sal: number; flavors: string[]; vars: Record<string, string | number>;
  src: string; date: string; fixtureId?: Id; clubId?: Id; length?: number; burst?: string; claims: Claim[];
  /** Candidates sharing a dedupe key compete for one slot; cooldowns still use `key`. */
  dedupe?: string;
}

export function runNarrative(ctx: NarrativeContext): GameEvent[] {
  const { state, log, seed } = ctx;
  const mark = (state.flags["narrative.seq"] as number | undefined) ?? 0;
  const upto = log.length;
  const all = log.all().slice(0, upto);
  const fresh = all.slice(mark);
  state.flags["narrative.seq"] = upto;
  const out: NewEvent[] = [];
  const me = state.playerClubId;
  const tcache = new Map<string, Standing[]>();

  const flavorOf = (id: Id): string => {
    const c = state.clubs[id]?.curses ?? [];
    return c.includes("equilibrium") ? "equilibrium" : c.includes("fall") ? "fall" : "gen";
  };
  const manager = (id: Id) => ctx.managers?.[id] ?? "The manager";

  /** League record for a club as it stood right after event `seq`. */
  function recAt(compId: Id, season: number, seq: number, clubId: Id): Claim {
    const key = `${compId}|${season}|${seq}`;
    let t = tcache.get(key);
    if (!t) {
      const evs = all.filter((e) => e.type === "match.fulltime" && e.seq <= seq && (e.payload as any).compId === compId && (e.payload as any).season === season);
      const ids = new Set<Id>();
      evs.forEach((e) => { ids.add((e.payload as any).home); ids.add((e.payload as any).away); });
      t = buildTable(evs, compId, season, [...ids]);
      tcache.set(key, t);
    }
    const i = t.findIndex((r) => r.clubId === clubId);
    const r = t[i] ?? { w: 0, d: 0, l: 0, p: 0 };
    return { clubId, compId, season, seq, w: r.w, d: r.d, l: r.l, p: r.p, pos: i + 1 };
  }
  const tableSize = (c: Claim) => tcache.get(`${c.compId}|${c.season}|${c.seq}`)?.length ?? 12;
  const inDrop = (c: Claim) => c.pos > tableSize(c) - state.settings.relegationSlots;

  const ev = (e: GameEvent, type: NewEvent["type"], payload: Record<string, unknown>, tags: string[] = [], minute = e.minute): NewEvent => ({
    type, date: e.date, causedBy: e.id, payload, tags,
    ...(e.fixtureId !== undefined && { fixtureId: e.fixtureId }),
    ...(minute !== undefined && { minute }),
  });
  const pick = (rng: Rng, xs: string[]) => rng.pick(xs);
  const pool = (m: Record<string, string[]>, side: string, flavor: string) => m[`${side}:${flavor}`] ?? m[side] ?? [];

  // ---- match experience for the player's club: commentary, fan posts, cutaways
  const fixtureOf = new Map<Id, GameEvent[]>();
  for (const e of fresh) {
    if (e.type !== "match.fulltime") continue;
    const p = e.payload as any;
    if (!me || (p.home !== me && p.away !== me)) continue;
    fixtureOf.set(e.fixtureId as Id, all.filter((x) => x.fixtureId === e.fixtureId && x.type.startsWith("match.")));
  }
  for (const events of fixtureOf.values()) {
    const mine = me as Id;
    const fl = flavorOf(mine);
    const mgr = manager(mine);
    const fpHome = (events.find((x) => x.type === "match.fulltime")!.payload as any).home as Id;
    const benchLines = (k: string) => CUES.bench[k]![fl] ?? CUES.bench[k]!["gen"]!;
    let posts = 0;
    const post = (e: GameEvent, side: "home" | "rival", trigger: string, vars: Record<string, string | number>) => {
      const rng = stream(ctx.seed, "media", e.id, `fan-${trigger}-${side}`);
      const lines = pool(FAN[trigger]!, side, fl);
      if (!lines.length || posts >= 8) return;
      posts++;
      const handle = side === "home" ? pick(rng, ["@UnbeatenUntilDeath", "@TerraceTeresa", "@SeasonTicketSam", "@MiddleGroundMum"]) : pick(rng, ["@RivalRoy", "@BantzBoss", "@NeutralNeil"]);
      out.push(ev(e, "fan.post", { side, handle, text: fill(pick(rng, lines), vars), trigger }, [`club:${mine}`]));
    };
    const cue = (e: GameEvent, target: string, mood: string, lines: string[], vars: Record<string, string | number>) => {
      const rng = stream(ctx.seed, "media", e.id, `cue-${target}-${mood}`);
      out.push(ev(e, "cutaway.cue", { target, mood, line: fill(pick(rng, lines), vars) }, [`club:${mine}`]));
    };

    for (const e of events) {
      const p = e.payload as any;
      const rng = stream(ctx.seed, "media", e.id, "commentary");
      const say = (text: string, kind: string, extra: Record<string, unknown> = {}) => out.push(ev(e, "commentary.line", { text, kind, ...extra }, [`club:${mine}`]));
      if (e.type === "match.kickoff") say(fill(pick(rng, COMMENTARY.kickoff), { home: ctx.name(p.home), away: ctx.name(p.away) }), "kickoff");
      else if (e.type === "match.goal") {
        const [sh, sa] = p.score as [number, number];
        const score = `${sh}-${sa}`;
        const vars = { team: ctx.name(p.team), scorer: ctx.name(p.scorer), assist: p.assist ? ctx.name(p.assist) : "", score };
        let text = fill(pick(rng, p.assist ? COMMENTARY.goalAssist : COMMENTARY.goal), vars);
        if (e.tags.includes("late-goal")) text += COMMENTARY.late;
        say(text, "goal", { score: [sh, sa] });
        const levelNow = sh === sa;
        const my = fpHome === mine ? sh : sa, theirs = fpHome === mine ? sa : sh;
        if (p.team === mine) {
          post(e, "home", levelNow && e.tags.includes("late-goal") ? "lateFor" : "goalFor", vars);
          post(e, "rival", levelNow && e.tags.includes("late-goal") ? "lateFor" : "goalFor", vars);
          cue(e, "bench", "joy", benchLines(my === theirs ? "equalise" : "lead"), { manager: mgr });
          if (levelNow && e.tags.includes("late-goal")) cue(e, "crowd", "relief", CUES.crowdLate, {});
        } else {
          post(e, "home", "goalAgainst", vars);
          post(e, "rival", "goalAgainst", vars);
          cue(e, "bench", my < theirs ? "despair" : "relief", benchLines(my < theirs ? "behind" : my === theirs ? "levelAgainst" : "aheadAgainst"), { manager: mgr });
          cue(e, "crowd", "groan", CUES.crowdAgainst, {});
        }
        cue(e, "replay", "replay", CUES.replayGoal, {});
      } else if (e.type === "match.card") {
        const vars = { player: ctx.name(p.player), team: ctx.name(p.team) };
        const lines = p.card === "red" ? (p.reason === "second-yellow" ? COMMENTARY.secondYellow : COMMENTARY.red) : COMMENTARY.yellow;
        say(fill(pick(rng, lines), vars), "card", { card: p.card });
        if (p.card === "red") {
          cue(e, "ref", "stern", CUES.refRed, {});
          if (p.team === mine) { post(e, "home", "red", vars); post(e, "rival", "red", vars); }
        }
      } else if (e.type === "match.rewrite") {
        const text = COMMENTARY.hint[p.kind];
        if (text) say(fill(text, { scorer: ctx.name(p.player) }), "hint", { hint: p.kind });
        cue(e, "replay", "odd", CUES.replayOdd, {});
        if (["offside-overturned", "foul-in-build-up", "handball-var"].includes(p.kind)) cue(e, "ref", "monitor", CUES.refVar, {});
        post(e, "home", "odd", {});
        post(e, "rival", "odd", {});
      } else if (e.type === "match.fulltime") {
        say(fill(pick(rng, COMMENTARY.fulltime), { home: ctx.name(p.home), away: ctx.name(p.away), hg: p.hg, ag: p.ag }), "fulltime", { score: [p.hg, p.ag] });
        // full-time banter, built from the club's record at this moment
        const c = recAt(p.compId, p.season, e.seq, mine);
        const say2 = (side: "home" | "rival", text: string) => out.push(ev(e, "fan.post", { side, handle: side === "home" ? "@UnbeatenUntilDeath" : "@RivalRoy", text, trigger: "banter", claims: [c] }, [`club:${mine}`]));
        say2("rival", c.w === 0 ? `You have won ${c.w} matches.` : `You have won ${c.w} of ${c.p}. Bold.`);
        say2("home", c.l === 0 ? "How many have we lost?" : "We keep going.");
        say2("rival", inDrop(c) ? "YOU ARE GETTING RELEGATED." : "Mid-table nobodies.");
        say2("home", c.l === 0 ? "Unbeaten, though." : "See you next week.");
        cue(e, "crowd", p.hg === p.ag ? "shrug" : "noise", [p.hg === p.ag ? "The crowd files out with the look of people who expected this." : "The stands empty slowly, arguing."], {});
      }
    }
  }

  // ---- news candidates
  const published = new Map<string, { day: number; length: number }>();
  for (const e of all) if (e.type === "news.published") published.set((e.payload as any).key, { day: day(e.date), length: (e.payload as any).length ?? 0 });
  const cands: Cand[] = [];
  const add = (c: Cand) => {
    const last = published.get(c.key);
    if (last && day(c.date) - last.day < COOLDOWN_DAYS && !(c.length && c.length - last.length >= 5)) c.sal *= 0.25;
    const dk = c.dedupe ?? c.key;
    const old = cands.find((x) => (x.dedupe ?? x.key) === dk);
    if (!old) cands.push(c); else if (c.sal > old.sal) cands[cands.indexOf(old)] = c;
  };
  const involves = (e: GameEvent) => !!me && e.actors.includes(me);

  for (const e of fresh) {
    const p = e.payload as any;
    if (e.type === "match.fulltime") {
      const draw = p.hg === p.ag;
      const hw = p.hg > p.ag;
      add({
        kind: "report", key: `report:${e.fixtureId}`, sal: 20 + (involves(e) ? 10 : 0) + (Math.abs(p.hg - p.ag) >= 3 ? 10 : 0), flavors: draw ? ["draw"] : [],
        vars: { home: ctx.name(p.home), away: ctx.name(p.away), hg: p.hg, ag: p.ag, score: `${p.hg}-${p.ag}`, winner: ctx.name(hw ? p.home : p.away), loser: ctx.name(hw ? p.away : p.home), manager: manager(hw ? p.home : p.away) },
        src: e.id, date: e.date, fixtureId: e.fixtureId as Id, claims: [],
      });
    } else if (e.type === "streak.updated") {
      const club = p.clubId as Id;
      const c = recAt(p.compId ?? (all.find((x) => x.id === e.causedBy)?.payload as any).compId, (all.find((x) => x.id === e.causedBy)?.payload as any).season, e.causedBy ? all.find((x) => x.id === e.causedBy)!.seq : e.seq, club);
      const fl = flavorOf(club);
      add({
        kind: `streak-${p.kind}`, key: `streak-${p.kind}:${club}`, sal: 20 + p.length * 3 + (fl !== "gen" ? 15 : 0) + (club === me ? 10 : 0) + ({ draws: 3, losses: 3, wins: 3, unbeaten: 2, winless: 1 } as Record<string, number>)[p.kind]!, dedupe: `streak:${club}`,
        flavors: [p.kind === "unbeaten" && p.winsInRun === 0 ? "nowin" : "", fl].filter(Boolean),
        vars: { club: ctx.name(club), n: p.length, pos: ordinal(c.pos), wins: p.winsInRun ?? 0, manager: manager(club) },
        src: e.id, date: e.date, fixtureId: e.fixtureId, clubId: club, length: p.length, claims: [c],
        ...((p.kind === "draws" || (p.kind === "unbeaten" && p.winsInRun === 0)) && c.w === 0 ? { burst: "0 WINS!" } : {}),
      });
    } else if (e.type === "milestone.reached" && p.kind === "zone") {
      const club = p.clubId as Id;
      const ft = all.slice(0, e.seq).reverse().find((x) => x.type === "match.fulltime" && (x.payload as any).compId === p.compId)!;
      const c = recAt(p.compId, (ft.payload as any).season, ft.seq, club);
      add({
        kind: `zone-${p.zone}`, key: `zone-${p.zone}:${club}`, sal: 35 + (p.zone === "relegation" && club === me ? 15 : 0) + (club === me ? 5 : 0),
        flavors: [c.l === 0 ? "unbeaten" : ""].filter(Boolean),
        vars: { club: ctx.name(club), pos: ordinal(p.position), pts: p.pts, p: p.played },
        src: e.id, date: e.date, clubId: club, claims: [c],
      });
    } else if (e.type === "rivalry.formed") {
      add({ kind: "rivalry", key: "rivalry", sal: 45 + (me && (p.a === me || p.b === me) ? 15 : 0), flavors: [p.cause === "controversy" ? "controversy" : ""].filter(Boolean), vars: { a: ctx.name(p.a), b: ctx.name(p.b) }, src: e.id, date: e.date, fixtureId: e.fixtureId, claims: [] });
    } else if (e.type === "fixture.postponed" || e.type === "fixture.abandoned") {
      const prog = all.filter((x) => x.type === "curse.legend.progress" && x.fixtureId === e.fixtureId)[0];
      const count = prog ? (prog.payload as any).disruptions : 1;
      const last = (state.flags["legend.doomed.lastMet"] as number | undefined) ?? 1996;
      add({ kind: "called-off", key: `called-off:${e.fixtureId}`, sal: 50 + (involves(e) ? 10 : 0), flavors: [], vars: { home: ctx.name(e.actors[0]!), away: ctx.name(e.actors[1]!), reason: p.reason, lastMet: last, count: count === 1 ? "1 postponement" : `${count} postponements` }, src: e.id, date: e.date, fixtureId: e.fixtureId, claims: [] });
      if (count >= 2 && count % 2 === 0) add({ kind: "legend-whisper", key: "legend-whisper", sal: 25, flavors: [], vars: {}, src: e.id, date: e.date, claims: [] });
    } else if (e.type === "achievement.unlocked") {
      add({ kind: "achievement", key: `achievement:${p.key}:${p.season}`, sal: 60, flavors: [], vars: { club: ctx.name(p.clubId), name: p.name, season: p.season }, src: e.id, date: e.date, clubId: p.clubId, claims: [] });
    } else if (e.type === "season.ended" && me) {
      const tables = all.filter((x) => x.type === "table.updated" && (x.payload as any).season === p.season);
      for (const t of tables) {
        const rows = (t.payload as any).table as Standing[];
        const i = rows.findIndex((r) => r.clubId === me);
        if (i < 0) continue;
        const r = rows[i]!;
        const down = i >= rows.length - state.settings.relegationSlots;
        add({
          kind: "season-review", key: `season-review:${p.season}`, sal: 90,
          flavors: [r.l === 0 && down ? "unbeaten-relegated" : "", r.w === 0 && !down ? "winless-safe" : ""].filter(Boolean),
          vars: { club: ctx.name(me), pos: ordinal(i + 1), pts: r.pts, p: r.p, w: r.w, l: r.l, d: r.d },
          src: e.id, date: e.date, clubId: me, claims: [{ clubId: me, compId: (t.payload as any).compId, season: p.season, seq: e.seq, w: r.w, d: r.d, l: r.l, p: r.p, pos: i + 1 }],
        });
      }
    }
  }
  // strange moments in one match
  const oddBy = new Map<Id, GameEvent[]>();
  for (const e of fresh) if (e.type === "match.rewrite" && e.fixtureId) oddBy.set(e.fixtureId, [...(oddBy.get(e.fixtureId) ?? []), e]);
  for (const [fx, list] of oddBy) {
    const ft = all.find((x) => x.fixtureId === fx && x.type === "match.fulltime");
    if (!ft || list.length < 2) continue;
    const p = ft.payload as any;
    const club = me && (p.home === me || p.away === me) ? me : p.home;
    add({ kind: "controversy", key: `controversy:${club}`, sal: 30 + list.length * 8 + (me && (p.home === me || p.away === me) ? 10 : 0), flavors: [], vars: { club: ctx.name(club), opp: ctx.name(club === p.home ? p.away : p.home), n: `${list.length} strange moments` }, src: list[0]!.id, date: ft.date, fixtureId: fx, claims: [] });
  }

  // selection
  const scored = cands.map((c) => ({ c, sal: c.sal })).filter((x) => x.sal >= 15).sort((a, b) => b.sal - a.sal || a.c.key.localeCompare(b.c.key)).slice(0, 3);

  scored.forEach(({ c }, i) => {
    const rng = stream(seed, "media", c.src, `news-${c.kind}`);
    const list = NEWS[c.kind] ?? NEWS["report"]!;
    let tpl: NewsTemplate | undefined;
    for (const f of c.flavors) { const m = list.filter((t) => t.f === f); if (m.length) { tpl = rng.pick(m); break; } }
    if (!tpl) { const g = list.filter((t) => !t.f); tpl = rng.pick(g.length ? g : list); }
    const src = all.find((x) => x.id === c.src)!;
    out.push(ev(src, "news.published", {
      outlet: OUTLET, kind: c.kind, key: c.key, lead: i === 0, headline: fill(tpl.h, c.vars), dek: fill(tpl.d, c.vars),
      ...(c.burst && { burst: c.burst }), ...(c.length !== undefined && { length: c.length }), ...(c.clubId && { clubId: c.clubId }),
      claims: c.claims, sourceEvents: [c.src],
    }, [`kind:${c.kind}`], undefined));
  });

  return out.map((o) => log.append(o));
}
