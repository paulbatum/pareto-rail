import { DirectionalLight, Group } from 'three';
import { bakeEnvironment, createGradientSky } from '../../../engine/environment-light';
import type { SnapshotContext } from '../../../dev-tools/snapshot';
import { SUN_DIRECTION } from '../route';
import { createEnemyModel } from './index';
import { SKY, SUNLIGHT } from './palette';

/**
 * Model snapshots under the level's own light: the baked morning sky and the sun.
 *
 *   npm run snapshot -- --module src/levels/spillway/visuals/studio.ts --export createEnemyStudio --args '["pod", 30]' --angles 1
 */
export function createEnemyStudio(kind: string, yawDegrees = 0, letter?: string) {
  return ({ renderer, scene }: SnapshotContext) => {
    const sky = createGradientSky({ zenith: SKY.zenith, horizon: SKY.horizon, ground: SKY.ground, sunDirection: SUN_DIRECTION, sunColor: SKY.sun, skyIntensity: 0.62, sunIntensity: 2.5, sunAngularRadius: 0.08 });
    bakeEnvironment(renderer, () => sky.scene, { sigma: 0.04, size: 128 }).attach(scene);
    const sun = new DirectionalLight(SUNLIGHT, 4);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(50);
    scene.add(sun);
    const group = new Group();
    group.add(createEnemyModel(kind, letter));
    group.rotation.y = (yawDegrees * Math.PI) / 180;
    return group;
  };
}
