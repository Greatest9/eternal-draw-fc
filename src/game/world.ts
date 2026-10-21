import { stream } from "../engine/rng";
import type { Id } from "../events/types";
import { emptyState, type Club, type GameState, type Player } from "../state/types";

export const FORMATIONS = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "3-4-3", "4-5-1"];
const TOWNS = ["Kingsbridge", "Northchester", "Riverside", "Harbour", "Dunmore", "Castlegate", "Ashford", "Millfield", "Redcliffe", "Stonebridge", "Oakham", "Brindle", "Falconby", "Greywater", "Holmwood", "Ivybank", "Junction Road", "Kettleby", "Lowmoor", "Marshgate", "Netherby", "Overton", "Pennine", "Quarry Hill", "Ravensworth", "Saltmarsh", "Thornbury", "Upton Vale", "Wexcombe", "Yarrowby"];
const SUFFIX = ["FC", "Town", "United", "Athletic", "Rovers", "City", "Wanderers", "Albion"];
const FIRST = ["Obi", "Rhys", "Tunde", "Marcus", "Jamal", "Kofi", "Liam", "Seun", "Declan", "Ade", "Callum", "Emeka", "Jordan", "Femi", "Owen", "Chidi", "Reece", "Yusuf", "Dele", "Kane", "Idris", "Tobi", "Aaron", "Musa", "Ben", "Sani", "Joel", "Kelechi", "Harry", "Bayo"];
const LAST = ["Marsh", "Calder", "Okafor", "Bellamy", "Adeyemi", "Hughes", "Danjuma", "Pryce", "Okoro", "Fletcher", "Ibrahim", "Moss", "Eze", "Whitlock", "Bello", "Rowe", "Nwosu", "Darby", "Salisu", "Penn", "Yakubu", "Hale", "Abubakar", "Stone", "Lawal", "Brook", "Umar", "Quigley", "Ojo", "Tate"];
const MANAGERS = ["Gary Longball", "Sandra Pitchside", "Dave Counterpunch", "Mo Setpiece", "Ruth Backfour", "Colin Highpress", "Tayo Wingback", "Nina Offside"];

export const EDFC = "edfc";
export const DOOMED = "doomed";

export function clubName(n: number): string {
  return `${TOWNS[n % TOWNS.length]} ${SUFFIX[Math.floor(n / TOWNS.length) % SUFFIX.length]}`;
}

export function makeSquad(clubId: Id, seed: string, quality: number): Player[] {
  const r = stream(seed, "squad", clubId);
  const clamp = (n: number) => Math.max(1, Math.min(99, n));
  const spec: Array<[Player["pos"], number]> = [["GK", 2], ["DF", 6], ["MF", 6], ["FW", 5]];
  const out: Player[] = [];
  const used = new Set<string>();
  let n = 0;
  for (const [pos, count] of spec) {
    for (let i = 0; i < count; i++) {
      let name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
      while (used.has(name)) name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
      used.add(name);
      const back = pos === "DF" || pos === "GK";
      out.push({
        id: `${clubId}-p${++n}`, name, pos, clubId, morale: 50,
        att: clamp(quality + r.int(-8, 8) + (pos === "FW" ? 6 : back ? -12 : 0)),
        def: clamp(quality + r.int(-8, 8) + (back ? 6 : pos === "FW" ? -12 : 0)),
        pace: r.int(40, 80),
        discipline: r.int(45, 80),
      });
    }
  }
  return out;
}

export function addClub(state: GameState, seed: string, id: Id, name: string, opts: { quality: number; formation?: string; colors?: [string, string]; manager?: string; curses?: string[] }): Club {
  const r = stream(seed, "club", id);
  const hue = r.int(0, 359);
  const club: Club = {
    id, name,
    colors: opts.colors ?? [`hsl(${hue} 65% 38%)`, `hsl(${(hue + 40) % 360} 80% 88%)`],
    formation: opts.formation ?? r.pick(FORMATIONS),
    curses: opts.curses ?? [],
    budget: 0, fanMood: 50, squad: [],
  };
  state.clubs[id] = club;
  state.flags[`q.${id}`] = opts.quality;
  state.flags[`mgr.${id}`] = opts.manager ?? r.pick(MANAGERS);
  return club;
}

/** 24 clubs, two divisions of 12. Eternal Draw FC and FC Doomed start in Division 1. */
export function buildWorld(seed: string, playerClubId: Id): GameState {
  const state = emptyState("2026-08-01");
  const r = stream(seed, "world");
  addClub(state, seed, EDFC, "Eternal Draw FC", { quality: 62, formation: "4-5-1", colors: ["#151515", "#ffd23f"], manager: "Peter Tactical", curses: ["equilibrium"] });
  addClub(state, seed, DOOMED, "FC Doomed", { quality: 58, formation: "3-4-3", colors: ["#7a1010", "#ffffff"], manager: "Mick Fatalist", curses: ["fall"] });
  const names = r.shuffle(Array.from({ length: 60 }, (_, i) => i)).slice(0, 22);
  const d1: Id[] = [EDFC, DOOMED];
  const d2: Id[] = [];
  names.forEach((n, i) => {
    const id = `c${String(i + 3).padStart(2, "0")}`;
    const top = i < 10;
    addClub(state, seed, id, clubName(n), { quality: top ? r.int(54, 72) : r.int(42, 58) });
    (top ? d1 : d2).push(id);
  });
  state.competitions["d1"] = { id: "d1", name: "Premier Division", tier: 1, clubIds: d1 };
  state.competitions["d2"] = { id: "d2", name: "Division Two", tier: 2, clubIds: d2 };
  state.flags["club.counter"] = 100;
  state.playerClubId = playerClubId;
  return state;
}

/** Fresh non-league clubs that replace the three dropped out of Division Two. */
export function newIncomingClubs(state: GameState, seed: string, k: number): Id[] {
  const ids: Id[] = [];
  for (let i = 0; i < k; i++) {
    const n = (state.flags["club.counter"] as number) + 1;
    state.flags["club.counter"] = n;
    const id = `c${n}`;
    const r = stream(seed, "incoming", id);
    addClub(state, seed, id, clubName(60 + n), { quality: r.int(40, 54) });
    ids.push(id);
  }
  return ids;
}
