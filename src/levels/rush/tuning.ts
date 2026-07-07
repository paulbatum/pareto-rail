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
  ribs: {
    // World units between tunnel ribs; smaller values increase passage frequency.
    spacingUnits: 10.5,
    // World units from rail center to rib sides; smaller values create closer near-misses.
    nearMissRadiusUnits: 6.4,
    // World units of rib height; changes how much vertical structure whips by.
    heightUnits: 8.8,
    // Number of ribs kept ahead of the camera; raises visible tunnel density.
    aheadCount: 64,
    // Number of ribs kept behind the camera; prevents popping in rear peripheral vision.
    behindCount: 8,
    // Every Nth rib becomes a hot strobe gate; lower values increase beat-like flashing.
    strobeEvery: 4,
    // Seconds a strobe gate stays hot after a beat; raises temporal smear of light rings.
    strobeHoldSeconds: 0.12,
  },
  dashRails: {
    // World units between longitudinal dash starts; smaller values make speed easier to read.
    spacingUnits: 7,
    // World units per dash segment; longer dashes become streakier rails.
    lengthUnits: 4.4,
    // World units from rail center to each side strip; changes near-field side parallax.
    sideOffsetUnits: 5.2,
    // World units below rail center for strips; lowers or raises the trench floor cue.
    verticalOffsetUnits: -3.8,
  },
  streaks: {
    // Baseline streak line count at cruise; raises particle density even before surges.
    baseCount: 120,
    // Extra streak lines per speed factor above 1; raises density during boosts.
    countPerSpeedFactor: 95,
    // Maximum streak line count; caps fill rate and bloom load.
    maxCount: 320,
    // World units of streak length at cruise; longer values smear near-camera particles.
    baseLengthUnits: 7.5,
    // Extra world units of streak length per speed factor above 1; makes boosts draw longer lines.
    lengthPerSpeedFactor: 13,
    // World units per second of local particle travel at cruise; raises apparent starfield speed.
    baseVelocityUnitsPerSecond: 140,
    // Extra world units per second per speed factor above 1; accelerates streaks during boosts.
    velocityPerSpeedFactor: 190,
    // World units in front of camera where streaks recycle; lowers values put streaks nearer the lens.
    depthRangeUnits: 76,
    // World units from camera center to streak field edge; raises peripheral streak coverage.
    spreadRadiusUnits: 17,
  },
  post: {
    // Blur mix at speed factor 1; raises constant radial smear in cruise.
    radialBlurBase: 0.035,
    // Blur mix added per speed factor above 1; raises speed-dependent radial smear.
    radialBlurPerSpeedFactor: 0.18,
    // Maximum radial blur mix; caps post intensity at the fastest stretch.
    radialBlurMax: 0.42,
    // Extra blur pulse at surge onset; makes boost entries hit harder.
    surgeBlurPulse: 0.32,
    // 1/seconds pulse decay; higher values make surge blur recover faster.
    surgeBlurDecay: 3.2,
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
    // Seconds ahead of spawn time where most targets sit on the rail; lower values make targets rush closer.
    defaultLeadSeconds: 1.6,
    // World units from rail center for enemy lane spread; larger values reduce target overlap.
    laneRadiusUnits: 4.3,
    // Seconds before a target is considered missed after passing its anchor; larger values make high speed more forgiving.
    missGraceSeconds: 0.34,
  },
} as const;

export const RUSH_TIME = createMusicTime(RUSH_TUNING.bpm, { stepsPerBar: RUSH_TUNING.stepsPerBar });
export const RUSH_RUN_DURATION = RUSH_TIME.bar(RUSH_TUNING.runBars);
