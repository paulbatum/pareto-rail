# Pricing inputs

Store the dated, source-linked API list-price inputs used to calculate equivalent cost here. These do not change a subscription run into an API-billed run: actual subscription expenditure remains separate. At a freeze, hash each selected pricing input as a `pricing` artifact.

`gpt-5.6-terra-standard-short.json` is the current input for the first Codex rehearsal. It uses the standard short-context table. A run that is billed under a long-context or another service tier needs a separately frozen input; do not silently reuse this file.
