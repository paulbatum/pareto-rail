# 06 — Publish benchmark levels and evidence

## Objective

Make the public repository and deployed site useful for inspecting benchmark outputs, rollouts, costs, and rankings — without publishing secrets or private controller material.

## Public artifacts

For each publishable run, link together: the promoted level source, the public run manifest, model/configuration identity, measured cost and timing, the sanitized rollout, the gate summary, and any ranking judgments. The level browser may show all of this openly; the ranking flow controls when it reveals it to a participant.

## Sanitization

Add a publication step that reads verified private records and emits only allowlisted public artifacts — never copy `benchmark/private/` wholesale. It must strip or reject:

- credentials and authentication material;
- private session/dashboard URLs and absolute local filesystem paths;
- unpublished schedule mappings;
- anything not on the publication allowlist.

When it redacts something, note where and why so the rollout isn't silently misleading. When it's unsure whether something is safe, fail and say so rather than guessing.

## Work

1. Define simple public schemas for manifests, rollout metadata, and evidence links.
2. Add the publication command described above; keep it deterministic so re-running on unchanged records produces the same output.
3. Generate the site's reveal catalog from the public artifacts.
4. Provide a static build/deployment command for the browser and ranking experience; check production builds don't leak private paths via source maps or similar.
5. Add a quick audit check that scans generated output for credential patterns, known private path prefixes, and broken evidence links.
6. Document how later runs extend the public corpus without rewriting what's already published.

## Constraints

- Never publish directly from a live harness-home directory, and never mutate the raw private records.
- Don't rewrite locked ranking records or published manifests.
- Include failed-run costs and infrastructure-failure provenance in published summaries — don't curate failures away.

## Verification

- Fixtures containing credentials, private URLs, local paths, and schedule mappings are stripped or rejected as declared.
- Public artifacts validate against their schemas and every reveal link resolves in the production build.
- The audit check passes on generated site assets.
- `npm run typecheck` and `npm run build`

## Done when

The repo and site openly expose benchmark levels and trustworthy evidence, ranking still blinds per-comparison, and nothing private is published.
