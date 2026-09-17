# Operator skills exposure

## Record

pi discovers skills from the operator's home directory (`~/.agents/skills`) as well as from the working directory, and lists every discovered skill with its file path in the system prompt. The pi adapter did not disable that discovery, and the entrant sandbox does not hide the operator's home, so pi entrants were offered the operator's personal skills and could read them.

This is not a pi version change. pi 0.80.10, 0.84.4 and 0.85.0 produce the same listing against the same home directory. What an earlier pi run was offered depended on what the directory held when it ran.

The six `pi-openrouter-union-alpha-high` runs are the first promoted runs that read those files:

| Run | Operator skills read |
| --- | --- |
| `run-vi207g6wxh` | `agent-browser`, `one-pass-writing`, `wsl-webgl-webgpu` |
| `run-kk5bob0rfo` | `one-pass-writing`, `wsl-webgl-webgpu` |
| `run-aq1wyzsp3l` | `one-pass-writing`, `wsl-webgl-webgpu` |
| `run-cdglws4sxc` | `agent-browser`, `one-pass-writing`, `wsl-webgl-webgpu` |
| `run-nqw47y4pzu` | `agent-browser`, `one-pass-writing`, `wsl-webgl-webgpu` |
| `run-7jg3l68bgi` | none |

The skills are operator tooling: browser automation, WSL GPU browser setup, and writing rules. None contains level material, so the audit's reuse rule does not apply. They are an unequal condition: they help with visual verification, and most entrants did not have them.

Codex also lists skills from `~/.agents/skills` in its prompt, so Codex entrants saw their names, descriptions and paths. Its sandbox denies the home directory, and every recorded Codex attempt to open one failed. Claude entrants run with an isolated home and show no exposure.

## Decision

The owner promoted the six runs with this note attached rather than rerunning them.

## Actions

The pi adapter runs `--no-skills` and passes the worktree's own `.agents/skills` back with `--skill`, so an entrant receives only the skills its checkout contains. The Codex adapter disables every skill under `~/.agents/skills` with a `skills.config` override, since Codex has no setting that drops that root. Captured prompts for both harnesses confirm the worktree's `AGENTS.md` and skills remain and the operator's skills are gone.
