# Eternal Draw FC

A football management comedy. Eternal Draw FC cannot win or lose. FC Doomed cannot avoid defeat.
The rest of the league plays normally, and the media has opinions.

## Run it

    npm install
    npm run dev        # opens at http://localhost:5173
    npm test           # 90+ tests: engine, curses, narrative, controller, screens
    npm run build      # production build in dist/
    npm run preview    # serve the production build

Needs Node 20 or newer. The Anton and Source Serif fonts load from Google Fonts; offline, the browser
falls back to Impact/Georgia and everything still works.

## Playing

- Pick a club, hit **Play matchday**. Your match plays out on the 2D pitch from the real event timeline:
  goals, saves, cards, VAR moments, commentary, fan reactions and bench/crowd/ref/replay cutaways.
  Use Replay, Skip to result, and the 1x/2x/4x speed buttons.
- Two divisions of 12, 22 matchdays. Bottom 3 of Division 1 swap with the top 3 of Division 2.
  Bottom 3 of Division 2 leave the league. If that is your club, your career ends.
- The game autosaves to IndexedDB after every matchday. Career tab: export or import a save file.
- Layout is responsive: bottom tab bar on phones, side rail and two-column screens on wide displays.

## Code map

    src/engine     RNG streams, fixtures, league table, match timelines, season rollover, playFixture
    src/curses     curse registry, Equilibrium and Fall, conflict resolver, timeline rewriter, legend rule
    src/derive     streaks, milestones, zones, rivalries, achievements
    src/narrative  news, fan posts, commentary, cutaway cues (text lives in templates.ts)
    src/game       world builder (names, squads, clubs) and the Game controller the UI talks to
    src/ui         React screens, the match playback engine, IndexedDB storage
    tests          Vitest suites

Rules the engine keeps (and tests check): the event log is the source of truth, narrative never changes a
result, same seed gives the same season, a curse result always passes the same validator as a normal match.

## Known gaps

- The Doomed fixture is never played yet. `unlockLegend(state)` in `src/curses/definitions.ts` is the hook for
  whatever the break condition turns out to be.
- Formations are visual only; they do not change match odds yet.
- No transfers, finances, injuries or tactics screens yet.
- Saves grow by a few MB per season. IndexedDB copes, but a compaction step is worth adding.
