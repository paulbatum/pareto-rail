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

The three runs are marked disqualified and will be rerun under fresh slots: `sol-high-mdd-v3qf`, `fable-high-mdd-k4wz`, and `sol-b20-mdd-p8jn`. The reruns use a derived baseline — the frozen v2 baseline with the prior mass-driver levels removed — recorded on `benchmark-baseline-v2-mdd-reruns`; cross-theme benchmark levels remain as the shared reference pool. Each rerun remains subject to the promotion-time contamination audit. The v1-to-v2 configuration comparison carries a baseline-exposure caveat because v1 used the scrubbed procedure and v2 did not. Scrubbed entrant baselines and their launch guard begin with the next series; the `baselinePolicy`, `benchmark:cut-baseline`, and launch-guard controls now exist for that handoff.

## Reruns

The derived baseline removed the prior mass-driver source directories but not every reference to them. Their entries survived in the generated level gallery — the document the assignment directs every entrant to read in full — along with the analysis dossier for `mass-driver-wo4m` under `benchmark/analysis/`, and their names in the rank catalog and the public pages. The gallery is now generated from built-in levels only, so a promoted level no longer publishes a design summary into entrant reading material.

The removal was also routed around rather than defeated: the three reruns overlapped in time and their checkouts under `/tmp` were mutually readable. `sol-high-mdd-v3qf` found `mass-driver-wo4m` in full inside a sibling run's checkout, copied all fourteen of its source files through a `sed` rename, and shipped the result. It is disqualified. Entrant checkouts need isolation from each other, not only from the repository.

`fable-high-mdd-k4wz` and `sol-b20-mdd-p8jn` stayed inside their own checkouts and read no same-family source. Their exposure is the gallery's prose descriptions of seven prior mass-driver levels, whose file pointers they could not follow. Both are retained and promoted with that caveat recorded.

`sol-high-mdd-uk78`, the replacement for the disqualified `sol-high-mdd-v3qf`, ran under the entrant filesystem sandbox this incident called for: sibling checkouts, the primary repository, and the host `/tmp` were absent from its mount namespace, closing the v3qf read path by construction. Its audit shows no web events and no same-family exposure — no mass-driver source existed anywhere it could reach. It read cross-theme published levels retained in the open-policy baseline (`skyhook-snxd` in depth, `hull-run-ns5n` audio), equivalent in kind to the exposure of the retained entrants above. Operator verdict: retained and promoted with that caveat recorded.
