# Pricing inputs

Store the dated, source-linked API list-price inputs used to calculate equivalent cost here. These do not change a subscription run into an API-billed run: actual subscription expenditure remains separate. At a freeze, hash each selected pricing input as a `pricing` artifact.

`gpt-5.6-terra-standard-short.json` is the current input for the first Codex rehearsal. `gpt-5.6-sol-standard-short.json` records the corresponding Sol rates for the `codex-sol-high` configuration. Both use the standard short-context table. `claude-fable-5-standard.json` records the corresponding rates for the `claude-fable-5-high` configuration, including a cache-write rate (Codex exposes no cache-write field). A run that is billed under a long-context, long-TTL-cache, or another service tier needs a separately frozen input; do not silently reuse any of these files.
