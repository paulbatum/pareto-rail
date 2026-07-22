export const homeCopy = {
  eyebrow: 'A playable benchmark',
  title: 'Tired of being told which model is best?',
  titleAccent: 'Decide for yourself.',
  lede: 'Play 60-second rail-shooter levels built by models. Rank them blind, then see your own personalized pareto chart.',
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

/** The spoiler nudge shown to visitors who have not yet ranked. This page names
 * the model behind each level and its cost — knowledge that skews a blind vote. */
export const levelsSplashCopy = {
  intro: {
    heading: 'Spoiler warning',
    body: 'On this page you can browse all the levels and see which model built them. We suggest ranking a few levels blind first — the comparison is fairer before you know who made what.',
  },
  newAdditions: {
    heading: (count: number) => `${count} new level${count === 1 ? '' : 's'} since your last visit.`,
    body: (count: number) => count === 1
      ? 'It has joined the blind comparison. We suggest ranking it before the catalog tells you who built it.'
      : 'They have joined the blind comparison. We suggest ranking them before the catalog tells you who built them.',
  },
  primary: 'Rank levels blind ▸',
  secondary: 'Browse anyway',
} as const;
