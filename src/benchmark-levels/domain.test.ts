// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createBenchmarkCatalog } from './catalog';
import { validateBenchmarkAssets } from './validation';
import type { BenchmarkLevelModule } from './types';
import type { LevelDefinition } from '../engine/types';

declare const process: { argv: string[]; exitCode?: number } | undefined;

const fixtureLevel: LevelDefinition = {
  id: 'fixture',
  title: 'Fixture',
  bpm: 120,
  description: 'fixture',
  createAudio: () => ({
    start: async () => {}, installGestureStart() {}, setMasterVolume() {}, getMasterVolume: () => 1,
    setMusicVolume() {}, getMusicVolume: () => 1, setSfxVolume() {}, getSfxVolume: () => 1,
    suspend: async () => {}, dispose() {},
  }),
  createRuntime: () => ({ update() {}, dispose() {} }),
};

const assets = (descriptor: unknown, load: () => Promise<BenchmarkLevelModule>) => ({
  descriptors: { './fixture/level.json': descriptor },
  modules: { './fixture/index.ts': load },
});

export async function runBenchmarkLevelDomainTests(): Promise<void> {
  let loads = 0;
  const catalog = createBenchmarkCatalog(
    assets({ id: 'fixture', title: 'Fixture' }, async () => {
      loads += 1;
      return { fixtureLevel };
    }).descriptors,
    assets({ id: 'fixture', title: 'Fixture' }, async () => {
      loads += 1;
      return { fixtureLevel };
    }).modules,
  );
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].domain, 'benchmark');
  assert.equal(catalog[0].id, 'fixture');
  assert.equal(loads, 0, 'catalog metadata must not load benchmark modules');
  assert.equal((await catalog[0].load()).title, 'Fixture');
  assert.equal(loads, 1);
  await catalog[0].load();
  assert.equal(loads, 1, 'lazy loads should be cached');

  assert.throws(
    () => validateBenchmarkAssets({ './wrong/level.json': { id: 'fixture', title: 'Fixture' } }, { './wrong/index.ts': async () => ({ fixtureLevel }) }),
    /expected directory id "wrong"/,
  );
  assert.throws(
    () => validateBenchmarkAssets({ './fixture/level.json': { id: 'fixture', title: 'Fixture' } }, {}),
    /has no matching module/,
  );
  assert.throws(
    () => validateBenchmarkAssets({}, { './fixture/index.ts': async () => ({ fixtureLevel }) }),
    /has no matching descriptor/,
  );
  assert.throws(
    () => createBenchmarkCatalog(
      { './fixture/level.json': { id: 'fixture', title: 'Fixture', aliases: ['crystal'] } },
      { './fixture/index.ts': async () => ({ fixtureLevel }) },
      [{ id: 'crystal', aliases: [] }],
    ),
    /collides with built-in level "crystal"/,
  );
  await assert.rejects(
    () => createBenchmarkCatalog(
      { './fixture/level.json': { id: 'fixture', title: 'Wrong title' } },
      { './fixture/index.ts': async () => ({ fixtureLevel }) },
    )[0].load(),
    /expected descriptor title "Wrong title"/,
  );
  assert.throws(
    () => createBenchmarkCatalog(
      { './fixture/level.json': { id: 'fixture', title: 'Fixture' } },
      { './fixture/index.ts': async () => ({ fixtureLevel }) },
      [{ id: 'fixture' }],
    ),
    /Benchmark identity "fixture" collides with built-in level "fixture"/,
  );
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkLevelDomainTests().then(() => console.log('Benchmark level domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
