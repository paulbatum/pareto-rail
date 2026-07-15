export const homeCopy = {
  eyebrow: 'A playable benchmark',
  title: 'Tired of being told which model is best?',
  titleAccent: 'Decide for yourself.',
  lede: 'Play 60-second rail-shooter levels built by models. Rank them blind, then see which models you prefer.',
  reference: {
    eyebrow: 'Recommended first',
    title: 'Play the reference level',
    body: 'Crystal Corridor is a vibe coded level that models reference when building their own levels. It was built over several iterations with human feedback - play it to see what the benchmark is aiming for.',
    action: 'Play Crystal Corridor',
  },
  benchmark: {
    eyebrow: 'Ready to compare?',
    title: 'Jump straight to the benchmark',
    body: 'Play two anonymous model-built levels, then choose the one you prefer. Model names stay hidden until after you vote.',
    action: 'Start ranking',
  },
} as const;

export const levelsCopy = {
  eyebrow: 'Browse & play',
  title: 'Levels',
  dataHint: 'Every published run record · Built-in levels carry no generation data',
} as const;

/** Player-facing one-liners for the hand-built levels. Benchmark entrants are
 * described by their theme and run record instead. */
export const builtInLevelBlurbs: Record<string, string> = {
  'crystal-corridor': 'A neon crystal corridor that shoots back: readable warm-up waves, lancers and homing shard bolts, then the Crystal Warden. This is the reference the benchmark aims at.',
  helios: 'A two-minute dive into a dying star, through a shattered Dyson gate and down the furnace road to the Suneater.',
  'prism-bloom': 'A short glassy rail of gates, comets, and echoes arranged in fan waves.',
  rezdle: 'A midnight press room where loose type drifts into screen slots. Lock the letters that spell a word and send it to print.',
};
