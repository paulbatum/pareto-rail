# 06 — Publish benchmark levels and evidence

## Objective

Make the public repository and deployed site useful for inspecting benchmark outputs, rollouts, costs, and rankings while excluding secrets and private controller material.

## Public artifacts

For each publishable run, provide stable links among:

- promoted level source;
- public run manifest;
- model and configuration identity;
- measured cost and timing;
- evaluated and payload commit ids;
- sanitized rollout or transcript;
- gate summary;
- ranking judgments and aggregate results; and
- the exact promoted application commit used by the site.

The normal level browser may expose this information directly. The ranking flow controls when it reveals the same information to a participant.

## Sanitization

Build a deterministic publication step rather than copying `benchmark/private/`.

It must reject or remove:

- credentials and authentication files;
- private session or dashboard URLs;
- absolute operator and temporary filesystem paths;
- unpublished schedule rows or mappings;
- environment variables and command output containing secrets;
- unrelated agent memory or harness configuration; and
- artifacts outside an explicit publication allowlist.

Do not silently redact content in a way that makes a rollout misleading. Record redaction locations and reasons, and fail when safe handling is ambiguous.

## Work

1. Define versioned public schemas for manifests, rollout metadata, and source/evidence links.
2. Add a publication command that consumes verified private records and emits only allowlisted public artifacts.
3. Sanitize rollout events while preserving chronology, prompts, tool calls, results, usage, timeout information, and terminal state where safe.
4. Validate every public commit and link before publication.
5. Generate the website's reveal catalog from public artifacts.
6. Ensure production builds omit source maps or metadata that unintentionally contains private paths unless explicitly intended and audited.
7. Provide a static build/deployment command for the ordinary browser and ranking experience.
8. Record the application commit and public artifact hashes used for each deployment.
9. Add an audit command that scans generated output for credentials, known private path prefixes, private schedule fields, and broken evidence links.
10. Document how later runs extend the public corpus without rewriting historical manifests or rankings.

## Repository policy

Public benchmark source and sanitized evidence are normal tracked repository content. Private raw records remain under `benchmark/private/` and must never be added wholesale.

Publishing identities does not invalidate the ranking interaction: participants are asked not to inspect them before judging, and the interface withholds them until reveal. Do not describe this as adversarial secrecy.

## Constraints

- Never publish directly from a live harness-home directory.
- Never mutate raw private evidence during sanitization.
- Never rewrite locked ranking records.
- Do not omit failed-run cost or infrastructure-failure provenance from published summaries.
- Keep public artifacts reproducible from private records plus recorded redaction policy.

## Verification

- Publication fixtures containing credentials, private URLs, paths, and schedule mappings are rejected or redacted as declared.
- Generated public artifacts validate against their schemas.
- Every reveal link resolves in the production build.
- No absolute local paths or known credential fields appear in generated site assets.
- Historical publication output remains byte-stable when no source record changed.
- `npm run typecheck`
- `npm run build`
- Run benchmark catalog, ranking, controller, and publication audit tests.

## Done when

The repository and deployed site openly expose benchmark levels and trustworthy evidence, while the ranking interface still provides per-comparison presentation blinding and no private controller material is published.
