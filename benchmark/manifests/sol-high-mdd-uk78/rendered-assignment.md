# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `mass-driver-detailed-uk78`
- Display title: `Mass Driver`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/mass-driver-detailed-uk78/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id mass-driver-detailed-uk78 --title 'Mass Driver'`.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Mass Driver

Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.

## The idea

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle over exactly sixty seconds. The gun is the instrument: the run is scored to a locked 128 BPM minimal-techno pulse in E minor, and the core conceit is that **the payload crosses one glowing accelerator ring on every quarter-note beat**. The quarter-note grid is therefore the level's unit of distance as well as time: four rings per bar, breech to muzzle, and the gun fires on the downbeat of bar 28 whether or not the player is ready. Underneath everything a persistent bass hum — the gun spooling up — climbs in pitch across the whole run and accelerates into the firing charge, cutting dead on the shot.

The dramatic spine: the run strictly accelerates, the rings burn from arc blue through violet toward blinding white, and about two-thirds in a klaxon announces that the gun's six safety interlocks have jammed across the bore. The finale is a boss on a hard musical deadline: destroy all six interlocks before the charge peaks and the shot throws you cleanly out of the muzzle into silent open space; fail and the barrel detonates with you inside it.

## Timing skeleton

128 BPM, common time, 32 bars to exactly 60 seconds. The run reads as six moves:

- **injection** bars 0–4 — breech; the hum fades in, sparse pulse, first drones teach the sweep.
- **stage-1** bars 4–12 — the four-on-floor locks in.
- **stage-2** bars 12–20 — rings run violet; density rises; hostiles start shooting back.
- **interlock** bars 20–28 — the jammed interlocks; klaxon; charge builds to critical.
- **THE SHOT** — the downbeat of bar 28. Hard cut, not a crossfade.
- **muzzle** bars 28–32 — open space, silence winding down, zero enemies. Run ends at exactly 60 s.

Section transitions crossfade (roughly a bar or two each) except the shot, which is a hard cut.

## Mechanics and tuning

Standard lock-on rail-shooter flow. Player health: **3**. START word: **CHARGE**. REPLAY word: **RELOAD**.

### Acceleration

The gun only ever speeds up, and the acceleration should be genuinely felt so the shot lands as a physical kick. Author the pace as a rising curve: a slow start off the breech, a steady climb through the middle bars, a harder pull as the charge builds, then on the bar-28 downbeat a sudden roughly-threefold surge — THE SHOT — that hurls the payload down the last of the barrel and out the muzzle, easing off only slightly in open space. The camera reaches the end of the barrel exactly on the shot; rings, rails, and barrel wall all stop there.

### Rail

Deterministic, no randomness: a long line running mostly straight down the bore with a gentle weave so the tunnel reads and enemies get parallax without the camera clipping the wall (bore radius about 12). The weave tapers to zero right at the muzzle so the exit is clean and straight, and past the muzzle the line lifts gently upward into the black. The camera banks subtly into the weave — a cosmetic roll only.

### Enemy roster (five kinds)

All hostiles are machined from the same cold gunmetal, lit by thin electric edges and a small hot core, so silhouette and motion carry identity and everything stays readable even with the glow dialed down. Killing the tougher enemies is worth more, and every non-lethal armor chip pays a little.

1. **Coil** — a wall-riding sentry: a hexagonal maintenance pod with an arc-blue ring-lens eye, two violet-edged clamp hooks gripping the wall behind it, and a small emitter nub. Coils clamp to the bore wall ahead of the camera and slide slowly around the circumference, always facing inward with a lazy spin. They arrive in "ranks" at clock positions around the frame rim (12/2/4/6/8/10 o'clock), staggered a beat-fraction apart so a rank sweeps the whole rim rather than clustering center. From stage-2 some coils **fire**: a telegraphed rear-back, then a fast lunge inward loosing an **arc** bolt.

2. **Threader** — a needle drone corkscrewing through the bore: a long stretched nose, an ion-white hot core near the tip, three swept tail fins, and a translucent violet ion-tail. It crosses the full frame width along a shallow vertical arc while its body winds a helix around that path; sign alternates within a wave so pairs read as counter-rotating double helices. The nose points a moment ahead of its travel. It leaves once the crossing completes or the camera overtakes it.

3. **Capacitor** — a fat two-stage insulated bank drifting mid-bore: a hot violet core cylinder caged by six gunmetal insulator staves with ribbed end caps. Two hits shear the staves off in a burst along the six stave directions and expose the core, which then takes two more; once exposed the core brightens and shudders at high frequency. It faces the camera with a slow alternating roll and a lazy figure-drift.

4. **Arc** — ball lightning: an interceptable hostile bolt, lockable and worth killing, spawned in the moment rather than scheduled. An ion-white hot core inside two jagged wire shells that re-randomize their rotation and scale **every frame** — the unstable "this is incoming" tell. It homes on the camera, accelerating and braking as it closes, and deals one damage if it lands. It only counts as intercepted if the player's shot actually connects before impact; a bolt that expires unresolved does not.

5. **Interlock** (the boss, ×6) — a heavy hazard-striped X-clamp jamming the safety ring: two crossed gunmetal braces banded with amber hazard chevrons, around a central cowl hiding an ion-white actuator core. One hit pops the cowl and exposes the core, two more kill it. **Station-keeping**: rather than sit at a fixed point in the barrel (where the fog and speed would swallow it), each clamp holds a roughly constant lead ahead of the camera, so all six brood over the bore at frame-rim clock positions for the whole section and can never be overtaken or missed before the shot. Two of the six fire arc bolts. **The deadline**: any interlock still standing when the gun fires deals a lethal hit — the detonation.

### Spawn shape

The waves are authored, not random, and read as a rising cadence:

- **Injection**: a counter-rotating threader pair (the double-helix reveal), a four-coil rank, then a few threaders.
- **Stage-1** (a two-bar call-and-response between coil ranks and threader weaves): coil ranks alternate with threader weaves, and the **first capacitor** drifts in mid-section.
- **Stage-2** (density plus return fire): larger coil ranks with several firing, threader staggers, and paired capacitors — then a deliberate breath of empty air just before the klaxon.
- **Interlock**: the six clamps arrive in two ranks of three around the rim; threader chaff in pairs keeps the volleys mixed while the boss is worked down, tightening and closing in as the gun accelerates.
- **Muzzle**: intentionally empty.

### Scoring, rank, details

Volleys reward locking several targets at once, with a bonus for a clean full volley — a perfect six is worth a lot. **S rank requires the gun to have actually fired** (all six interlocks down in time) on top of a high score and clear rate; A/B/C step down from there. The end panel reports hull remaining out of 3 (a detonation counts as total hull loss), interlocks cleared out of 6, an intercepted-arcs count, and a verdict line — "PAYLOAD AWAY — muzzle exit clean" on success, "CHARGE CONTAINMENT FAILED" on detonation.

### HUD narration

Timed callouts frame the deadline: one bar before the interlocks, "WARNING — SAFETY INTERLOCKS JAMMED". While interlocks still stand, a rising charge readout — "CHARGE 60%", "CHARGE 85%", "CHARGE CRITICAL". Each interlock kill ticks "INTERLOCKS n/6", and the sixth reads "INTERLOCKS CLEAR — BRACE FOR SHOT". Just after a clean shot, "PAYLOAD AWAY".

## Visual language

Electric, not fire. A near-black void and cold gunmetal structure. Everything the gun accelerates runs "hot" up an electrical **heat ramp**: arc blue → volt violet → blinding near-white. The player's own kit — reticle, locks, shots — stays ion-white and arc blue: the one precise, in-control thing in the tunnel. **Hazard amber is strictly reserved** for the jammed interlocks, the charge warnings, denial (a harsher hazard red), and the detonation; nothing else in the level may be amber. The lock gradient climbs the same arc blue → violet → blinding, so the sixth lock reads as the gun "fully charged". Keep the glow on thin lines and small cores; large bright areas would white out the frame. Bloom is present but restrained, under a soft vignette.

### Environment

- **Accelerator rings** (the level's soul): a ring at every quarter-note beat, thin torus bodies with an additive rim, their colors climbing the heat ramp down the bore. Downbeat rings are a touch larger and deeper and carry four coil-housing lugs bolted at the diagonals. Each crossing lands exactly on a beat by construction: flash the just-passed ring, pre-glow the next, and throw a heat-colored shockwave pulse at the moment of crossing (bigger and brighter on downbeats). In attract mode the rings idle-shimmer. Through the interlock bars the rings ahead lean toward white with the charge, and the sixth interlock kill runs a brief full-tunnel white strobe sweep. Rings vanish past the muzzle.
- **Conductor rails**: four thin bright tubes running the whole barrel at the diagonals — the actual railgun rails — gradient arc blue → violet down the bore and pulsing with the beat. A strong speed cue.
- **Barrel wall**: dark gunmetal rib panels scattered around the bore just outside the drones' reach, so threaders weave in front of the wall; a scattered few carry a dim arc-blue service light.
- **Camera-riding speed streaks**: a dense shell of thin streaks around the camera, scrolled faster the faster the gun runs and slammed hard by the post-shot surge — dim at idle, brightening with speed and charge, blazing past the muzzle.
- **Charge glow**: a growing, brightening disc parked at the muzzle through the interlock bars — the visible firing charge. Cap its apparent size so the last interlocks stay legible against it; the true whiteout belongs to the shot, not the buildup.
- **Muzzle field** (open space): a deep starfield with a scatter of arc-blue and violet stars and a few bright ones, plus star-streaks, hidden by fog until the shot — and one distant pulsing ion-white beacon dead ahead, the thing you were launched toward.
- **Atmosphere**: blue-black void at the breech, warming toward violet by the interlocks, whitening as the charge peaks, then a hard cut to near-vacuum black past the muzzle.

### Enemies, reticle, letters, projectiles

- Build every hostile from a shared facet vocabulary: gunmetal fills, thin bright edges, and a small hot core with a glow shell, so a single tint pass drives every state — enemies brighten as they close, a lock turns them ion-white with a blue-tinted fill, a denial flushes them hazard-red for a beat, a hit flashes them blinding. They pop in with a quick overshoot, and each kind blows apart along its own facets on death.
- **Player shot**: a cold ion dart — a stretched white-hot core in a translucent arc-blue shell, dropping a blue trail.
- **Reticle = breech charge gauge**: a thin arc-blue ring around an ion-white center dot, with **six arc segments** that light one per lock, climbing the lock gradient — the sixth segment is ignition-white, so a full volley literally reads "fully charged". It spins faster while charging and grows slightly per lock.
- **Letters** (CHARGE / RELOAD): stencil plates off the gun housing — shallow gunmetal cell grids with a crisp arc-blue routed edge, legible at distance with the glow off because the outline carries the shape. Locked plates go ion-white; denied plates go hazard red.
- **Lock ring**: a hexagonal clamp of two nested rings, camera-facing and slowly rotating, sized per enemy and oversized on the interlocks.

### Effects

Everything a hit throws off is electrical, and this is a vacuum barrel — **no gravity** on particles. Straight-flying splinter sparks that align to their travel and wink out fast; thin expanding shockwave rings; cross-glints for the player's own impacts; **jagged arc-lightning polylines** that snap between two points and flicker as they die, on kills, armor chips, capacitor crackle, and denials; camera-facing flash discs for the muzzle whiteout and the detonation. Every event carries its tell: interlock spawns land a double hazard ring and a camera jolt, the sixth lock pumps a blinding bloom, kills throw a shatter-burst and a whip of arc lightning (interlock kills doubled and heavier), misses fizzle, rejects pulse.

### Screen overlays and camera feel

Three full-frame overlays over the scene: **flash** (flat white overload — the shot whiteout, smaller pumps on clean volleys, the sixth lock, and the interlocks-clear strobe), **charge** (a violet-white radial bloom pooling at frame center — the visible firing charge, ramping through the interlock bars but held back enough that the fight stays readable until the last bar and a half), and **detonation** (hazard red bleeding to white on containment failure, with small pulses on rejects and hits). They decay quickly.

Camera: a metallic gun-barrel rattle — quick and tight, more roll than pitch, the whole barrel ringing rather than a soft impact. The field of view breathes with airspeed, kicks a hair on every downbeat ring crossing, and THE SHOT lands a hard kick: a wide FOV punch, a heavy shake, a muzzle flash, and a full whiteout. The detonation shakes harder still, over a red-and-white overload.

## Musical language

128 BPM locked minimal techno in E minor. Main loop **Em–Em–C–D**, two bars per chord; the boss bars switch to **Em–F–Em–F** (the ♭II Phrygian dread); the muzzle resolves to a single sustained **E major** bloom — the whole run is minor, the release is major (a Picardy third). Moderate sidechain, a dotted delay, a long reverb; the kick's duck *is* the pump.

### The climbing hum

A persistent tonal drone: detuned saws over a sine sub through a lowpass, its fundamental steered bar by bar from the arrangement. It idles low in attract mode with a slow wobble. Across the run it climbs — up a fourth by the middle, up an octave by the interlocks, then an accelerating rise to the charge peak, the filter opening and the level swelling as it goes. **The shot cuts it dead in a heartbeat.** Death cuts it too; the run's end re-idles it.

### Arrangement by section

- **Injection**: sparse downbeat kick with ghost kicks creeping in, sparse hats, a quarter-note arp climbing in velocity, a noise riser into the drop. Attract mode is just a long pad and quarter arps over the idle hum.
- **Stage-1**: four-on-floor kick, offbeat hats, a driving eighth-note root bass, sparse arps, a slow pad.
- **Stage-2**: claps on 2 and 4, a sixteenth hat lattice with opens, a busier bass jumping octaves and fifths, the arp lifted an octave, and a **303 acid line** walking the chord.
- **Interlock**: a two-bar **klaxon** and a low impact; the kick gains late-bar syncopation; rising **alarm** sweeps every couple of bars; a noise riser that grows each bar; and in the final bar a snare roll building all the way into the shot.
- **Muzzle**: on the downbeat — impact, crash, a hard duck, the hum cut, and a huge E-major pad bloom. Then only glassy sparkle delays and a subsiding sub pulse, fading to silence.

### The player is the soloist

All player sounds are quantized to the transport and pitched from the live harmony, with **per-section timbres** for lock/kill/fire (glassy at the breech, tight and square in stage-1, bright saws in stage-2, dark reverb-heavy saws at the interlocks, quiet and hall-drenched at the muzzle) crossfaded across the boundaries. Locks walk up the live lead by lock count; unlock answers with a soft high tick; the **sixth lock is ignition** — an octave ping and a falling sub thump. Kills walk hidden per-section melodic lanes so a chained volley performs a real run; fire is a short falling zap; armor chips tick a soft arpeggio; stage breaks crack metallically and ring a chord tone into the hall; a full clean volley lands a chord stab an octave up.

Signature moments: each **interlock kill plays a climbing confirmation** — one more note than the last, brighter and higher each time, capped with an ignition ping and a clamp-release clank that drops in pitch per interlock. The **sixth** triggers a beat of ducked silence, an impact, a high chord stab, and a conclusive descent. **Reject** is a breaker trip: a dead low minor-second CLUNK falling into the floor — cold iron, no reward. A player hit booms a falling octave under a two-note hull alarm; a miss is a barely-there falling tick. **Detonation** cuts the music to a long low sub rumble and filtered noise.

## Feel targets

- Ring crossings must land audibly and visibly **on the beat** — this is the level's one non-negotiable.
- The bar-28 shot should feel like the single biggest moment in the game: simultaneous speed spike, whiteout, FOV kick, hum cut, and the E-major bloom.
- Interlocks must stay readable against the growing charge glow (cap the glow's apparent size; hold the clamps at the frame rim).
- The muzzle bars are the payoff for surviving: empty, silent, weightless. Resist the urge to fill them.
- S rank is reserved for a run where the gun actually fires and nearly everything died; a solid imperfect clear lands A.

