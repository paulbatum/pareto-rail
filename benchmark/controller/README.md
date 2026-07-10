# Benchmark controller

`runbook.md` is the stable, harness-neutral instruction set for an agent that coordinates benchmark stages and other agents. It is not a prompt for a level author.

A controller may use any orchestration harness capable of launching the models and sessions declared by a recipe. Harness-specific commands, model selectors, continuation mechanics, and usage extraction belong in recipes or deterministic adapters, not in the shared runbook.

Use a fresh controller context for every eligible run. A dispatcher may launch those isolated contexts in the private schedule order, but it must not pass source, logs, stage artifacts, judgments, or conversational history from one entrant to another.

The controller runbook remains editable until a benchmark release is frozen. At freeze, record its path and SHA-256 hash as a `controller-runbook` artifact.
