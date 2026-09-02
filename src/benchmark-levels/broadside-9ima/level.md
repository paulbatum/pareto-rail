# Broadside

A 60-second space-opera fleet engagement flown through the crossfire of kilometer-long capital ships. You launch off the flight deck of the carrier *Aegis* directly into a chaotic battle between ice-white friendly battlecruisers and obsidian enemy warships. You bank and corkscrew through dogfighting swarms, scream down the flank of the cruiser *Resolute* as its massive dorsal broadside cannons fire overhead, dive beneath the belly of an enemy warship raking its gun turrets, and mount a two-phase assault on the enemy flagship *Behemoth*. After shredding its shield generators and diving its armored spine trench to detonate its exposed power cores, the camera pulls high above the burning battlefield as the enemy line scatters to a triumphant brass victory theme.

## Visual language
Deep space is backlit by a colossal procedural magenta-and-gold nebula spanning the horizon, rimming every capital ship hull in high-contrast colored light. Fleets read instantly by color: the friendly fleet is ice-white armor plate with cyan sublight engine glow and electric cyan plasma fire; the enemy fleet is obsidian matte armor streaked with molten orange heat conduits, firing crimson energy bolts. Procedural 5×7 armor plaques form high-contrast LAUNCH and ENGAGE glyphs that remain razor-sharp and legible with bloom set to zero.

## Musical language
120 BPM space-opera orchestral score in D minor, driven by live harmonic progression and full acoustic instrumentation: heavy timpani, marching snare, crash cymbals, heroic high trumpet fanfares, rich low brass foundations, spiccato strings ostinato, and soaring legato pads. The music tracks the dramatic narrative arc: swelling during the launch, driving through the crossfire, pounding with cannon discharges during the friendly flank run, brooding with sinister low brass beneath the enemy cruiser, and dropping to breathless quiet in the eye of the battle before surging into the dual-phase flagship boss march and landing on a grand D Major Picardy victory fanfare. Locks and fire snap to the transport, and kills play a written melodic lane from the live harmony so chained volleys perform heroic solos.

## Mechanical signature
Four-point hull integrity. Enemy waves consist of agile forward-swept Swarm Darts weaving in wide sinusoidal banking sweeps, heavy Swarm Bombers diving in high-angle strafing runs, and capital ship surface turrets tracking the player camera. The climax features the flagship *Behemoth* in two authored phases: Phase 1 requires destroying three rotating shield generator pylons along the starboard hull shelf while dodging point defense fire; Phase 2 loops into the central trenchwork to detonate two exposed multi-stage reactor cores, triggering the finale.

## What to read
- `src/benchmark-levels/broadside-9ima/index.ts`
- `src/benchmark-levels/broadside-9ima/gameplay.ts`
- `src/benchmark-levels/broadside-9ima/audio.ts`
- `src/benchmark-levels/broadside-9ima/visuals/index.ts`

## Status & notes
Showcase build. Key inspection markers:
- `deckLaunch` (bar 0, 0.0s): catapult release off the carrier flight deck.
- `fleetCrossfire` (bar 4, 8.0s): corkscrewing through capital ship engagement.
- `flankSalvo` (bar 10, 20.0s): high-speed flank run under Resolute's firing broadsides.
- `bellyPass` (bar 16, 32.0s): raking turrets under enemy cruiser keel.
- `battleEye` (bar 20, 40.0s): quiet breath facing the enemy flagship against the nebula.
- `flagshipShields` (bar 22, 44.0s): Boss Phase 1 shield generator strikes.
- `escortTurn` (bar 25, 50.0s): turnaround loop through escort fighter swarm.
- `trenchCore` (bar 27, 54.0s): Boss Phase 2 trench dive destroying power systems.
- `victoryPullout` (bar 29, 58.0s): flagship destruction and wide battlefield panorama.

Human playtester should observe the scale contrast between the agile fighter and kilometer-long cruisers, the overhead broadside flash illumination, bloom-zero target silhouette readability against the nebula, and the seamless transition from the quiet eye into the climactic victory theme.
