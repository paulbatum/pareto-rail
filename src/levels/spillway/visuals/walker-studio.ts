import { DirectionalLight, Group, Vector3 } from 'three';
import { bakeEnvironment, createGradientSky } from '../../../engine/environment-light';
import type { SnapshotContext } from '../../../dev-tools/snapshot';
import { SUN_DIRECTION } from '../route';
import { bar } from '../timing';
import { resetWalkerDamage, solveWalker, walkerDamage } from '../walker';
import { WALKER_COLORS } from './environment';
import { SKY, SUNLIGHT } from './palette';
import { createWalker } from './walker';
import type { Spray } from './spray';

/**
 * The walker posed at a bar, under the level's light, for model snapshots.
 * `damage` breaks that many legs (in fight order) a bar earlier; 5 also kills the core.
 *
 *   npm run snapshot -- --module src/levels/spillway/visuals/walker-studio.ts --export createWalkerStudio --args '[12, 0, 0]' --angles 4
 */
export function createWalkerStudio(atBar: number, yawDegrees = 0, damage = 0) {
  return ({ renderer, scene }: SnapshotContext) => {
    const sky = createGradientSky({ zenith: SKY.zenith, horizon: SKY.horizon, ground: SKY.ground, sunDirection: SUN_DIRECTION, sunColor: SKY.sun, skyIntensity: 0.62, sunIntensity: 2.5, sunAngularRadius: 0.08 });
    bakeEnvironment(renderer, () => sky.scene, { sigma: 0.04, size: 128 }).attach(scene);
    const sun = new DirectionalLight(SUNLIGHT, 4);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(50);
    scene.add(sun);

    const time = bar(atBar);
    resetWalkerDamage();
    for (let leg = 0; leg < Math.min(4, damage); leg += 1) walkerDamage.legDownAt[leg] = time - bar(1);
    if (damage >= 4) walkerDamage.coreOpenAt = time - bar(1);
    if (damage >= 5) walkerDamage.coreDownAt = time - bar(0.5);
    walkerDamage.version += 1;
    const walker = createWalker(WALKER_COLORS);
    walker.update(time, 0, { spray: null as unknown as Spray, camera: new Vector3(), waterAt: () => 0, setGateStrain: () => {} });
    const centre = new Group();
    centre.add(walker.group);
    const rig = solveWalker(time);
    walker.group.position.set(-rig.pose.position.x, -rig.pose.position.y, -rig.pose.position.z);
    const turn = new Group();
    turn.add(centre);
    turn.rotation.y = (yawDegrees * Math.PI) / 180 + rig.footYaw * -1;
    return turn;
  };
}
