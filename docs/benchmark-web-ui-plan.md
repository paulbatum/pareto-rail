# Pareto Rail web experience plan

## Purpose

Turn the existing rail shooter and benchmark machinery into a public experience where visitors can:

- play the polished Crystal Corridor reference level;
- blindly compare two one-shot model-generated levels built from the same theme;
- submit an Arena-style preference;
- immediately discover which model and workflow produced each level and what each run cost;
- build a personal quality-versus-cost view after several comparisons; and
- browse aggregate benchmark results without having to play.

The product name is **Pareto Rail**. The visual identity should combine the game's lock-on reticle with a set of targets arranged along a Pareto curve.

This plan covers product behavior, frontend architecture, anonymous data collection, benchmark integration, generated thumbnails, development fixtures, verification, and rollout. It does not change the generation protocol or implement the UI.

## Product principles

1. **Play first, explain in context.** Keep the landing page concise. Let Crystal demonstrate the game before explaining the benchmark in detail.
2. **Participation is optional.** Crystal is strongly recommended, not required. Ranking and leaderboard pages are always directly accessible.
3. **One decision at a time.** A benchmark round is always two levels from one theme followed by one clear vote. Do not introduce a growing tier-maker workflow.
4. **Blind before voting, satisfying afterward.** Hide model and workflow identities through the comparison, then reveal them immediately after submission.
5. **Fun presentation, honest methodology.** Use energetic game presentation and immediate feedback, but label sample sizes, costs, ties, DNFs, rehearsal data, and personal results accurately.
6. **Useful without playing.** The leaderboard and methodology should stand on their own for visitors who only want benchmark results.
7. **Do not weaken benchmark boundaries.** Public presentation must consume publishable benchmark records and opaque entrant identities. It must never expose private schedules, raw logs, credentials, or unpublished mappings.

## Information architecture

Use a small persistent navigation bar with these destinations:

- **Home** — concise introduction and the Crystal call to action.
- **Play** — Crystal and the ordinary level browser.
- **Rank** — the blind comparison flow.
- **Leaderboard** — aggregate results and the public Pareto chart.
- **About** — prompts, methodology, cost explanation, limitations, and project context.

Desktop navigation may use text labels. On narrow screens, collapse it into a compact menu while keeping Rank and Leaderboard one action away. Existing `?level=<id>` links should continue to work during migration; canonical product routes can wrap or translate them rather than breaking old links.

Recommended canonical routes:

```text
/                         Home
/play                     Play landing / level browser
/play/:levelId            Game shell
/rank                     Current or next comparison
/leaderboard              Aggregate results
/about                    Methodology and project information
```

The implementation may initially continue using query parameters internally if introducing full history-based routing would complicate static hosting. The visible navigation and browser back behavior must still be coherent.

## New-visitor journey

### Landing page

The landing page should use very little copy. Its first viewport should contain:

- the Pareto Rail wordmark and icon;
- one sentence explaining that models build one-shot rail-shooter levels and people play them blind;
- a primary **Play Crystal** action;
- a secondary **Rank model levels** action; and
- ordinary navigation including **Leaderboard**.

Crystal should be described as a polished, human-built reference used to teach level builders what good looks like. Avoid implying that it is itself a model entrant or a scored benchmark anchor.

A visitor may skip Crystal and enter ranking immediately. Browser storage may remember that Crystal has been played, but it must not gate any route or hide the option to replay it.

### Crystal completion or death

Both finishing Crystal and dying count as completing the introduction. When its run ends, augment the existing score panel with a short explanation:

- Crystal is a polished reference level;
- model entrants receive it as guidance through the repository and authoring material; and
- the visitor can now play blind one-shot outputs and help rank them.

Offer three actions:

1. **Rank model levels** — primary;
2. **Replay Crystal**; and
3. **Explore levels**.

Do not replace the level's score, rank, or replay behavior; add the benchmark invitation around the existing result.

## Comparison journey

### 1. Assignment

The system selects the theme and pair automatically. Automatic scheduling is important for useful coverage; users do not choose themes or entrants.

Before launching the first entrant, show:

- the theme title;
- a concise theme summary;
- an expandable **Read full prompt** section containing the verbatim theme prompt;
- a brief statement that both levels were generated independently from the same assignment; and
- a **Play Level A** action.

Do not show model, workflow, cost, source path, slot id, authored title, or any other identifying metadata before voting.

### 2. Play Level A

Launch the exact playable entrant assigned by the matchup. The comparison shell labels it **Level A** regardless of its internal title.

A run is considered played when it ends normally or the player dies. Record a play count only on `runend`; loading a level and leaving early does not qualify.

After the run:

- show the ordinary run result;
- offer **Play Level B** as the primary action; and
- permit replaying Level A.

### 3. Play Level B

Use the same behavior for Level B. Once both entrants have at least one completed or failed-by-death run, enable voting.

The player may replay either entrant any number of times before voting. Every completed replay increments that entrant's play count. Preserve the original A/B assignment and presentation order throughout the round.

### 4. Vote

Present the two entrants side by side using their generated four-frame thumbnail sheets. The voting controls are:

- **A is better**;
- **B is better**;
- **Both are good**; and
- **Both are bad**.

The first two are decisive preferences. The final two are relative ties with distinct absolute sentiment:

```text
A is better   -> relative outcome: A wins; sentiment: none
B is better   -> relative outcome: B wins; sentiment: none
Both are good -> relative outcome: tie; sentiment: positive
Both are bad  -> relative outcome: tie; sentiment: negative
```

This distinction matters. “Both are good” and “both are bad” must not become different ordinal outcomes, but the aggregate site may report their positive and negative sentiment separately.

Require both levels to have a play count of at least one. Make the four choices large, keyboard accessible, and usable without drag gestures. Ask for confirmation only if accidental taps prove to be a problem in testing; otherwise immediate response is preferable.

### 5. Reveal

Immediately after a successful submission, reveal for both A and B:

- model name and exact public snapshot label where available;
- workflow/configuration name, such as solo or delegated;
- measured generation cost for that run; and
- which choice the player made.

Keep the reveal concise and visual. A small expandable detail area may explain cost provenance and link to the methodology page. Do not expose raw logs, private session information, or unpublished configuration data.

The primary action is **Next matchup**. It advances to a different theme while there are themes the local participant has not yet seen in the current rotation.

### 6. Continued play

The scheduler follows this participant-facing policy:

1. Prefer a theme not yet seen in the participant's current rotation.
2. Within that theme, prefer an entrant pair the participant has not judged.
3. Prefer globally under-covered comparisons while maintaining a connected same-theme comparison graph.
4. Once every available theme has appeared, begin a new rotation using unseen entrants or unseen pairings from earlier themes.
5. Avoid presenting the exact same pair to the same browser unless it is deliberately scheduled as a repeat judgment.
6. Never schedule a DNF or an entrant that is not marked playable.

The backend, not the browser, makes the final assignment so global coverage can improve. Local history is supplied as a scheduling hint and the server validates its own constraints.

## Personal Pareto curve

After the third submitted comparison, introduce **Your Pareto curve** on the reveal screen and make it available from the Rank page. Before three comparisons, show lightweight progress such as “One more comparison unlocks your curve.”

This is a playful personal view, not the canonical benchmark result. Label it accordingly and show the comparison count.

### Personal quality signal

Use a deterministic online pairwise rating per revealed configuration:

- decisive choices score `1` for the preferred configuration and `0` for the other;
- both-good and both-bad choices score `0.5` for each in the relative rating;
- positive and negative tie sentiment is shown separately and does not alter relative ordering; and
- update ratings in submission order using one documented Elo-style display algorithm.

The benchmark plan already permits Elo as an online display layer while keeping it separate from canonical small-sample analysis. Store enough raw local history to recompute the display if the presentation algorithm changes; do not persist only the derived rating.

Plot each configuration the participant has encountered:

- **x-axis:** mean measured generation cost of the encountered runs for that configuration;
- **y-axis:** the participant's current display rating;
- **point label:** public model/workflow name after reveal; and
- **frontier:** configurations not dominated by another encountered configuration with both lower-or-equal cost and higher-or-equal personal rating.

Show all points and emphasize the frontier rather than hiding dominated points. With very few judgments, add a compact “early estimate” note instead of fake confidence intervals.

## Public leaderboard

The leaderboard must work for visitors who never launch WebGPU gameplay. It should be ordinary DOM content and should degrade gracefully on unsupported devices.

### Primary view

Lead with a quality-versus-cost scatter plot:

- x-axis: measured generation cost;
- y-axis: aggregate preference quality;
- one point per configuration or workflow;
- visible Pareto frontier;
- filters for benchmark release, theme, model family, and workflow; and
- sample counts in tooltips and detail panels.

Beside or below the chart, provide a sortable table containing:

- configuration/model and workflow;
- aggregate preference score;
- mean and range of generation cost;
- comparisons and unique participating browsers, reported with privacy-safe counting;
- both-good and both-bad rates;
- playable-run rate and DNF count; and
- themes represented.

### Methodology and caveats

Clearly separate:

- canonical locked benchmark rankings;
- ongoing public pairwise votes;
- excluded rehearsal data; and
- exploratory personal curves.

The initial public pairwise aggregate can use a documented Bradley–Terry or equivalent connected-comparison model, with ties handled explicitly. Do not silently treat each public vote as equivalent to the benchmark owner's locked ranked-set snapshot. Preserve and publish basic raw counts so the model output remains interpretable.

Use minimum-sample rules before ranking configurations prominently. Until those thresholds are met, show entries as provisional rather than suppressing them entirely.

The results page should also link to:

- the exact theme prompts;
- generation protocol and release information;
- cost measurement methodology;
- DNF/reliability explanation; and
- downloadable anonymized aggregate data when publication policy permits it.

## Anonymous identity and browser storage

There is no account system.

On first participation, generate a random browser participant id and store it locally. Browser storage holds:

- participant id;
- completed matchup ids and votes;
- play counts;
- current rotation/theme history;
- revealed entrant metadata already earned by voting;
- personal curve inputs; and
- an unfinished matchup so refreshes can resume safely.

Use a versioned storage envelope and migrations. If stored data is corrupt or from an incompatible development build, recover without blocking the rest of the site.

Explain in the privacy copy that clearing site data resets local history and the personal curve. Do not fingerprint users or attempt to recreate deleted identity.

## Submission API and persistence

Keep the frontend in Vite and strict TypeScript. Add a small TypeScript HTTP API with a relational database; keep the domain and request/response contracts independent of a particular serverless provider. Select the concrete host during implementation based on where the Vite site will be deployed.

The minimum API surface is:

```text
POST /api/matchups/next       Assign an opaque same-theme pair
POST /api/matchups/:id/play   Record a completed/death play for A or B
POST /api/matchups/:id/vote   Idempotently submit one of four verdicts
GET  /api/matchups/:id/reveal Return identities and costs only after a valid vote
GET  /api/leaderboard         Return aggregate public results
GET  /api/catalog/themes      Return public theme summaries and prompts
```

A matchup response before voting contains only what the client needs to play:

- opaque matchup id;
- benchmark version and theme public content;
- A/B presentation order;
- opaque playable references; and
- expiring submission capability or equivalent server validation data.

It must not contain model, workflow, cost, source branch, configuration id, or a client-decodable mapping to those values. This is practical non-adversarial blinding: browser-delivered code can be inspected by a determined visitor, but the normal interface and API must not reveal answers early.

### Vote record

Create a public-comparison record rather than forcing crowd votes into the existing canonical `ranked-set` schema. A record should include:

- schema version;
- benchmark version;
- matchup id and same-theme pair ids;
- A/B presentation order;
- participant id stored as a server-side salted hash or pseudonymous internal id;
- play counts for each entrant;
- relative verdict (`a`, `b`, or `tie`);
- optional tie sentiment (`positive` or `negative`);
- client and server timestamps;
- development/rehearsal/eligible data class; and
- idempotency key.

Do not accept model identities, costs, or arbitrary slot ids from the browser as authoritative. Resolve them from the server-owned matchup.

### Integrity and abuse controls

The initial system does not need heavyweight anti-cheat, but it should include:

- server-issued matchup ids;
- one canonical vote per participant and matchup;
- idempotent retries;
- validation that both entrants have recorded play completions;
- basic rate limiting;
- strict payload limits;
- same-origin protections and narrow CORS policy;
- no DNF assignment;
- separation of rehearsal votes from eligible public results; and
- aggregate monitoring for obviously automated or malformed traffic.

Preserve raw append-only votes. Corrections should create explicit administrative exclusions or derived-data rebuilds rather than rewriting history invisibly.

## Benchmark catalog and blinding boundary

Introduce a generated public catalog that joins only publishable material needed by the web experience:

- benchmark version;
- public theme text;
- opaque entrant/playable id;
- playability status;
- generated thumbnail path;
- reveal-only configuration/model/workflow labels;
- reveal-only cost; and
- public manifest references.

Generate it from redacted manifests and integrated level metadata after the relevant ranking snapshot is locked and unblinded. Never generate it from `benchmark/private/` in a production build.

Keep pre-vote and reveal metadata as separate server projections even if they originate in one protected database row. This reduces accidental identity leaks in API responses and frontend bundles.

The existing benchmark owner's ranked-set and pairwise files remain immutable protocol artifacts. Public web votes are additional evidence and must not overwrite, masquerade as, or automatically lock those records.

## Four-frame entrant thumbnails

Use the existing gameplay snapshot generator to create one contact sheet per playable entrant. The default command shape is:

```sh
npm run snapshot:gameplay -- --level <level-id> --thumbnails 4
```

The production asset task should make output deterministic:

- fixed seed;
- four evenly sampled run times;
- immortal capture mode;
- projectiles hidden unless later visual review establishes that they improve recognition;
- fixed source and thumbnail dimensions;
- recorded fidelity mode; and
- output named by opaque entrant id rather than model or workflow.

Generate thumbnails from the exact evaluated playable revision when preparing a blind benchmark deployment. For already integrated and unblinded levels, record the source commit used. Add a manifest containing the source entrant, times, seed, fidelity, command version, output hash, and dimensions.

These PNGs are generated website presentation artifacts, not authored level textures. Do not load them into the Three.js game scene or allow agents to treat them as level assets.

Before voting, thumbnails may appear only as Level A and Level B comparison aids after each entrant has been played. Do not expose a browseable entrant gallery that lets recognizable cards carry model reputations into blind rounds.

## Development and rehearsal mode

Downpour rehearsal outputs are retained under the ignored `benchmark/private/` directory for provenance and inspection. They are not discovered by the application catalog, exposed by the Rank page, or included in player-facing comparisons. The failed `downpour-xgz7` output is retained there alongside the five promoted rehearsal outputs, but remains non-playable.

Any future development fixture must be explicitly separate from the application level catalog and must be impossible to enter eligible production aggregates. Production builds must exclude rehearsal pairings by construction, not merely hide them with CSS.

## Frontend architecture

Keep the website shell separate from level-owned behavior. The React entrypoint owns route composition, while the imperative game runtime remains a mountable view.

Current seams:

```text
src/main.tsx             React entrypoint
src/app/                 Route handling, layout, pages, components, and benchmark controller
src/game/                WebGPU game runtime and mount/disposal bridge
src/benchmark/           Matchup state machine, API client, local history, scoring
src/ui/                  Shared DOM components and current game HUD/pause UI
src/levels/              Unchanged independent level modules and registry
```

The game view should accept launch context such as ordinary play, Crystal introduction, or benchmark A/B assignment. It should report `runend` to the owning page without changing each level implementation. A benchmark wrapper listens to the shared event bus and records completion or death.

Model comparison should use an explicit state machine:

```text
assignment
-> playing-a
-> a-complete
-> playing-b
-> ready-to-vote
-> submitting
-> reveal
-> next-assignment
```

Replay transitions return from `a-complete`, `ready-to-vote`, or reveal-before-next only where allowed, while preserving play counts. Persist state after every transition so refresh and navigation do not invent extra votes.

Keep benchmark-specific controls outside `Hud`. The HUD remains game-focused; page-level overlays own benchmark progression, voting, and reveal.

## Visual direction

Pareto Rail should feel like a polished game interface presenting real experimental results, not an academic dashboard pasted over a game.

Use:

- the existing dark field, restrained bloom, cyan lock language, and high-contrast panels as a starting point;
- a Pareto curve formed by small target nodes, with selected frontier nodes receiving lock brackets;
- clearer proportional typography for explanatory and data-heavy pages while retaining the monospace display face for game labels and metrics;
- subtle chart motion that resolves points into the frontier after a reveal;
- entrant thumbnail sheets as tactile comparison cards; and
- color that communicates interaction and frontier status, not model identity.

Avoid:

- long introductory copy;
- fake laboratory language;
- model-brand colors during blind play;
- excessive CRT effects over leaderboard text;
- presenting tiny samples with false precision; and
- exposing internal benchmark vocabulary without plain-language explanations.

Respect reduced-motion settings. All charts and votes need keyboard and screen-reader alternatives. Dragging is not part of the comparison interaction.

## Unsupported devices and responsive behavior

The home, leaderboard, reveal history, prompts, and About page should work without WebGPU. Only launching a level requires WebGPU.

If WebGPU is unavailable:

- keep site navigation and results visible;
- explain that gameplay needs a recent compatible browser;
- allow browsing themes, methodology, and leaderboard; and
- do not allow a blind vote based only on thumbnails.

Prioritize desktop mouse gameplay initially, but make all website controls responsive and touch-friendly. Preserve the existing in-world reticle behavior only while the game canvas owns input; restore a normal cursor on website pages and overlays.

## Delivery phases

### Phase 1: Product shell and game mounting

- Rename visible product metadata to Pareto Rail.
- Add the icon and basic navigation.
- Introduce Home, Play, Rank, Leaderboard, and About page shells.
- Adapt the current game bootstrap into a mountable route/view.
- Preserve direct level links, pause settings, WebGPU checks, and ordinary level picking.
- Add the Crystal post-run invitation.

Done when a visitor can navigate the site, play Crystal, die or finish, and return to normal pages without a full-page state failure.

### Phase 2: Local comparison state machine

- Define public comparison and catalog TypeScript types.
- Implement assignment-to-reveal UI against fixture data.
- Add A/B game launch context and `runend` completion reporting.
- Add replay and play-count behavior.
- Add four Arena-style voting controls.
- Add immediate reveal cards.
- Persist unfinished and completed local history.

Done when all five Downpour rehearsals can be compared through the real development flow without manually using the level picker.

### Phase 3: Thumbnail and catalog pipeline

- Add deterministic four-frame thumbnail generation.
- Generate rehearsal assets and manifests.
- Build separate pre-vote and reveal catalog projections.
- Validate playability, eligibility class, missing assets, and accidental identity leakage.
- Document the tool in the appropriate visual/benchmark authoring documentation.

Done when every scheduled development entrant has a reproducible card and production catalog validation rejects rehearsal leakage.

### Phase 4: Anonymous backend

- Implement matchup assignment, play completion, vote, reveal, and catalog endpoints.
- Add relational schema and migrations.
- Add anonymous participant pseudonyms, idempotency, rate limiting, and data-class separation.
- Connect the frontend while retaining a fixture adapter for tests.
- Add operational logging that contains no private benchmark records or credentials.

Done when two browsers receive coverage-aware matchups, submit anonymous votes safely, and cannot retrieve reveal metadata before voting.

### Phase 5: Personal curve

- Implement deterministic local pairwise ratings from raw history.
- Show unlock progress before three comparisons.
- Add the personal cost-versus-rating plot and frontier after three.
- Show sample counts and early-estimate language.
- Recompute entirely from stored raw history in tests.

Done when decisive votes and both tie sentiments update the intended local display without changing canonical server records.

### Phase 6: Public leaderboard

- Build aggregate jobs or queries from append-only votes and published manifests.
- Add the public quality-versus-cost chart, frontier, table, filters, and provisional states.
- Show absolute good/bad sentiment separately from relative preference.
- Include reliability/DNF information and canonical benchmark snapshots.
- Add methodology and downloadable aggregate data links.

Done when a non-WebGPU visitor can understand what was tested, how configurations compare, what they cost, and how much evidence supports each point.

### Phase 7: Production benchmark integration and polish

- Generate the eligible public catalog only after benchmark locking and authorized unblinding.
- Deploy exact playable evaluated entrants or verify any integrated equivalent against manifests.
- Run responsive, accessibility, browser, and real-hardware WebGPU playtests.
- Tune copy, reveal pacing, chart readability, and scheduler coverage.
- Add privacy and data-retention documentation.

Done when rehearsal entries are absent from production, eligible identities stay hidden until each vote, submissions populate the correct aggregate, and all benchmark provenance links resolve.

## Testing and verification

### Unit tests

Cover:

- comparison state transitions and invalid transitions;
- death and normal completion both satisfying play requirements;
- replay play counts;
- all four verdict mappings;
- local storage migration and recovery;
- personal rating recomputation and Pareto-front calculation;
- theme rotation and unseen-pair selection;
- production exclusion of rehearsal/DNF entrants;
- pre-vote response redaction; and
- idempotent vote submission.

### Integration tests

Exercise:

- landing -> skip Crystal -> rank;
- landing -> Crystal -> death -> invitation -> rank;
- A -> B -> replay A -> vote -> reveal -> next theme;
- refresh during each comparison state;
- duplicate vote/network retry;
- reveal request before voting;
- three votes unlocking the personal curve;
- exhausting all fixture themes and returning to unseen earlier-theme pairs;
- unsupported WebGPU navigation to leaderboard; and
- development votes remaining outside eligible aggregates.

### Repository checks

Every implementation phase must continue to pass:

```sh
npm run typecheck
npm run build
npm run test:benchmark-controller
```

Add focused frontend/API tests and a production-catalog validation command. Changes to benchmark tooling or generated gameplay assets must update the relevant docs. Visual verification still requires a real WebGPU playtest per the repository guidance.

## Documentation changes during implementation

Keep documentation responsibilities separated:

- `README.md` — short human introduction and how to run Pareto Rail;
- `AGENTS.md` — only durable architecture and verification guidance;
- `docs/benchmark-plan.md` — generation and canonical judgment protocol, not web layout details;
- this document — public web product and delivery plan;
- `docs/visual-tools.md` — deterministic comparison-thumbnail command;
- benchmark controller/ranking docs — public catalog/export boundary where it affects protocol handling; and
- `docs/privacy.md` or equivalent — anonymous identifier, submitted vote, retention, and deletion behavior before public launch.

## Decisions fixed by this plan

- Pareto Rail is the product name.
- Crystal is recommended but skippable.
- Basic navigation always exposes ranking and leaderboard pages.
- Themes and pairs are assigned automatically.
- Every comparison contains exactly two same-theme playable entrants.
- Dying counts as playing a level.
- Either entrant may be replayed before voting.
- Votes are A better, B better, both good, or both bad.
- Model, workflow, and cost are revealed immediately after voting.
- The next matchup prefers a new theme, then returns to unseen earlier-theme entrants/pairs after theme exhaustion.
- There are no user accounts.
- Local browser history powers resumption and the personal view.
- Anonymous votes are submitted to a backend for aggregate results.
- The personal Pareto curve appears after three comparisons.
- Rehearsal outputs remain private and excluded from development comparison mode.
- Four-frame generated gameplay sheets are used as comparison cards.

## Deferred implementation choices

Resolve these during the relevant phase without reopening the product flow:

- concrete API/database hosting provider;
- exact public aggregate model and minimum-sample thresholds;
- exact online rating constants used only for the personal display;
- data-retention and participant deletion mechanism;
- whether production playables are served from evaluated commits, isolated bundles, or verified integrated payloads;
- final route implementation for static-host compatibility; and
- final icon geometry, typography, and motion treatment after visual prototypes.
