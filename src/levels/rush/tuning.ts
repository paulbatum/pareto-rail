import { createMusicTime } from '../../engine/music-time';

export const RUSH_TUNING = {
  // Beats per minute; raises beat density and makes the tunnel strobes fire faster.
  bpm: 170,
  // Sixteenth-note steps per bar; changes authored musical/grid timing resolution.
  stepsPerBar: 16,
  // Bars in the run; sets the clean musical duration for the speed test.
  runBars: 21,
  rail: {
    // World units from start to finish; raises base forward velocity when increased.
    lengthUnits: 1680,
    // World units of horizontal sweep; widens the long bends and camera banking cue.
    bendWidthUnits: 46,
    // World units of vertical sweep; adds subtle rise/fall parallax without tight turns.
    bendHeightUnits: 18,
    // Normalized look-ahead on the rail; larger values calm the camera at speed.
    cameraLookAheadU: 0.025,
    // Degrees of roll at full bend; raises the banking sensation in long curves.
    bankDegrees: 12,
  },
  speedProfile: {
    // [seconds, multiplier] keys; higher multipliers compress rail distance into less time and intensify every speed cue.
    keys: [
      [0, 0.9],
      [4.6, 0.98],
      [5.45, 1.9],
      [7.2, 1.28],
      [11.6, 1.05],
      [12.35, 2.0],
      [14.7, 1.3],
      [20.3, 1.12],
      [21.2, 2.3],
      [29.7, 2.55],
    ] as const,
    // Seconds around a rising speed key that count as a surge onset for camera/post pulses.
    surgeWindowSeconds: 0.11,
    // Multiplier jump required to trigger a surge kick; lower values make smaller accelerations punch the camera/post.
    surgeMinimumDelta: 0.45,
  },
  fov: {
    // Degrees added per speed factor above 1; larger values widen the lens during boosts.
    offsetDegreesPerSpeedFactor: 13,
    // Maximum sustained FOV offset in degrees; caps the wide-angle speed distortion.
    maxOffsetDegrees: 19,
    // Degrees of decaying FOV kick at surge onset; larger values make boosts punch outward.
    surgeKickDegrees: 7,
    // 1/seconds response for FOV offset; higher values make lens coupling more immediate.
    response: 10,
  },
  shake: {
    // Trauma added per second per speed factor above 1; raises continuous turbulence at speed.
    traumaPerSecondPerSpeedFactor: 0.42,
    // Maximum stored trauma; caps shake so the reticle stays roughly usable.
    maxTrauma: 0.82,
    // Degrees of pitch shake at full trauma; raises vertical camera jitter.
    pitchDegrees: 0.18,
    // Degrees of yaw shake at full trauma; raises horizontal camera jitter.
    yawDegrees: 0.16,
    // Degrees of roll shake at full trauma; raises rotational turbulence.
    rollDegrees: 0.44,
    // Noise cycles per second; higher values make the shake feel like high-speed vibration.
    frequency: 18,
    // 1/seconds trauma decay; higher values shorten turbulence memory.
    decay: 1.45,
    // 1/seconds smoothing; higher values make shake sharper and less floaty.
    smoothing: 34,
  },
  street: {
    // World units across the drivable road; wider values push curbs and scenery farther from enemy lanes.
    roadWidthUnits: 24,
    // World units from camera/rail down to asphalt; raises or lowers the flight height over the street.
    cameraHeightOverRoadUnits: 5.6,
    // World units between lane dash starts; smaller values increase road-surface speed ticks.
    laneDashSpacingUnits: 7.2,
    // World units of each painted lane dash; longer values make road markings streakier.
    laneDashLengthUnits: 4.4,
    // World units across each painted lane dash; wider values make road markings easier to read.
    laneDashWidthUnits: 0.22,
    // World units from road center for the two dashed lane divider lines; spreads road markings laterally.
    laneDashOffsetsUnits: [-4, 4] as const,
    // World units of curb height above road; increases the side edge silhouette.
    curbHeightUnits: 0.34,
    // World units of sidewalk width beyond each curb; separates towers and poles from the road.
    sidewalkWidthUnits: 2.2,
    // Number of road samples per lane dash interval; higher values make bends smoother.
    samplesPerDash: 2,
  },
  buildings: {
    // Deterministic layout seed; changes skyline/window scatter without changing density settings.
    seed: 914170,
    // World units from road center to closest tower face; must stay outside target lanes and widens the canyon.
    faceOffsetUnits: 21,
    // World units of extra random distance behind the tower face; higher values make a looser skyline.
    setbackRangeUnits: 3.8,
    // World units between building placement slots; smaller values increase wall passage frequency.
    blockSpacingUnits: 12,
    // Every Nth building slot is skipped; lower values open more alley gaps.
    gapEvery: 7,
    // World units range for tower width across the street; changes wall chunk size and silhouette variety.
    widthRangeUnits: [5.5, 10.5] as const,
    // World units range for tower depth along the street; changes how long each facade whips past.
    depthRangeUnits: [7.5, 17] as const,
    // World units range for tower height; higher values keep tops out of frame.
    heightRangeUnits: [32, 88] as const,
    // Fraction of candidate windows that light up; raises or lowers sparse night-window scatter.
    windowLightDensity: 0.08,
    // [width, height] in world units for each lit window quad; larger values make windows read farther away.
    windowSizeUnits: [0.26, 0.16] as const,
    // World units between candidate window columns; smaller values create finer window scatter.
    windowColumnSpacingUnits: 1.15,
    // World units between candidate window rows; smaller values create denser vertical window opportunities.
    windowRowSpacingUnits: 1.45,
    // World units kept visible ahead of the camera; should sit just beyond the opaque fog wall.
    visibleAheadUnits: 126,
    // World units kept visible behind the camera; prevents side-wall popping in peripheral vision.
    visibleBehindUnits: 36,
  },
  traffic: {
    // Deterministic traffic seed; changes car spacing/lane choices without changing speed settings.
    seed: 220174,
    // Count of same-direction cars recycled through the visible fog window; raises overtaking cues.
    sameDirectionCount: 12,
    // Count of oncoming cars recycled through the visible fog window; raises headlight closing-frequency cues.
    oncomingCount: 10,
    // World units per second range for same-direction cars; higher values reduce how quickly the player overtakes them.
    sameDirectionSpeedRangeUnitsPerSecond: [14, 30] as const,
    // World units per second range for oncoming cars; higher values make headlight pairs close faster.
    oncomingSpeedRangeUnitsPerSecond: [38, 66] as const,
    // World units from road center for same-direction lanes; changes where taillights streak below camera.
    sameDirectionLaneOffsetsUnits: [-6.4, -2.1] as const,
    // World units from road center for oncoming lanes; changes where headlight pairs approach below camera.
    oncomingLaneOffsetsUnits: [2.1, 6.4] as const,
    // World units of car body length; longer values make traffic silhouettes more visible.
    carLengthUnits: 3.9,
    // World units of car body width; wider values fill more of each traffic lane.
    carWidthUnits: 1.7,
    // World units of car body height; taller values make cars read more clearly from above.
    carHeightUnits: 0.95,
    // World units of gap between paired headlights or taillights; widens light pairs.
    lightPairSpacingUnits: 1.05,
    // [width, height] in world units for each car light quad; larger values make traffic lights more prominent.
    lightSizeUnits: [0.5, 0.26] as const,
    // World units above road for car lights; raises headlight and taillight quads.
    lightHeightUnits: 0.42,
    // World units ahead of the camera used for car recycling; should sit just beyond the opaque fog wall.
    recycleAheadUnits: 126,
    // World units behind camera retained for traffic; keeps overtaken cars briefly in peripheral vision.
    recycleBehindUnits: 36,
  },
  streetFurniture: {
    // Deterministic furniture seed; changes small lamp/gantry variation without changing spacing settings.
    seed: 701942,
    // World units between streetlight poles on each curb; smaller values increase curbside passage frequency.
    streetlightSpacingUnits: 19,
    // World units from road center to each pole; must stay outside target lanes and controls curb silhouette.
    poleOffsetUnits: 15.2,
    // World units from road to lamp head; higher values lift lights above the reticle lane.
    poleHeightUnits: 6.1,
    // [width, height, depth] in world units for each lamp head; larger values make sodium lights chunkier.
    lampHeadSizeUnits: [0.55, 0.18, 0.38] as const,
    // World units of pole thickness; wider values make poles more visible but risk occlusion.
    poleRadiusUnits: 0.055,
    // World units between overhead gantry slots; smaller values make overhead bars whip past more often.
    gantrySpacingUnits: 42,
    // Every Nth gantry strobes on the beat; lower values increase beat-synced flashes.
    gantryStrobeEvery: 2,
    // Seconds a strobe gantry stays hot after a beat; raises temporal smear of overhead flashes.
    strobeHoldSeconds: 0.12,
    // World units from road to gantry crossbar; higher values reduce target occlusion.
    gantryHeightUnits: 16.2,
    // World units of gantry crossbar thickness; wider values make overhead passes chunkier.
    gantryBarThicknessUnits: 0.18,
    // World units kept visible ahead of the camera; should sit just beyond the opaque fog wall.
    visibleAheadUnits: 126,
    // World units kept visible behind the camera; prevents curbside popping behind the camera.
    visibleBehindUnits: 36,
  },
  post: {
    // Unitless orange flash pulse at surge onset; makes boost entries hit harder without controlling global blur.
    surgeFlash: 0.22,
    // 1/seconds pulse decay; higher values make surge flash recover faster.
    surgeDecay: 3.2,
  },
  fog: {
    // World units from camera where fog begins; lower values make structures emerge later.
    nearUnits: 8,
    // World units from camera where fog becomes opaque; lower values create a shorter dark tunnel.
    farUnits: 104,
    // Hex color of the fog; changes the darkness/color structures emerge from.
    color: 0x02040a,
  },
  enemies: {
    // World units ahead of the camera where paced targets hold for their authored lock-on window.
    engageAheadUnits: 34,
    // World units from rail center for enemy lane spread; larger values reduce target overlap.
    laneRadiusUnits: 4.3,
    // Seconds after a paced exit completes before a surviving target is counted as missed.
    missGraceSeconds: 0.34,
  },
} as const;

export const RUSH_TIME = createMusicTime(RUSH_TUNING.bpm, { stepsPerBar: RUSH_TUNING.stepsPerBar });
export const RUSH_RUN_DURATION = RUSH_TIME.bar(RUSH_TUNING.runBars);
