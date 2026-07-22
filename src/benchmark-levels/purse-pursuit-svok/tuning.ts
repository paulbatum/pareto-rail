/**
 * Every number that shapes the world sits here so a reader calibrating against
 * this level never has to open a mesh factory. One unit is one metre: the rail
 * runs ~1980m in 60s, so cruise is about 33 m/s and the chorus drop pushes
 * close to 39 m/s.
 */
export const PURSE_TUNING = {
  rail: {
    lengthUnits: 1980,
    /** Peak lateral sweep of the highway, in metres either side of centre. */
    sweepUnits: 6.5,
    /** Peak vertical relief where the road crests and dips under overpasses. */
    reliefUnits: 1.7,
    tension: 0.3,
    /** Degrees of camera bank per unit of normalized lateral tangent. */
    bankDegrees: 7.2,
  },

  road: {
    /** The rail is the passenger window, not the centre line: the deck sits left of it. */
    centreOffsetUnits: -2.0,
    laneWidthUnits: 3.6,
    laneCount: 6,
    shoulderWidthUnits: 2.4,
    /** Camera height above the deck. Low enough that the surface tears past. */
    cameraHeightUnits: 1.25,
    dashSpacingUnits: 13,
    dashLengthUnits: 4.6,
    dashWidthUnits: 0.16,
    /** Longitudinal sample spacing for the swept road ribbon. */
    ribbonStepUnits: 9,
  },

  world: {
    fog: { colour: 0x0a0714, nearUnits: 5, farUnits: 122 },
    guardrail: { heightUnits: 0.92, postSpacingUnits: 7.4 },
    streetlight: {
      spacingUnits: 34,
      poleHeightUnits: 8.4,
      armLengthUnits: 5.2,
      offsetUnits: 15.5,
      visibleAheadUnits: 190,
      visibleBehindUnits: 34,
    },
    overpass: {
      spacingUnits: 235,
      clearanceUnits: 9.8,
      depthUnits: 7.5,
      visibleAheadUnits: 220,
      visibleBehindUnits: 40,
    },
    skyline: {
      count: 34,
      spacingUnits: 74,
      offsetUnits: 62,
      widthRangeUnits: [16, 42],
      heightRangeUnits: [22, 96],
      visibleAheadUnits: 340,
      visibleBehindUnits: 80,
      seed: 90210,
    },
    traffic: {
      // Sparse, and only on the far side of the deck: civilian cars are a speed
      // cue, and anything in the lanes you shoot into is a target you cannot see.
      count: 10,
      laneOffsetsUnits: [-10.6, -7.0],
      speedRangeUnitsPerSecond: [16, 25],
      recycleAheadUnits: 200,
      recycleBehindUnits: 26,
      seed: 5150,
    },
  },

  enemies: {
    /** Distance ahead where a rider first reads through the haze. */
    spawnAheadUnits: 27,
    defaultLeadSeconds: 3.4,
    missGraceSeconds: 0.22,
    /** Lane centres a rider can occupy, relative to the rail. */
    laneOffsetsUnits: [-11.6, -8.2, -5.0, 2.6, 5.8, 8.0],
    /** Model-space depth from a bike's origin down to its contact patch. */
    rideHeightUnits: 1.05,
    /** Bikes are drawn over life size: at 27m a real one is four pixels tall. */
    modelScale: 1.32,
    /** Riders stay on the tarmac: lateral motion is clamped to these edges. */
    lateralLimitsUnits: [-12.2, 8.2],
  },

  boss: {
    /** Metres ahead the boss holds while it fights. */
    standoffUnits: 26,
    /** How far it closes when it charges you between salvos. */
    chargeUnits: 11,
    modelScale: 1.85,
    /** Four chrome plates, four exposure windows: 18 locks to strip the bike. */
    stageHitPoints: [3, 4, 5, 6],
  },

  camera: {
    fovPerSpeedExcess: 16,
    maxFovOffsetDegrees: 7,
    fovResponse: 3.4,
    /** Lane-change sway: degrees of roll and metres of lateral lean. */
    swayDegrees: 2.6,
    roadRumbleTrauma: 0.055,
    volleyKickDegrees: 2.2,
  },
} as const;

export const PURSE_PLAYER_HEALTH = 4;
