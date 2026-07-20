# v2 baseline contamination

## Record

Benchmark v2's entrant baseline was intended to expose the hand-built levels in `src/levels/` and the shared application needed to run them. It instead pointed at an ordinary main commit containing the twelve previously promoted benchmark levels under `src/benchmark-levels/`, their public level content, and the tracked `benchmark/` tree. All twenty completed v2 runs with entrant baseline `5305d890067cc4fab5063e27dfb3d424e3df1982` saw that tree.

The v1 clean-baseline procedure and its launch-time allowlist guard were removed during the v2 controller refactor without replacement. The v2 plan subsequently pinned the ordinary main commit as `entrantBaseline`.

## Audit

`npm run benchmark:contamination` was run against the retained transcripts. It is a heuristic, transcript-based audit of recorded tool calls, so it establishes evidence of reads, listings, or copies rather than proving that no unrecorded access occurred.

The per-theme behavior classes were:

- Broadside had six entrants with cross-theme benchmark listings or content reads and one entrant with no finding.
- Strandline had cross-theme benchmark listings or content reads for all seven entrants.
- Mass-driver detailed had three entrants with same-theme contamination, two listings-only results, and one result with no finding.

The three same-theme mass-driver entrants are disqualified. `sol-high-mdd-m4gp` copied `mass-driver-wo4m` wholesale; `fable-high-mdd-m3rp` made fourteen content reads of `mass-driver-wo4m`; and `sol-b20-mdd-m7hq` read content from four prior mass-driver levels. Older `outside-worktree` findings in the audit output were not used as evidence because they include known parser false positives.

The other entrants remain retained. Cross-theme reads are equivalent in kind to the sanctioned built-in reference material, rather than reuse of another entrant for the assigned theme, and this behavior was near-universal across the round. The within-theme comparisons therefore remain usable with that exposure caveat.

## Actions

The three runs are marked disqualified and will be rerun under fresh slots: `sol-high-mdd-v3qf`, `fable-high-mdd-k4wz`, and `sol-b20-mdd-p8jn`. The reruns deliberately reuse v2's original entrant baseline, including the benchmark levels, to preserve within-round comparability; each is subject to the round's promotion-time contamination audit. The v1-to-v2 configuration comparison carries a baseline-exposure caveat because v1 used the scrubbed procedure and v2 did not. Scrubbed entrant baselines and their launch guard begin with the next series.
