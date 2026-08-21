# Benchmark controller operations

`scripts/benchmark/run.mjs` is the benchmark pipeline. This page tells the agent driving it which command to run and what to do when one fails. For the wider picture of what the benchmark is, see `benchmark/README.md`.

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
      "recipePath": "benchmark/recipes/<harness>-cli.md",
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

`baselinePolicy` is required. New series use `scrubbed`: entrants receive the built-in levels and shared application only. `open` exists to record the historical v2 condition; every v2 row runs under `open` and remains unchanged, with the recorded baseline guard and promotion-time contamination audits as its controls. `materialsCommit` and `entrantBaseline` pin the run: inputs are read from the materials commit and their hashes recorded in the manifest, and the entrant checkout is that baseline. A row may optionally set its own `entrantBaseline` to use a variant of the round's frozen baseline, such as one with same-family theme levels removed. Otherwise it inherits the plan baseline. Per row, `levelId` must equal `<themeId>-<slotId>`; the level title comes from the theme file's level-one heading, not the plan. `stage.adapter` is `codex-cli`, `claude-cli`, `pi-cli`, `prime-agent-cli`, or `agy-cli`; `provider` and `budget` are optional and `budget` calibrates effort through the harness's spend notices. A `prime-agent-cli` row may set `stage.autonomous` and `stage.autonomousGate` to hand stopping to the harness's own continuation loop, which is an intervention rather than a default — see `benchmark/recipes/prime-agent-cli.md`. A Codex row may set `stage.networkAccess` explicitly; when omitted it defaults to `false` for a scrubbed plan and `true` for the historical open policy. A claude or pi row runs under the entrant sandbox on a scrubbed plan; a rehearsal row may set `stage.sandbox: false` to opt out (see Entrant sandbox below). `delegation` is optional and turns the stage into a planner/reviewer over a cheaper implementer. `kind` defaults to `benchmark`; a `rehearsal` row runs the identical pipeline but never enters the results pool, the catalog, or promotion.

Before launching any row, the runner checks the declared baseline's git tree. `src/benchmark-levels/` may contain only the four empty-catalog scaffold files required by the built-in registry, `benchmark/` must be absent, and `public/level-content/` may contain only ids registered in that baseline's own `src/levels/index.ts`. The generated gallery and rank catalog must also be reduced to built-in content. The policy decides the consequence: under `scrubbed`, violations name the offending paths, direct the agent to `benchmark:cut-baseline`, and abort; under `open` they are printed and carried into the manifest's `baseline.guard` without blocking, so the record states what the entrant could reach. The check runs before the entrant worktree checkpoint. A plan without `baselinePolicy` is invalid.

A plan file is the mapping, so the agent that writes one knows it and the design principle on blindness governs what it may then say. Two things here look like controls and are not: the random slot ids, which the agent assigned itself, and row order, which identifies configurations by position if every theme lists them in the same sequence.

## Cutting a baseline

Cut the next series' baseline from the source commit that contains that series' shared application and built-in levels:

```sh
npm run benchmark:cut-baseline -- --source <commit-ish> --branch <branch-name>
```

The tool creates the branch in an isolated temporary worktree, removes promoted benchmark source and records, removes non-built-in public content, regenerates the gallery, empties the benchmark rank catalog, commits the result with the source commit in its message, and runs `npm run typecheck` and `npm run build` in that scrubbed checkout. It prints the resulting commit and branch. Do not cut a baseline during v2; v2 deliberately continues from its original open baseline.

A scrubbed checkout must not advertise a command it cannot run, so the cut drops every package.json script whose entry point reaches a removed file through its imports, not only one that names a removed path directly. `check:scope` is the reason the level footprints live in `scripts/level-footprint.mjs` rather than in the harness: the checker imports them, so keeping them outside `scripts/benchmark/` is what lets the entrant's own scope check survive the scrub.

The four files under `src/benchmark-levels/` are retained because `src/levels/index.ts` imports the benchmark catalog even when Vite discovers no benchmark entries. No entrant level or test fixture is retained.

## Running a configuration on a theme older than it

A configuration can only ever run on themes whose materials commit predates it, so a new roster entry that is assigned an existing theme hits a materials commit that has no recipe document for it. `synthesizeDefinition` reads every input from `materialsCommit`, including `recipePath`, and aborts: `fatal: path '<recipe>' exists on disk, but not in '<commit>'`. `materialsCommit` is plan-level, so no row can override it.

Two wrong turns to skip. Pointing the row at another configuration's recipe records a mechanism the run did not use. Pointing the plan at newer materials changes what the entrant reads: the assignment template gained an Environment section describing the filesystem sandbox, which is false for an open-policy row and absent from what the theme's earlier entrants received.

Derive a materials commit instead:

1. Read a sibling's `benchmark/private/runs/<runId>/rendered-assignment.json` and note its `template.sha256` and `theme.sha256`. Any entrant of the same theme will do; that pair is what the comparison holds constant.
2. Branch from the plan the siblings ran under, add the configuration's recipe document, and commit. Add nothing else — `git diff --name-only <base> <new>` must name only that file.
3. Put the new rows in their own plan file with the derived commit as `materialsCommit`, keeping the siblings' `entrantBaseline`, `benchmarkVersion`, and `baselinePolicy`. A separate file leaves the existing plan's recorded provenance where it is.
4. Before launching, hash the template and theme the new plan will render (`git show <materialsCommit>:<path>`) and check both against step 1. They must match. The recipe is hashed into `rendered-assignment.json` for provenance but never rendered into the assignment, so it is the one input that may differ.

Themes of one era can sit under different materials commits — a theme added later has its own — so compare against a sibling of the same theme, not of the same era.

## Entrant sandbox

Entrant shells run under an OS-level sandbox for scrubbed plans (the same activation as Codex's network isolation). It confines tool execution three ways: the entrant worktree is the only writable tree; the primary repository (its `.git`, the tracked `benchmark/` tree, promoted levels, and — since run records live under `benchmark/private` — this run's own harness home and copied credential) and the host `/tmp` (every concurrent run's checkout) are unreadable; and there is no external network egress, while loopback keeps working for the floor and snapshot self-checks. It is decided by the row's effective `baselinePolicy`; a rehearsal row may set `stage.sandbox: false` to opt out.

Some harnesses cannot be confined at all — `UNSANDBOXABLE_ADAPTERS` in `scripts/benchmark/entrant-sandbox.mjs` names them, currently `agy-cli` and `prime-agent-cli`. From v3 such a row runs unisolated rather than being refused: the runner prints a warning immediately before the stage launches, naming why the row is unisolated, and the manifest records `sandboxUnavailable: true` on the stage so the record separates "not isolated by policy" from "could not be isolated". The contamination audit is the control on those runs and must not be weakened for them. A request for isolation that cannot be honored is refused out loud and the stage continues without it; what never happens is a run reporting a boundary it did not have. Open-policy rows stay unsandboxed with the contamination audit as their control. The audit stays on for every run as defense-in-depth and must not be weakened.

Each harness reaches that boundary its own way. Codex uses its permission profile: recipe-controlled `network_access`, defaulting to `false` for scrubbed plans, implemented as loopback-only isolation via Codex's managed `network_proxy` mode with `allow_local_binding=true` (fully disabling network blocks even loopback binds — `listen EPERM` on `127.0.0.1` — which the floor check needs). Claude uses Claude Code's built-in bubblewrap sandbox, configured through the stage's `--settings` file; its `WebFetch`/`WebSearch` tools run in the harness process outside the bash sandbox, so they are disabled at the tool level, and because Claude reads the entrant-controlled project `.claude/settings.json` — which can widen the boundary — the adapter refuses to launch if one exists at startup and denies writing one during the run. pi has no native sandbox, so a controller-owned extension (`scripts/benchmark/pi-sandbox-extension.js`, over Anthropic's `sandbox-runtime`) wraps every bash command and also enforces the boundary on pi's native `read`/`write`/`edit` tools, which run in the harness process; the policy comes from the controller, not from any file the entrant can write. All three steer Puppeteer to `chrome-headless-shell` (full Chrome cannot start under the sandbox's seccomp filter, which denies the unix-socket creation Chrome does at startup) and run with `DISPLAY` unset so Chrome's GPU probe does not hang on the hidden WSLg X socket. The verified boundary — repository and sibling reads denied, external egress and DNS denied, loopback and in-worktree writes working, gates passing — is exercised by `node scripts/benchmark/sandbox-probe.mjs` and `node scripts/benchmark/sandbox-gate-check.mjs --worktree <checkout>`. v2 Codex recipes and runs stay on their existing `network_access=true` behavior under `open` policy.

One side effect is visible to the entrant and has to be neutralized. `sandbox-runtime` shields a fixed set of dotfiles and tool directories relative to the working directory — which for a stage is the worktree — by mounting anything absent from `/dev/null`. Inside the namespace those appear as real, empty, untracked files, so the entrant's own `npm run check:scope` reports noise it has no way to clear. The pi adapter therefore records the shielded names in the worktree's `.git/info/exclude` before staging, which cannot mask entrant work because the same mounts make those paths unwritable. They exist only inside the namespace, so the controller's authoritative scope gate never sees them; the extension still runs `cleanupAfterCommand()` after every wrapped command so a stage killed before its exit sweep leaves no mount-point files behind either.

Host prerequisites for a scrubbed claude/pi row: `bubblewrap` and `socat` on PATH (`sudo apt-get install bubblewrap socat`), and `chrome-headless-shell` installed once (`npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/pareto-rail/chrome-headless-shell`). The runner checks for `bwrap` and `socat` before staging a sandboxed row and aborts with the install command if either is missing; the adapters print the `chrome-headless-shell` install command if it is absent. All of this runs on the owner's Ubuntu 22.04 WSL2 host, which allows unprivileged user namespaces. On Ubuntu 24.04+ an AppArmor restriction (`kernel.apparmor_restrict_unprivileged_userns=1`) breaks bubblewrap-based sandboxes — including their loopback setup (`bwrap: loopback: Failed RTM_NEWADDR`) — until an AppArmor profile granting bwrap `userns` is installed; if the host is ever upgraded, fix it with that profile rather than the global sysctl.

## Resume and recovery

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<runId>
```

Resume validates existing artifacts and continues at the first unfinished step. A stage that exited non-zero is not accepted on its own; if the harness timed out after the entrant had finished its worktree, verify that condition and then resume with `--accept-stage-output true` to accept the worktree and proceed to sealing and gates. For an interrupted claude, pi, or prime-agent process, the agent can instead issue the one-off same-session recovery `npm run benchmark:run -- --resume benchmark/private/runs/<runId> --continue-stage true`, which re-enters the session the interrupted round recorded so the entrant keeps its own context and its half-built worktree. It covers an expired credential, a reboot, a stalled stream, and — for pi — interruptions around a quota wait; each recovery window writes round-suffixed records such as `events-resume-<n>.jsonl`. It is refused for a budgeted stage, whose own protocol owns its continuations, and for harnesses that cannot re-enter a session (`CONTINUABLE_ADAPTERS` in `scripts/benchmark/run.mjs` is the list). Prefer it to a fresh relaunch whenever the entrant has real work in its worktree: relaunching discards that work, and restarting a *new* session against a worktree it does not remember is the thing to avoid, not resuming the original one. The continuation prompt is: `Your previous session was interrupted. You have been resumed in the same session; continue the assignment from where you left off and finish it per the original instructions.` The process is not resumed by the controller again automatically. Whenever a step fails after the worktree exists, the runner snapshots tracked and untracked source to a durable `refs/benchmark-recovery/<run-id>/...` ref; if the temporary worktree later disappears, resume reconstructs it from that ref before continuing. A long stage is also snapshotted to the same ref every twelve minutes while it runs, so a host that dies without the failure handler — a reboot, a kill during a quota wait — loses at most one interval of entrant work rather than everything since the last checkpoint. These background snapshots stage into a private index and never touch the entrant's own index or working files; an unchanged worktree is skipped, and a snapshot failure is recorded and does not disturb the stage. Sibling runs of one theme are pre-checked to share identical theme text and assignment template — the inputs every entrant on a theme must receive alike — so a misrendered prompt (a wrong path or a stale `materialsCommit`) is caught before an expensive stage launches. The per-run level id and the budget flag are deliberately excluded: they vary between siblings by design (a unique opaque id; `-high` versus `-b20`), so multiple configurations, budgeted and not, can run on one theme concurrently.

## Failure policy

Infrastructure failure: fix it, rerun, and keep and report the cost of every attempt. Model failure — a gate fails on the sealed output — is a DNF, shown as such. The agent classifies which one it was and records the decision as a free-text note in the run record, and puts the call to the owner when it is not clear-cut.

An escalation holds that row, not the queue. Rows are independent: each is one plan row against its own entrant checkout, and no row's outcome decides another's. So set the ambiguous row aside, launch the remaining rows, and report the classification with them.

Two transient infrastructure failures recur on the Claude Code stage. The first is `Failed to authenticate: OAuth session expired and could not be refreshed`: the stage runs against a copy of the owner's credential in its isolated home, and another Claude session on that account running alongside the benchmark can rotate the shared refresh token out from under that copy, so a stage started with a near-expired token cannot refresh. The second is `API Error: Stream idle timeout - no chunks received`, a mid-stage stall of the streaming response. Both kill the stage without the entrant having failed at anything, so recover with `--continue-stage true` (see Resume and recovery): it re-enters the recorded session, and the resume copies the owner's credential into the run's home again, which is what clears an expired one. Relaunch fresh only when there is no session to re-enter or no entrant work worth keeping. The OAuth race is intermittent; if it keeps recurring, re-login on the owner's account (`claude`, interactive) to refresh the stored token before launching more Claude stages.

Moonshot's `kimi-coding` provider can end a pi stage with a final assistant error containing `access_terminated_error` (or `403` and `usage limit`) when its subscription quota window is exhausted. The controller-owned quota-wait extension handles this in-process for `kimi-coding` stages. If the stage process dies anyway — timeout during a wait, the extension's wait cap, a reboot — do not relaunch fresh: resume the same session with `--continue-stage true` (see Resume and recovery), which preserves all entrant work. Before issuing it, check `ps` for a live controller or adapter process on that run: a resume may already be in flight from an earlier session, and a second launch against the same worktree would corrupt the entrant.

## Watching a live pi stage

The stage's retained `events.jsonl` flushes lazily — half an hour with no file is normal, not a hang. The continuous liveness signal is pi's native session transcript under the run's `harness-home/sessions/`, which grows with every model turn; a transcript that stops growing with no new `quota-wait/quota-waits.jsonl` entry is the actual stall signature. To test whether a capped quota window has refreshed without touching the run, issue a trivial one-word pi call against the same provider from a scratch home: it fails instantly at zero cost while capped and succeeds on refresh. Its 403 arrives on stdout while auth-refresh chatter goes to stderr, so capture both streams when scripting the probe.

## Regate

Gates are deterministic against the sealed commit, so a gate-tooling fix never re-runs generation. Move the run's `gates/` directory aside and resume; the disposition is recomputed from the refreshed gate records.

Which tooling those refreshed gates run is not uniform, and it decides what a regate can actually fix. `scope` runs the controller's own copy of the checker by absolute path, so a fix to it reaches every run immediately. `typecheck`, `build`, and `floor` run inside the entrant checkout — `npm run check:floor` there resolves the checkout's `package.json` and its `scripts/`, which came from the entrant baseline. A fix to the floor check therefore reaches runs cut from the next baseline, not runs already sealed against an earlier one. That is the intended shape rather than an oversight: the entrant is measured by the same command it was given, and moving that bar underneath a sealed run would judge it against a check it never had. When a defect in the floor check itself is what failed a sealed run, the call is the failure policy's — an infrastructure failure to be classified and recorded, not a disposition to be recomputed by re-running the old check.

## Inspecting and managing runs

```sh
npm run benchmark:status
npm run benchmark:results
npm run benchmark:manage -- status
```

`benchmark:status` is the first stop: it joins every plan file under `benchmark/private/` and any run schedule to the executed artifacts (live and archived) and answers what is left, splitting runs into pending, needs-promotion, and ran. `benchmark:results` then gives the per-run-artifact detail for the live directory — lifecycle state, gates, timing, cost, manifest completeness — with run ids and dispositions only. All three take `--unblind` to reveal configuration and model identities, under the rule in `benchmark/README.md`, Blindness. `benchmark:manage` also offers `archive-dnf`, `unarchive`, `prune`, and `delete`. `prune` and `delete` differ in what survives, so pick by whether the run is evidence:

- `prune --run <id> --confirm <id>` removes a run's temporary worktrees and preserves every branch, commit, and record. Use it to reclaim disk from a run whose entrant produced work.
- `delete --run <id> --confirm <id>` removes the run record and every trace the run created: its worktrees, its branches, its `refs/benchmark-recovery/<id>` refs, and the record directory itself, live or archived. Nothing is recoverable afterwards. Use it for a run whose entrant produced nothing worth keeping — a provider blip, an aborted launch. Add `--dry-run true` to list what would go first.

`delete` refuses a run that is promoted (`src/benchmark-levels/<levelId>` exists), one the publication manifest still lists, one with published provenance under `benchmark/manifests/`, and any run whose state is not `gate-failed`, `dnf`, `controller-failure`, or `incomplete`. It never edits a plan file: drop or re-slot the row yourself.

## Promotion

```sh
npm run benchmark:promote -- --run <run-id>
```

Promotion takes a playable benchmark run, validates its manifest, gates, and refs, materializes the payload under `src/benchmark-levels/<id>/`, runs the four checks, and records a separate commit. Before promoting, execute `npm run benchmark:contamination -- --run <runId> --json`, review every `web` event against the entrant's output for plausible reuse of external level material, and record the reviewer's verdict in the promotion decision. A `web-self-lookup` or any other violation blocks promotion pending the agent's review. Between materializing the payload and checking it, promotion re-encodes any PNG under the level's `public/level-content/<id>/` to AVIF, rewrites the matching `contentImages` paths, and records each conversion with both hashes in `promotion.json`, so entrant PNGs never enter a mainline commit and a resumed promotion re-verifies the conversion rather than repeating it. It holds a lock, checkpoints its progress in `promotion.json`, and never edits the run manifest or its disposition. `benchmark:manage -- status` reports a playable run that has not been promoted as pending — or a failed attempt as failed — and prints this command.

## Publishing the catalog

```sh
npm run benchmark:export-rank-catalog
```

This projects the publication manifest — `benchmark/private/publication.json`, the hand-edited list of published themes and entrants — into the checked-in `src/benchmark/rank-catalog.json`. Each theme entry declares its `acceptedBaselines`; the export fails on any live entrant whose run manifest records a different entrant baseline. Themes and entrants carry an optional `retired` flag, and a theme may carry an `experimental` flag: retired items stay published as history and experimental themes are published for play before they are ranked, but neither ever enters matchup scheduling. After refreshing the catalog, run `npm run test:benchmark-domain`, `npm run test:benchmark-catalog`, `npm run typecheck`, and `npm run build`.

A configuration reaches the catalog through two separate gates in `scripts/benchmark/export-rank-catalog.mjs`, and a new configuration must be added to both to publish. First, a global entry in the public-label registry (`configurationLabels`): its display `modelName`, a `workflowName`, the `primaryModel`, `effort`, and a one-sentence `workflowSummary` (delegated configs add `delegateModel`/`delegateEffort`). This is identity only — it is revealed after a vote and groups results by configuration, and it does not weaken blindness, since the level-to-configuration mapping stays in the private plan. A budgeted (`-b20`) variant is its own configuration id and its own entry; encode the budget in the `workflowName` (e.g. `solo, $20 budget`) so it reads distinctly from its unbudgeted sibling. Second, the configuration id must be listed in `PUBLISHED_CONFIGURATIONS`, the publication scope. Keeping identity separate from scope means labeling a configuration never publishes it on its own. A configuration missing either gate is warned and withheld; its levels never enter the pool. Retired entrants with a run manifest publish from it like any other; one whose run predates current tooling falls back to its retained catalog record. Unpromoted rows stay out of the catalog until their payloads are promoted, without hiding the rest of their theme. Each published level must also carry a `contentImages.hero` in its descriptor, or the export fails on it.

The export closes by comparing the models it just published against `src/app/featured-models.md`, the hand-edited list the home page names. It reports models publishing levels without being named and models named without a live level, then leaves the edit alone: the agent flags the mismatch to the owner and asks how to proceed. The copy is intentionally allowed to run ahead of publication, so a model can be announced as soon as it starts running the benchmark. The report never fails the export.

```sh
npm run benchmark:export-provenance
```

This copies each published run's public provenance from the gitignored `benchmark/private/runs/<runId>/` into the checked-in `benchmark/manifests/<runId>/`, driven by the same publication manifest. It copies an allowlisted subset — the run manifest and definition, the rendered assignment and its inputs, payload and evaluation records, gate and promotion-check records, any incident note, and each stage's command, usage, and final message — enforces a denylist so raw rollouts and event logs, model catalogs, credential sources, controller state, and the harness-home and budget directories never leave the private tree, and then scans every exported file for credential-shaped content, failing on a hit. It is idempotent and prunes the directory of any run dropped from the publication manifest; `benchmark/manifests/index.json` maps each run to its level, theme, and configuration. Run it after promotion so a published level's provenance ships with it. See `benchmark/manifests/README.md`.

```sh
npm run benchmark:export-rollouts -- --upload
```

This publishes each published run's full transcripts — every stage's `rollout.jsonl` and `events.jsonl` — to the [`paulbatum/pareto-rail-rollouts`](https://huggingface.co/datasets/paulbatum/pareto-rail-rollouts) Hugging Face dataset, which holds what the git repository cannot: hundreds of megabytes of raw agent transcript, screenshots embedded as base64. Driven by the same publication manifest, it stages gzipped copies plus the dataset card under the repository's `tmp/rollouts-export/`, and writes `benchmark/manifests/rollouts.json`, the checked-in index recording each transcript's size and sha256 so a download can be verified after gunzip; commit that index alongside the provenance manifests. Before anything is staged, every transcript must pass two scans: the script's own credential-shape regexes, and a betterleaks sweep (gitleaks accepted as a fallback; install either single binary on PATH or in `~/.local/bin`) configured by `scripts/benchmark/betterleaks.toml`, which documents the known transcript false positives it filters. Any hit fails the export before upload — inspect it, and only extend the filter config once the finding is confirmed benign. Uploading needs `hf` authenticated with write access (`hf auth login`); without `--upload` the command stages and scans only. Publishing a new run is therefore: promote, edit the publication manifest, `benchmark:export-rank-catalog`, `benchmark:export-provenance`, `benchmark:export-rollouts -- --upload`, commit, then tag and push the run's pinned commits as below.

## Tagging pinned commits

A run's history hangs off commits mainline never reaches: its evaluated and payload commits, its entrant baseline, and the materials commit its prompt was rendered from. Nothing pushes those on its own, so until they are tagged they live in the owner's clone alone, and losing that clone loses every commit a published entrant is pinned to.

Tags are the durability mechanism because they need nothing from the person retrieving them: the server advertises them, `git clone` takes them all by default, and a fresh clone therefore has the commits without a single line of configuration. They are lightweight tags — pure pointers, no annotation to keep accurate.

Names are slash-grouped under `benchmark/` so they read as a tree rather than a flat list:

| Commit | Tag |
| --- | --- |
| evaluated (`benchmark-run-<runId>`) | `benchmark/run/<runId>/evaluated` |
| payload (`benchmark-payload-<runId>`) | `benchmark/run/<runId>/payload` |
| materials (`refs/benchmark-materials/<name>`) | `benchmark/materials/<name>` |
| entrant baseline | `benchmark/baseline/<name>` |

An off-mainline materials commit gets both a ref and a tag — the ref is where it is found and reused when rendering prompts, the tag is what persists it:

```sh
git update-ref refs/benchmark-materials/<name> <commit>
git tag benchmark/materials/<name> <commit>
```

After a run, tag its two commits from the branches that already point at them, then push. The push is the standing command: it is idempotent and carries whatever is new, so it is the same line every time and needs no per-commit bookkeeping.

```sh
git tag benchmark/run/<runId>/evaluated benchmark-run-<runId>
git tag benchmark/run/<runId>/payload benchmark-payload-<runId>
git push origin 'refs/tags/benchmark/*:refs/tags/benchmark/*'
```

Tags persist the commits but do not replace the branches, because branch *names* are load-bearing: `assertRecordedBranch` in `scripts/benchmark/promote.mjs` re-resolves the `refs/heads/` branch a manifest names and fails if it no longer points at the recorded commit. Renaming or deleting a run's branch blocks any later promotion of that run, including a regate-and-repromote. In a clone that has the tags but not the branches, restore the branch before promoting:

```sh
git branch benchmark-run-<runId> benchmark/run/<runId>/evaluated
git branch benchmark-payload-<runId> benchmark/run/<runId>/payload
```
