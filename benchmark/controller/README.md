# Benchmark controller operations

`scripts/benchmark/run.mjs` is the benchmark pipeline. This page tells an operator which command to run and what to do when one fails. For the wider picture of what the benchmark is, see `benchmark/README.md`.

## Running a run

```sh
npm run benchmark:run -- --plan benchmark/private/v2-plan.json --run <runId>
```

This executes one plan row end to end: it creates an isolated entrant checkout containing exactly the baseline commit, renders the assignment prompt from the theme text and the level id, launches the recipe's stage in an isolated per-run harness home, seals the entrant's work as one evaluated commit, runs the four gates against that commit (`npm run typecheck`, `npm run build`, the benchmark scope check, and `npm run check:floor`), derives the mergeable payload for a passing entrant, measures cost with ccusage, and writes a manifest. Every step is checkpointed under `benchmark/private/runs/<runId>/`, so an interrupted run resumes without repeating completed work. The controller repository must be clean before a new run starts.

## The plan file

A plan is a hand-edited JSON file — private, because its rows carry the level-to-configuration mapping. `run.mjs` validates this shape:

```json
{
  "benchmarkVersion": "v2",
  "baselinePolicy": "scrubbed",
  "materialsCommit": "<commit>",
  "entrantBaseline": "<commit>",
  "runs": [
    {
      "runId": "<opaque-id>",
      "slotId": "<opaque-slot>",
      "levelId": "<themeId>-<slotId>",
      "themeId": "<theme-id>",
      "themePath": "benchmark/themes/<theme-id>.md",
      "configurationId": "<configuration-id>",
      "recipePath": "benchmark/recipes/<recipe>.md",
      "kind": "benchmark",
      "entrantBaseline": "<optional commit override>",
      "stage": {
        "adapter": "codex-cli",
        "model": "<exact-model>",
        "effort": "high",
        "timeoutSeconds": 10800,
        "provider": "<pi provider, optional>",
        "budget": { "usd": 20 }
      },
      "delegation": {
        "promptPath": "benchmark/prompts/flexible-delegation.md",
        "delegateModel": "<model>",
        "delegateEffort": "high"
      }
    }
  ]
}
```

`baselinePolicy` is required. New series use `scrubbed`: entrants receive the built-in levels and shared application only. `open` exists to record the historical v2 condition; every v2 row runs under `open` and remains unchanged, with the recorded baseline guard and promotion-time contamination audits as its controls. `materialsCommit` and `entrantBaseline` pin the run: inputs are read from the materials commit and their hashes recorded in the manifest, and the entrant checkout is that baseline. A row may optionally set its own `entrantBaseline` to use a variant of the round's frozen baseline, such as one with same-family theme levels removed. Otherwise it inherits the plan baseline. Per row, `levelId` must equal `<themeId>-<slotId>`; the level title comes from the theme file's level-one heading, not the plan. `stage.adapter` is `codex-cli`, `claude-cli`, or `pi-cli`; `provider` and `budget` are optional and `budget` calibrates effort through the harness's spend notices. A Codex row may set `stage.networkAccess` explicitly; when omitted it defaults to `false` for a scrubbed plan and `true` for the historical open policy. `delegation` is optional and turns the stage into a planner/reviewer over a cheaper implementer. `kind` defaults to `benchmark`; a `rehearsal` row runs the identical pipeline but never enters the results pool, the catalog, or promotion.

Before launching any row, the runner checks the declared baseline's git tree. `src/benchmark-levels/` may contain only the four empty-catalog scaffold files required by the built-in registry, `benchmark/` must be absent, and `public/level-content/` may contain only ids registered in that baseline's own `src/levels/index.ts`. The generated gallery and rank catalog must also be reduced to built-in content. The policy decides the consequence: under `scrubbed`, violations name the offending paths, direct the operator to `benchmark:cut-baseline`, and abort; under `open` they are printed and carried into the manifest's `baseline.guard` without blocking, so the record states what the entrant could reach. The check runs before the entrant worktree checkpoint. A plan without `baselinePolicy` is invalid.

Blindness is a discipline, not a lock. Slot ids are assigned randomly when the plan is expanded, so authoring the plan does not reveal the level-to-configuration mapping; the owner does not open the plan file before voting through the site; and the operator surfaces below stay blind by default.

## Cutting a baseline

Cut the next series' baseline from the source commit that contains that series' shared application and built-in levels:

```sh
npm run benchmark:cut-baseline -- --source <commit-ish> --branch <branch-name>
```

The tool creates the branch in an isolated temporary worktree, removes promoted benchmark source and records, removes non-built-in public content, regenerates the gallery, empties the benchmark rank catalog, commits the result with the source commit in its message, and runs `npm run typecheck` and `npm run build` in that scrubbed checkout. It prints the resulting commit and branch. Do not cut a baseline during v2; v2 deliberately continues from its original open baseline.

The four files under `src/benchmark-levels/` are retained because `src/levels/index.ts` imports the benchmark catalog even when Vite discovers no benchmark entries. No entrant level or test fixture is retained.

## Network isolation groundwork

The next series intends to run entrant shells with network isolation wherever the harness enforces it. Codex is recipe-controlled and defaults to `network_access=false` for scrubbed plans; the adapter implements that as loopback-only isolation rather than a disabled network, because fully disabling network in the Codex sandbox blocks even loopback binds (`listen EPERM` on `127.0.0.1`), which the floor check and snapshot tooling depend on. Under `--network-access false` the adapter enables Codex's managed `network_proxy` mode with `allow_local_binding=true` — verified: Vite binds, loopback fetches succeed, and external DNS, curl, and `git ls-remote` are all denied — and steers Puppeteer to `chrome-headless-shell` via `PUPPETEER_EXECUTABLE_PATH`, because that mode's Linux seccomp filter denies unix-socket creation, which full Chrome requires at startup but the headless shell never performs. The shell is a one-time host install (the adapter prints the install command if it is missing). All four gates pass under this profile. Claude Code still requires a sandbox rehearsal before adoption because its current `bypassPermissions` mode has no network boundary. pi's `--offline` suppresses startup calls but cannot enforce isolation, so the contamination audit's web-event extraction remains per-run evidence; its web checks must not be removed or weakened. v2 Codex recipes and runs stay on their existing `network_access=true` behavior under `open` policy.

## Resume and recovery

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<runId>
```

Resume validates existing artifacts and continues at the first unfinished step. A stage that exited non-zero is not accepted on its own; if the harness timed out after the entrant had finished its worktree, verify that condition and then resume with `--accept-stage-output true` to accept the worktree and proceed to sealing and gates. For an interrupted pi process, an operator can instead issue the one-off same-session recovery `npm run benchmark:run -- --resume benchmark/private/runs/<runId> --continue-stage true`. This is pi-only and covers interruptions before the quota-wait extension, reboots, and timeouts during a quota wait; each recovery window writes round-suffixed records such as `events-resume-<n>.jsonl`. The continuation prompt is: `Your previous session was interrupted. You have been resumed in the same session; continue the assignment from where you left off and finish it per the original instructions.` The process is not resumed by the controller again automatically. Whenever a step fails after the worktree exists, the runner snapshots tracked and untracked source to a durable `refs/benchmark-recovery/<run-id>/...` ref; if the temporary worktree later disappears, resume reconstructs it from that ref before continuing. Sibling runs of one theme are pre-checked to share identical theme text and assignment template — the inputs every entrant on a theme must receive alike — so a misrendered prompt (a wrong path or a stale `materialsCommit`) is caught before an expensive stage launches. The per-run level id and the budget flag are deliberately excluded: they vary between siblings by design (a unique opaque id; `-high` versus `-b20`), so multiple configurations, budgeted and not, can run on one theme concurrently.

## Failure policy

Infrastructure failure: fix it, rerun, and keep and report the cost of every attempt. Model failure — a gate fails on the sealed output — is a DNF, shown as such. The operator classifies which one it was and records the decision as a free-text note in the run record.

Two transient infrastructure failures recur on the Claude Code stage and are cleared by a fresh attempt, not a resume (a resume would continue on the half-built worktree and contaminate the entrant). The first is `Failed to authenticate: OAuth session expired and could not be refreshed`: the stage runs against a copy of the operator credential in its isolated home, and an operator Claude session running alongside the benchmark can rotate the shared refresh token out from under that copy, so a stage started with a near-expired token cannot refresh. The second is `API Error: Stream idle timeout - no chunks received`, a mid-stage stall of the streaming response. For either, archive the failed run, delete its worktree, and relaunch the same runId fresh. The OAuth race is intermittent; if it keeps recurring, re-login on the operator account (`claude`, interactive) to refresh the stored token before launching more Claude stages.

Moonshot's `kimi-coding` provider can end a pi stage with a final assistant error containing `access_terminated_error` (or `403` and `usage limit`) when its subscription quota window is exhausted. The controller-owned quota-wait extension handles this in-process for `kimi-coding` stages. If the stage process dies anyway — timeout during a wait, the extension's wait cap, a reboot — do not relaunch fresh: resume the same session with `--continue-stage true` (see Resume and recovery), which preserves all entrant work. Before issuing it, check `ps` for a live controller or adapter process on that run: a resume may already be in flight from an earlier operator session, and a second launch against the same worktree would corrupt the entrant.

## Watching a live pi stage

The stage's retained `events.jsonl` flushes lazily — half an hour with no file is normal, not a hang. The continuous liveness signal is pi's native session transcript under the run's `harness-home/sessions/`, which grows with every model turn; a transcript that stops growing with no new `quota-wait/quota-waits.jsonl` entry is the actual stall signature. To test whether a capped quota window has refreshed without touching the run, issue a trivial one-word pi call against the same provider from a scratch home: it fails instantly at zero cost while capped and succeeds on refresh. Its 403 arrives on stdout while auth-refresh chatter goes to stderr, so capture both streams when scripting the probe.

## Regate

Gates are deterministic against the sealed commit, so a gate-tooling fix never re-runs generation. Move the run's `gates/` directory aside and resume; the disposition is recomputed from the refreshed gate records at the current controller commit.

## Inspecting and managing runs

```sh
npm run benchmark:status
npm run benchmark:results
npm run benchmark:manage -- status
```

`benchmark:status` is the first stop: it joins every plan file under `benchmark/private/` and any run schedule to the executed artifacts (live and archived) and answers what is left, splitting runs into pending, needs-promotion, and ran. `benchmark:results` then gives the per-run-artifact detail for the live directory — lifecycle state, gates, timing, cost, manifest completeness — with run ids and dispositions only. All three take `--unblind` to reveal configuration and model identities; use it only after you have voted. `benchmark:manage` also offers `archive-dnf`, `unarchive`, and `prune` (a strictly verified, doubly confirmed removal of a run's temporary worktrees that preserves every branch and commit).

## Promotion

```sh
npm run benchmark:promote -- --run <run-id>
```

Promotion takes a playable benchmark run, validates its manifest, gates, and refs, materializes the payload under `src/benchmark-levels/<id>/`, runs the four checks, and records a separate commit. Before promoting, execute `npm run benchmark:contamination -- --run <runId> --json`, review every `web` event against the entrant's output for plausible reuse of external level material, and record the reviewer's verdict in the promotion decision. A `web-self-lookup` or any other violation blocks promotion pending operator review. Between materializing the payload and checking it, promotion re-encodes any PNG under the level's `public/level-content/<id>/` to AVIF, rewrites the matching `contentImages` paths, and records each conversion with both hashes in `promotion.json`, so entrant PNGs never enter a mainline commit and a resumed promotion re-verifies the conversion rather than repeating it. It holds a lock, checkpoints its progress in `promotion.json`, and never edits the run manifest or its disposition. `benchmark:manage -- status` reports a playable run that has not been promoted as pending — or a failed attempt as failed — and prints this command.

## Publishing the catalog

```sh
npm run benchmark:export-rank-catalog
```

This projects the publication manifest — `benchmark/private/publication.json`, the hand-edited list of published themes and entrants — into the checked-in `src/benchmark/rank-catalog.json`. Each theme entry declares its `acceptedBaselines`; the export fails on any live entrant whose run manifest records a different entrant baseline. Themes and entrants carry an optional `retired` flag, and a theme may carry an `experimental` flag: retired items stay published as history and experimental themes are published for play before they are ranked, but neither ever enters matchup scheduling. After refreshing the catalog, run `npm run test:benchmark-domain`, `npm run test:benchmark-catalog`, `npm run typecheck`, and `npm run build`.

A configuration reaches the catalog through two separate gates in `scripts/benchmark/export-rank-catalog.mjs`, and a new configuration must be added to both to publish. First, a global entry in the public-label registry (`configurationLabels`): its display `modelName`, a `workflowName`, the `primaryModel`, `effort`, and a one-sentence `workflowSummary` (delegated configs add `delegateModel`/`delegateEffort`). This is identity only — it is revealed after a vote and groups results by configuration, and it does not weaken blindness, since the level-to-configuration mapping stays in the private plan. A budgeted (`-b20`) variant is its own configuration id and its own entry; encode the budget in the `workflowName` (e.g. `solo, $20 budget`) so it reads distinctly from its unbudgeted sibling. Second, the configuration id must be listed in `PUBLISHED_CONFIGURATIONS`, the publication scope. Keeping identity separate from scope means labeling a configuration never publishes it on its own. A configuration missing either gate is warned and withheld; its levels never enter the pool. Retired entrants with a run manifest publish from it like any other; one whose run predates current tooling falls back to its retained catalog record. Unpromoted rows stay out of the catalog until their payloads are promoted, without hiding the rest of their theme. Each published level must also carry a `contentImages.hero` in its descriptor, or the export fails on it.

```sh
npm run benchmark:export-provenance
```

This copies each published run's public provenance from the gitignored `benchmark/private/runs/<runId>/` into the checked-in `benchmark/manifests/<runId>/`, driven by the same publication manifest. It copies an allowlisted subset — the run manifest and definition, the rendered assignment and its inputs, payload and evaluation records, gate and promotion-check records, any incident note, and each stage's command, usage, and final message — enforces a denylist so raw rollouts and event logs, model catalogs, credential sources, controller state, and the harness-home and budget directories never leave the private tree, and then scans every exported file for credential-shaped content, failing on a hit. It is idempotent and prunes the directory of any run dropped from the publication manifest; `benchmark/manifests/index.json` maps each run to its level, theme, and configuration. Run it after promotion so a published level's provenance ships with it. See `benchmark/manifests/README.md`.

```sh
npm run benchmark:export-rollouts -- --upload
```

This publishes each published run's full transcripts — every stage's `rollout.jsonl` and `events.jsonl` — to the [`paulbatum/pareto-rail-rollouts`](https://huggingface.co/datasets/paulbatum/pareto-rail-rollouts) Hugging Face dataset, which holds what the git repository cannot: hundreds of megabytes of raw agent transcript, screenshots embedded as base64. Driven by the same publication manifest, it stages gzipped copies plus the dataset card under the repository's `tmp/rollouts-export/`, and writes `benchmark/manifests/rollouts.json`, the checked-in index recording each transcript's size and sha256 so a download can be verified after gunzip; commit that index alongside the provenance manifests. Before anything is staged, every transcript must pass two scans: the script's own credential-shape regexes, and a betterleaks sweep (gitleaks accepted as a fallback; install either single binary on PATH or in `~/.local/bin`) configured by `scripts/benchmark/betterleaks.toml`, which documents the known transcript false positives it filters. Any hit fails the export before upload — inspect it, and only extend the filter config once the finding is confirmed benign. Uploading needs `hf` authenticated with write access (`hf auth login`); without `--upload` the command stages and scans only. Publishing a new run is therefore: promote, edit the publication manifest, `benchmark:export-rank-catalog`, `benchmark:export-provenance`, `benchmark:export-rollouts -- --upload`, then commit.
