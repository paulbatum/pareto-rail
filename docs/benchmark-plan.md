# Benchmark plan

raild's long-term goal: a minebench-style interactive benchmark where visitors play levels built by different models and agent scaffolds, rank them blind, and see results as a quality-vs-cost pareto curve (plus a personal pareto curve for visitors who rank enough pairs).

The first experiment is personal: **is multi-agent delegation a sweet spot for this task — roughly 95% of solo-frontier quality at roughly 35% of the cost?** The public site is a later phase that reuses the same data. This is a fun project that should yield interesting insights, not a scientific publication; compromises that favor an engaging experience are acceptable as long as the cost accounting and blinding stay honest.

## Decisions (locked)

- **Configs (3):**
  1. Fable solo
  2. GPT-5.6 solo
  3. Delegation: Fable plans and reviews, GPT-5.6 implements
- **Replicates:** themes serve as replicates. 3 themes × 3 configs = 9 runs. Every config gets the same 3 themes, giving one matched pair per theme for each config contrast.
- **No launch-week delay:** GPT-5.6 is used as soon as it's available; record exact model snapshot ids, not aliases.
- **One-shot runs:** no retries, no fix-it continuation. A run that fails the mechanical gates (`typecheck`, `build`, `check:scope`, `check:floor`) is a DNF: excluded from play, kept in the data, and amortized into the config's cost-per-published-level.
- **Cost metric:** list-price USD at run date, computed from token counts (in/out/cache). Raw tokens recorded too so results can be re-priced later. Multi-stage configs sum all stages, including planning and review.
- **v1 scope:** personal-first. Generation pipeline plus a minimal blind pairwise ranking mode for one person. Public site (votes, sessions, per-user pareto) comes later.
- **Blind play protocol:** same-theme pairs played back to back; the ranker decides how many plays before choosing. Rankings written down and timestamped before unblinding.
- **Contamination control:** every run branches from the frozen baseline commit, where the gallery contains only the hand-built levels. No run ever sees another entrant's level.
- **Anonymization:** finished levels get random slot ids assigned by script; the slot-to-config key file stays unopened until rankings are locked.

## Open items

Items 1–3 must be resolved before item 4 (the freeze). Items 5–6 do not block generation.

1. **Finalize the delegation recipe (verbatim).** What artifact Fable produces when planning (brief vs full design doc), the exact prompt the implementer receives, whether review is one pass with one revision round, continuation vs fresh session, and which harness runs each stage. The recipe is a benchmark subject; it goes in the run manifest.
2. **Author and freeze the 3 themes.** One or two sentences each, per the brief's Theme section. Decide who or what authors them, and check none favors an aesthetic the existing gallery already rewards.
3. **Decide cost capture per harness + manifest schema.** How token counts come out of each harness for every stage; fallback is one API key per run read from the vendor usage dashboard. Manifest fields: config id, model snapshot ids, recipe version, theme, tokens, USD, wall time, gate results, base commit, output branch.
4. **Pin the freeze commit (last).** Land any remaining engine/brief/docs changes first (including a pass over `docs/level-api-wishlist.md` and known brief ambiguities). After the pin, brief + engine + docs + gallery are the frozen prompt; any change means a benchmark v2.
5. **Write the pre-registered decision rule.** Needed before unblinding, not before generation. One sentence defining what result makes delegation the adopted workflow (e.g. "wins or ties ≥2 of 3 same-theme pairs vs Fable solo at <40% cost"), plus a definition of a tie.
6. **Decide the role of hand-built anchor levels (public phase).** Whether crystal etc. enter the public ranking pool as calibration anchors, shown as reference lines off the pareto curve (they have no honest cost coordinate). The personal blind phase is generated-vs-generated only.

## After the freeze

Not open questions yet, but planned work once items 1–4 close:

- **Runner script:** for each config × theme, fresh checkout of the pinned commit, launch the agent unattended, commit the result to a branch, emit the manifest, assign the anonymous slot id. Runs execute in the background/overnight; no log-tailing, no diff reading, mechanical merges only.
- **Blind ranking mode:** minimal UI to play same-theme pairs in random order and record choices with timestamps.
- **Analysis + unblinding:** compare recorded rankings against the decision rule, then open the key file.
