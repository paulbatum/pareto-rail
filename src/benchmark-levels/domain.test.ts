// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createBenchmarkCatalog } from './catalog';
import { validateBenchmarkAssets } from './validation';
import type { BenchmarkLevelModule } from './types';
import catalogFixtureLevel from './test-fixtures/catalog-fixture/index';

declare const process: { argv: string[]; exitCode?: number } | undefined;

const fixtureAssets = (load: () => Promise<BenchmarkLevelModule> = async () => ({ default: catalogFixtureLevel })) => ({
  descriptors: { './catalog-fixture/level.json': { id: 'catalog-fixture', title: 'Catalog Fixture' } },
  modules: { './catalog-fixture/index.ts': load },
});

export async function runBenchmarkLevelDomainTests(): Promise<void> {
  assert.deepEqual(createBenchmarkCatalog({}, {}), [], 'an empty promoted-output directory produces an empty catalog');

  let loads = 0;
  const fixture = fixtureAssets(async () => {
    loads += 1;
    return { default: catalogFixtureLevel };
  });
  const catalog = createBenchmarkCatalog(fixture.descriptors, fixture.modules);
  assert.equal(catalog.length, 1, 'adding a descriptor/module pair discovers one fixture entry');
  assert.equal(catalog[0].domain, 'benchmark');
  assert.equal(catalog[0].id, 'catalog-fixture');
  assert.equal(loads, 0, 'catalog metadata must not load benchmark modules');
  assert.equal((await catalog[0].load()).title, 'Catalog Fixture');
  assert.equal(loads, 1);
  await catalog[0].load();
  assert.equal(loads, 1, 'lazy loads should be cached');

  assert.throws(
    () => validateBenchmarkAssets({ './wrong/level.json': { id: 'catalog-fixture', title: 'Catalog Fixture' } }, { './wrong/index.ts': async () => ({ default: catalogFixtureLevel }) }),
    /expected directory id "wrong"/,
  );
  assert.throws(
    () => validateBenchmarkAssets(fixture.descriptors, {}),
    /has no matching module/,
  );
  assert.throws(
    () => validateBenchmarkAssets({}, fixture.modules),
    /has no matching descriptor/,
  );
  assert.throws(
    () => createBenchmarkCatalog(
      { './catalog-fixture/level.json': { id: 'catalog-fixture', title: 'Catalog Fixture', aliases: ['crystal'] } },
      fixture.modules,
      [{ id: 'crystal', aliases: [] }],
    ),
    /collides with built-in level "crystal"/,
  );
  await assert.rejects(
    () => createBenchmarkCatalog(
      { './catalog-fixture/level.json': { id: 'catalog-fixture', title: 'Wrong title' } },
      fixture.modules,
    )[0].load(),
    /expected descriptor title "Wrong title"/,
  );
  assert.throws(
    () => createBenchmarkCatalog(
      fixture.descriptors,
      fixture.modules,
      [{ id: 'catalog-fixture' }],
    ),
    /Benchmark identity "catalog-fixture" collides with built-in level "catalog-fixture"/,
  );
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkLevelDomainTests().then(() => console.log('Benchmark level domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
