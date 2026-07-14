# Public benchmark catalog boundary

`benchmark/public/` is the reviewed input seam for generated website catalog
artifacts. It may contain redacted catalog fixtures and thumbnail metadata; it
must never be populated directly from `benchmark/private/`. Private schedules,
raw logs, credentials, session URLs, and slot-to-model mappings stay private.

Build the two projections with:

```sh
npm run benchmark:catalog -- build \
  --source benchmark/public/fixtures/downpour-rehearsal.json \
  --out /tmp/pareto-rail-catalog --mode development --fixture
```

Development fixtures may mark thumbnails as `placeholder`, but the status is
explicit and production validation rejects placeholders. Production requires
exactly playable, eligible entrants, real assets, and no rehearsal/DNF rows:

```sh
npm run benchmark:catalog -- validate --source path/to/catalog.json --mode production
```

The generated `catalog-pre-vote.json` projection contains only opaque ids,
an opaque playable capability reference, theme copy, playability, and thumbnail
metadata. Integrated `levelId` values remain reveal/server-owned. Thumbnail
paths are opaque asset ids. `catalog-reveal.json` carries
configuration, model/workflow, measured cost, and public manifest references;
serve it only after a vote. The build writes a hash manifest beside both files
so deploys can verify which source and projections were published.

The Downpour development fixture intentionally contains exactly these five
passing rehearsals: `7snm`, `hlht`, `ou7e`, `f2e6`, and `wpxk`. The failed
`downpour-xgz7` run is never included.
