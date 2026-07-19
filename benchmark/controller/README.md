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

`materialsCommit` and `entrantBaseline` pin the run: inputs are read from the materials commit and their hashes recorded in the manifest, and the entrant checkout is that baseline. Per row, `levelId` must equal `<themeId>-<slotId>`; the level title comes from the theme file's level-one heading, not the plan. `stage.adapter` is `codex-cli`, `claude-cli`, or `pi-cli`; `provider` and `budget` are optional and `budget` calibrates effort through the harness's spend notices. `delegation` is optional and turns the stage into a planner/reviewer over a cheaper implementer. `kind` defaults to `benchmark`; a `rehearsal` row runs the identical pipeline but never enters the results pool, the catalog, or promotion.

Blindness is a discipline, not a lock. Slot ids are assigned randomly when the plan is expanded, so authoring the plan does not reveal the level-to-configuration mapping; the owner does not open the plan file before voting through the site; and the operator surfaces below stay blind by default.

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
npm run benchmark:results
npm run benchmark:manage -- status
```

`benchmark:results` summarizes every run — lifecycle state, gates, timing, cost, manifest completeness — with run ids and dispositions only. Both commands take `--unblind` to reveal configuration and model identities; use it only after you have voted. `benchmark:manage` also offers `archive-dnf`, `unarchive`, and `prune` (a strictly verified, doubly confirmed removal of a run's temporary worktrees that preserves every branch and commit).

## Promotion

```sh
npm run benchmark:promote -- --run <run-id>
```

Promotion takes a playable benchmark run, validates its manifest, gates, and refs, materializes the payload under `src/benchmark-levels/<id>/`, regenerates the gallery, runs the four checks, and records a separate commit. It holds a lock, checkpoints its progress in `promotion.json`, and never edits the run manifest or its disposition. `benchmark:manage -- status` reports a playable run that has not been promoted as pending — or a failed attempt as failed — and prints this command.

## Publishing the catalog

```sh
npm run benchmark:export-rank-catalog
```

This reads the v2 plan and the historical v1 schedule into the checked-in `src/benchmark/rank-catalog.json`, one retained slice per version, with the latest as the active matchup pool. After refreshing it, run `npm run test:benchmark-domain`, `npm run test:benchmark-catalog`, `npm run typecheck`, and `npm run build`.

A configuration reaches the catalog through two separate gates in `scripts/benchmark/export-rank-catalog.mjs`, and a new configuration must be added to both to publish. First, a global entry in the public-label registry (`configurationLabels`): its display `modelName`, a `workflowName`, the `primaryModel`, `effort`, and a one-sentence `workflowSummary` (delegated configs add `delegateModel`/`delegateEffort`). This is identity only — it is revealed after a vote and groups results by configuration, and it does not weaken blindness, since the level-to-configuration mapping stays in the private plan. A budgeted (`-b20`) variant is its own configuration id and its own entry; encode the budget in the `workflowName` (e.g. `solo, $20 budget`) so it reads distinctly from its unbudgeted sibling. Second, the configuration id must be listed in that version's entry of `publishedConfigurations`, which declares which labeled configurations actually appear in each version's slice. Keeping identity global but publication per-version means labeling a configuration for a new version never republishes a finished version — v1 keeps exactly the configurations it shipped with even after its budgeted runs are labeled for a later version. A configuration missing either gate is warned and withheld; its levels never enter the pool. Each published level must also carry a `contentImages.hero` in its descriptor, or the export fails on it.
