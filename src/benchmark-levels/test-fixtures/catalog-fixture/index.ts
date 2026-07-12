import type { LevelDefinition } from '../../../engine/types';

/** A tiny procedural module used to keep discovery coverage in the repository. */
export const catalogFixtureLevel: LevelDefinition = {
  id: 'catalog-fixture',
  title: 'Catalog Fixture',
  description: 'A procedural benchmark catalog smoke fixture.',
  bpm: 120,
  createAudio() {
    let master = 1;
    let music = 1;
    let sfx = 1;
    return {
      start: async () => {},
      installGestureStart() {},
      setMasterVolume(value) { master = value; },
      getMasterVolume() { return master; },
      setMusicVolume(value) { music = value; },
      getMusicVolume() { return music; },
      setSfxVolume(value) { sfx = value; },
      getSfxVolume() { return sfx; },
      suspend: async () => {},
      dispose() {},
    };
  },
  createRuntime() {
    return { update() {}, dispose() {} };
  },
};

export default catalogFixtureLevel;
