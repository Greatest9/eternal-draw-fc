/** Text content. Slots look like {club}. Every slot must be in SLOTS (checked by a test). */

export const SLOTS = new Set([
  "club", "opp", "home", "away", "winner", "loser", "score", "n", "pos", "pts", "p", "w", "l", "d", "wins",
  "manager", "scorer", "assist", "player", "team", "reason", "lastMet", "count", "a", "b", "name", "season", "hg", "ag",
]);

export interface NewsTemplate { f?: string; h: string; d: string }

export const NEWS: Record<string, NewsTemplate[]> = {
  report: [
    { h: "{winner} beat {loser} {score}", d: "{manager} said the team \"showed character\". Nobody asked what kind." },
    { h: "{winner} edge {loser} {score}", d: "A result that will look better in the table than it did on the pitch." },
    { f: "draw", h: "{home} and {away} share the points", d: "{score} at the final whistle. Both managers called it a point gained." },
    { f: "draw", h: "{home} {hg}-{ag} {away}: nobody wins", d: "The neutrals would like their afternoon back." },
  ],
  "streak-draws": [
    { h: "{club} DRAW AGAIN: {n} IN A ROW", d: "{club} have shared the points {n} games running and sit {pos}." },
    { f: "equilibrium", h: "{club} EXTEND DRAW RUN TO {n}", d: "{manager} called it \"a platform\". Asked what it was a platform for, he left the room." },
    { f: "equilibrium", h: "{n} DRAWS AND COUNTING FOR {club}", d: "Supporters say they are unbeaten. The table says {pos}." },
  ],
  "streak-unbeaten": [
    { h: "{club} UNBEATEN IN {n}", d: "{wins} wins in the run and {pos} in the table." },
    { f: "nowin", h: "{club} UNBEATEN IN {n}, WITHOUT A WIN", d: "Zero victories, zero defeats and one confused board. {pos} in the table." },
  ],
  "streak-winless": [
    { h: "{club} WINLESS IN {n}", d: "The last win is a distant memory. {pos} in the table." },
    { f: "equilibrium", h: "{n} GAMES WITHOUT A WIN FOR {club}", d: "They have not lost either. Fans are using that sentence a lot." },
  ],
  "streak-losses": [
    { h: "{club} LOSE AGAIN: {n} DEFEATS IN A ROW", d: "{manager} says better days are coming. The fixture list disagrees." },
    { f: "fall", h: "{club} LOSE {n} STRAIGHT", d: "Supporters marked the milestone with a minute of applause and a cake." },
  ],
  "streak-wins": [
    { h: "{club} WIN {n} IN A ROW", d: "{manager}: \"We take it one game at a time.\" The table says {pos}." },
  ],
  "zone-relegation": [
    { h: "{club} DROP INTO THE RELEGATION ZONE", d: "{pos} place and {pts} points. Fans are checking the maths." },
    { f: "unbeaten", h: "{club} IN THE DROP ZONE, STILL UNBEATEN", d: "{pts} points from {p} games without a defeat. It is not enough." },
  ],
  "zone-top": [{ h: "{club} GO TOP", d: "{pts} points from {p}. The board has asked everyone to stay calm." }],
  "zone-mid": [{ h: "{club} CLIMB OUT OF THE DROP ZONE", d: "{pos} place and {pts} points. Nobody is celebrating yet." }],
  "called-off": [
    { h: "{home} v {away} CALLED OFF: {reason}", d: "The fixture has not been played since {lastMet}. {count} and counting." },
    { h: "{home} v {away} OFF AGAIN", d: "The league blames {reason}. Locals blame something else." },
  ],
  "legend-whisper": [{ h: "THE FIXTURE NOBODY PLAYS", d: "Older fans mutter about a jinx and will not say more." }],
  controversy: [
    { h: "{club} v {opp}: {n}", d: "A fumble here, a VAR call there. The league says it is \"looking into it\"." },
    { h: "Inquiry calls after {club} v {opp}", d: "{n} the rulebook has no word for." },
  ],
  rivalry: [
    { h: "{a} v {b}: IT IS PERSONAL", d: "Red cards, late goals and a lot of shouting. Supporters have picked sides." },
    { f: "controversy", h: "{a} FANS DEMAND AN INQUIRY OVER {b}", d: "Both sets of supporters agree something odd happened. They disagree on what." },
  ],
  achievement: [{ h: "{club}: {name}", d: "Season {season} will be remembered for it. The club has ordered a banner." }],
  "season-review": [
    { h: "{club} FINISH {pos}", d: "{pts} points from {p} games. The board will meet on Monday." },
    { f: "unbeaten-relegated", h: "RELEGATED WITHOUT LOSING", d: "{club} finish {pos} on {pts} points with {w} wins and {l} defeats. The manager has been offered an extension." },
    { f: "winless-safe", h: "SAFE, WINLESS AND PROUD", d: "{club} stay up on {pts} points without winning a game. The manager is already talking about next season." },
  ],
};

export const FAN: Record<string, Record<string, string[]>> = {
  goalFor: {
    home: ["GOAL! {scorer}!", "{scorer} again. Where would we be without him?", "Did that just happen? {scorer}!"],
    rival: ["Lucky. Very lucky.", "Enjoy it. All of you."],
  },
  goalAgainst: {
    "home:equilibrium": ["Relax. We have never lost. Check the rules.", "One down. Fine. We know how this ends."],
    "home:fall": ["Right on schedule.", "Plan A was to lose. It is working."],
    home: ["Here we go again.", "Unbelievable defending."],
    rival: ["Bring a book, lads. This one is done.", "{scorer} knows what he is doing. Unlike your manager."],
  },
  lateFor: {
    "home:equilibrium": ["{scorer}!!! Late! Never in doubt.", "Of course it is level. It is always level."],
    home: ["{scorer}!!! Never in doubt.", "Late drama! Love this club."],
    rival: ["Every. Single. Time. This is not football.", "Referee, a word please."],
  },
  red: {
    home: ["Red card? That is a joke.", "The ref has it in for us."],
    rival: ["Fair play to the referee. Finally."],
  },
  odd: {
    home: ["Did anyone else see that?", "Physics took the day off."],
    rival: ["Something is very wrong with this fixture.", "The league should look into this."],
  },
};

export const COMMENTARY = {
  kickoff: ["Kick-off: {home} v {away}."],
  goal: ["GOAL for {team}! {scorer} puts it away. {score}.", "{scorer} scores for {team}. It is now {score}."],
  goalAssist: ["GOAL for {team}! {scorer} finishes, {assist} with the pass. {score}."],
  late: " Late goal.",
  yellow: ["Yellow card for {player} ({team})."],
  red: ["RED CARD! {player} ({team}) is sent off."],
  secondYellow: ["Second yellow, and {player} ({team}) is off."],
  fulltime: ["Full time: {home} {hg}-{ag} {away}."],
  hint: {
    "keeper-fumble": "Replays show the keeper made a mess of that one.",
    "post-and-in": "It hits the post, rolls along the line and goes in. Physics took the day off.",
    deflection: "A deflection off a defender wrong-foots everyone.",
    "offside-overturned": "VAR: {scorer}'s goal is chalked off for offside by roughly one toe.",
    "foul-in-build-up": "VAR rules out {scorer}'s goal for a foul earlier in the move.",
    "handball-var": "Handball spotted on the replay. {scorer}'s goal is disallowed.",
    scramble: "A scramble in the box and the ball squirms over the line off someone.",
  } as Record<string, string>,
};

export const CUES = {
  /** Manager reactions, by what the goal did to the score from the club's point of view, then by curse flavour. */
  bench: {
    equalise: {
      equilibrium: ["{manager} nods. He knew the score would level out."],
      gen: ["{manager} hugs the physio. Level again."],
    },
    lead: {
      equilibrium: ["{manager} checks his watch. A lead is not what this club is built for."],
      gen: ["{manager} punches the air and hugs the physio."],
    },
    behind: {
      equilibrium: ["{manager} taps his watch. Plenty of time left, and the rules are on his side."],
      fall: ["{manager} sighs. This was always the plan."],
      gen: ["{manager} stares at the grass in silence."],
    },
    levelAgainst: {
      gen: ["{manager} looks relieved and confused in equal measure."],
    },
    aheadAgainst: {
      gen: ["{manager} shrugs. Still ahead, for now."],
    },
  } as Record<string, Record<string, string[]>>,
  crowdLate: ["The home end explodes. Someone drops a pie.", "Bedlam in the home end. A steward is hugging a stranger."],
  crowdAgainst: ["Away fans celebrate. Home fans check the rulebook.", "The away end goes up. The home end goes quiet."],
  refRed: ["The referee shows red and the stadium offers advice."],
  refVar: ["The referee jogs to the monitor and takes a long look."],
  replayGoal: ["REPLAY: the ball takes its time and finds the net.", "REPLAY: the same goal, from a flattering angle."],
  replayOdd: ["REPLAY: the ball does something the physics department will want to discuss."],
};
