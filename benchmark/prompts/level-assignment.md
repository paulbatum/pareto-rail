# Benchmark level assignment

Read `AGENTS.md`, `docs/level-authoring.md`, and `docs/level-brief.md` before starting. All repository instructions and the standing brief apply. This assignment supplies the benchmark-specific identity, scope, and quality expectations; it does not relax the standing brief's hard constraints.

## Level identity

- Level id: `{{LEVEL_ID}}`
- Display title: `{{LEVEL_TITLE}}`

Use this identity consistently in the level directory, registry entry, metadata, and generated gallery card.

## Scope

Aim for a **90-second playable run**. A duration from **85 to 95 seconds** is acceptable when needed to end on a natural musical phrase. This duration covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it. The soundtrack, spawn choreography, environment, and dramatic arc should be composed for the full run rather than padded or cut off to meet the number.

Treat the duration as a scope budget. Prefer a small number of memorable, fully resolved ideas over a larger collection of shallow features. The finished level should sustain variety and escalation across the run without becoming an overextended catalogue of mechanics.

## Creative mandate

Treat the assigned theme as creative direction, not a checklist. Find a strong interpretation and make bold, authored decisions about structure, motion, interaction, sound, and visual language. Add ideas that strengthen the theme, omit implied details that would weaken the whole, and let one coherent creative thesis govern the result.

The level should feel attributable to a particular creative vision rather than assembled from minimum requirements. Do not imitate the composition, palette, geometry, soundtrack, enemy roster, or set pieces of an existing level. Reading the current quality bar is calibration for completeness and finish, not an invitation to reuse its design.

Create at least one signature player-facing moment that could identify this level without its title. It may arise from choreography, environment, enemy behavior, interaction, music, or a tightly synchronized combination. It should belong naturally to the level rather than feeling like an isolated technical demonstration.

## Finish standard

Build a showcase piece, not a prototype. Mechanical completeness is the midpoint, not the handoff condition. Once the level works and the required gates pass, inspect its simulation and useful visual captures, then refine it. Spend the remaining effort where a player will feel it most:

- readable and expressive enemy motion;
- purposeful wave composition and pacing;
- tactile locks, volleys, impacts, and full-chain payoffs;
- transitions and signature moments that land visually and musically;
- a soundtrack with an authored arc and player actions integrated into its harmony and rhythm;
- a balanced mix and a consistent event language; and
- composition, contrast, and target legibility during actual play, including with bloom disabled.

Do not stop at the first passing build, and do not substitute feature count or code volume for polish. Remove or simplify ideas that cannot be brought to the same standard as the rest of the level.

## Working method

Work autonomously through implementation, mechanical verification, inspection, and refinement. Make reasonable creative and technical decisions without waiting for operator feedback. Stay within the permitted level scope; do not modify shared code to make the concept easier.

Use the repository's simulation, floor checks, spawn traces, audio traces, and visual inspection tools where they provide useful evidence. Headless captures are composition aids rather than proof of final WebGPU image quality. End with an honest handoff describing verification evidence and the most important things a human should evaluate in a real playtest.

## Assigned theme

{{THEME}}
