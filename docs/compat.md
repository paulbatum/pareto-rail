# Public compatibility contracts

The engine, game runtime, level internals, scheduler internals, and benchmark tooling are freely changeable. The surfaces below are contracts with deployed clients, stored data, and the outside world. Changes to them must be backward compatible.

## Identifiers

Level ids, theme ids, benchmark version strings, and configuration ids are persisted in production vote rows and embedded in matchup ids. Once any production vote references an id, it is immutable.

- Renaming a level: keep the old id in the level's `aliases` list forever. URLs (`/play/<id>`) and content-image paths (`/level-content/<id>/`) resolve through aliases and external caches.
- Theme ids and benchmark version strings cannot be renamed at all; add new ones instead.
- Ids use lowercase letters, digits, and hyphens only. The matchup id grammar (`themeId:levelFirst__levelSecond`) reserves `:` and `__`.
- Matchup ids canonicalize their level pair by codepoint order. The sort must be locale-independent — never `localeCompare` — because clients derive the same id in arbitrary browser locales and the server re-derives it during validation.

## localStorage

Keys, once shipped, exist on visitors' machines forever.

- The benchmark store envelope evolves additively: new optional fields with defaults applied in `normalize()`. Bumping the envelope version discards returning visitors' data — last resort only.
- The participant id must survive any schema change; it is the client's voting identity and the server dedups on it.
- All storage access must tolerate throwing storage (private browsing, quota): wrap reads and writes, fall back to in-memory defaults.

## Vote API

Deployed clients go stale: a tab left open posts the old payload shape, and the outbox retries queued votes across deploys.

- The server must keep accepting every payload shape it has ever accepted. New fields are optional; required fields are never added or removed.
- The server rejects unknown top-level keys with a 400, and the client outbox permanently drops entries on 4xx (except 429). Therefore new fields roll out server first, client in a later deploy — never the reverse.
- `PARTICIPANT_SALT` never rotates. Participant identity is `sha256(salt + participantId)`; a rotation makes every returning participant unrecognizable to vote dedup.

## Database

Production migrations are additive only (new tables, new nullable columns, new indexes). Never rewrite or reinterpret existing vote rows; version-tag new semantics via `schemaVersion` instead.
