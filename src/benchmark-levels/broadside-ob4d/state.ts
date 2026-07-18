// Cross-cutting run state. Gameplay writes it; audio, visuals, and the HUD
// narration read it. Keeping it in one small module means the boss's shield
// status and the player's last volley shape are readable from every layer
// without threading a controller through the runner contract.

export const battle = {
  /** Last resolved volley fired entirely into one flank — the level's namesake. */
  broadsideVolley: false,
  broadsideSize: 0,
  /** Shield generators destroyed on the enemy flagship (of GENERATOR_COUNT). */
  generatorsDown: 0,
  /** True once enough emitters are gone for the flagship's shield to collapse. */
  shieldDown: false,
  /** Reactor cores destroyed in the trench (of CORE_COUNT). */
  coresDown: 0,
  /** True once the last core blows: the flagship is finished. */
  flagshipKilled: false,
  /** Run time of the killing blow, for the pull-out camera and the victory cue. */
  flagshipKilledAt: -1,

  reset() {
    battle.broadsideVolley = false;
    battle.broadsideSize = 0;
    battle.generatorsDown = 0;
    battle.shieldDown = false;
    battle.coresDown = 0;
    battle.flagshipKilled = false;
    battle.flagshipKilledAt = -1;
  },
};
