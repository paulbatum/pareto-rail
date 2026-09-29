import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../engine/rng';
import { GUNMETAL, HAZARD, PANEL_WHITE } from './palette';

// Speed comes from the world falling away. Two camera-relative fields of
// world-fixed points, recycled as the climb overtakes them:
//  - streaks: rain in the storm, ice-dust in the clear air, hair-thin glints in
//    the vacuum — stretched along the climb by the actual speed;
//  - debris: white panel chips, dark plating and hazard-orange scrap tumbling
//    past in the thin air, the wreckage of everything that has tried this climb.

const Z = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);

const streakQuat = new Quaternion();
const spinQuat = new Quaternion();
const matrix = new Matrix4();
const scale = new Vector3();
const rel = new Vector3();
const right = new Vector3();
const up = new Vector3();
const pos = new Vector3();

export type Air = {
  group: Group;
  update(dt: number, cameraPosition: Vector3, climb: Vector3, time: number, speed: number, running: boolean): void;
};

export function createAir(): Air {
  const group = new Group();
  const rng = mulberry32(0xa1b2c3);

  // streaks -------------------------------------------------------------------------
  const streakCount = 460;
  const streakMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const streaks = new InstancedMesh(new BoxGeometry(1, 1, 1), streakMaterial, streakCount);
  const streakPos = new Float32Array(streakCount * 3);
  const streakSeed = new Float32Array(streakCount);
  const color = new Color();
  for (let i = 0; i < streakCount; i += 1) {
    streakSeed[i] = rng();
    streaks.setColorAt(i, color.setScalar(0.5 + rng() * 0.5));
    streakPos[i * 3] = Number.NaN;
  }
  streaks.frustumCulled = false;
  streaks.userData.raildIgnoreOcclusion = true;
  group.add(streaks);

  // debris chips ----------------------------------------------------------------------
  const debrisCount = 110;
  const debrisMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const debris = new InstancedMesh(new BoxGeometry(1, 0.1, 0.72), debrisMaterial, debrisCount);
  const debrisPos = new Float32Array(debrisCount * 3);
  const debrisAxis: Vector3[] = [];
  const debrisSpin = new Float32Array(debrisCount);
  const debrisSize = new Float32Array(debrisCount);
  const debrisRot: Quaternion[] = [];
  for (let i = 0; i < debrisCount; i += 1) {
    debrisPos[i * 3] = Number.NaN;
    debrisAxis.push(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize());
    debrisSpin[i] = 0.5 + rng() * 2.6;
    debrisSize[i] = 0.35 + Math.pow(rng(), 2.2) * 2.4;
    debrisRot.push(new Quaternion().setFromAxisAngle(debrisAxis[i], rng() * 6.28));
    const roll = rng();
    const base = roll < 0.5 ? PANEL_WHITE : roll < 0.78 ? GUNMETAL : HAZARD;
    debris.setColorAt(i, color.copy(base).multiplyScalar(roll < 0.5 ? 0.85 + rng() * 0.3 : roll < 0.78 ? 1.6 : 1.1));
  }
  debris.frustumCulled = false;
  debris.userData.raildIgnoreOcclusion = true;
  group.add(debris);

  function respawn(target: Float32Array, index: number, camera: Vector3, climb: Vector3, alongMin: number, alongMax: number, radMin: number, radMax: number) {
    const along = alongMin + Math.random() * (alongMax - alongMin);
    const radius = radMin + Math.sqrt(Math.random()) * (radMax - radMin);
    const angle = Math.random() * Math.PI * 2;
    pos.copy(camera).addScaledVector(climb, along).addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius);
    target[index * 3] = pos.x;
    target[index * 3 + 1] = pos.y;
    target[index * 3 + 2] = pos.z;
  }

  return {
    group,
    update(dt, cameraPosition, climb, time, speed, running) {
      right.crossVectors(climb, WORLD_UP).normalize();
      up.crossVectors(right, climb).normalize();
      streakQuat.setFromUnitVectors(Z, climb);

      // How much of each field is alive, and how it looks, by act.
      const rain = 1 - MathUtils.smoothstep(time, 13.6, 15.4);
      const dust = MathUtils.smoothstep(time, 15.4, 17) * (1 - MathUtils.smoothstep(time, 30, 36) * 0.55);
      const glint = MathUtils.smoothstep(time, 30, 38);
      const streakActive = Math.round(streakCount * MathUtils.clamp(rain + dust * 0.16 + glint * 0.1, 0, 1) * (running ? 1 : 0.55));
      const stretch = running ? MathUtils.clamp(speed * 0.02, 0.4, 3.6) : 1.4;
      const len = stretch * (rain > 0.5 ? 1.5 : 1);
      const thick = rain > 0.5 ? 0.04 : 0.022;
      streakMaterial.opacity = 0.34 * (0.16 + rain * 0.84 + dust * 0.1 + glint * 0.16);
      streakMaterial.color.setRGB(rain > 0.5 ? 0.7 : 0.9, rain > 0.5 ? 0.76 : 0.94, 1);
      streaks.count = streakActive;
      for (let i = 0; i < streakActive; i += 1) {
        const ix = i * 3;
        let need = Number.isNaN(streakPos[ix]);
        if (!need) {
          rel.set(streakPos[ix] - cameraPosition.x, streakPos[ix + 1] - cameraPosition.y, streakPos[ix + 2] - cameraPosition.z);
          const along = rel.dot(climb);
          need = along < -6 || along > 190;
          if (!running) {
            // Standing on the launch cradle the rain simply falls.
            streakPos[ix + 1] -= 26 * dt;
            need = streakPos[ix + 1] < cameraPosition.y - 45 || along > 190;
          }
        }
        if (need) respawn(streakPos, i, cameraPosition, climb, running ? 18 : 4, running ? 180 : 130, running ? 10 : 4, running ? 64 : 80);
        if (need && !running) streakPos[ix + 1] = cameraPosition.y + 6 + Math.random() * 40;
        pos.set(streakPos[ix], streakPos[ix + 1], streakPos[ix + 2]);
        const jitter = 0.7 + streakSeed[i] * 0.6;
        scale.set(thick, thick, len * jitter);
        matrix.compose(pos, streakQuat, scale);
        streaks.setMatrixAt(i, matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;
      streaks.visible = streakActive > 0;

      // debris ---------------------------------------------------------------------
      const debrisAmt = MathUtils.smoothstep(time, 19, 36);
      const debrisActive = running ? Math.round(debrisCount * debrisAmt) : 0;
      debris.count = debrisActive;
      for (let i = 0; i < debrisActive; i += 1) {
        const ix = i * 3;
        let need = Number.isNaN(debrisPos[ix]);
        if (!need) {
          rel.set(debrisPos[ix] - cameraPosition.x, debrisPos[ix + 1] - cameraPosition.y, debrisPos[ix + 2] - cameraPosition.z);
          const along = rel.dot(climb);
          need = along < -10 || along > 240;
        }
        if (need) respawn(debrisPos, i, cameraPosition, climb, 40, 230, 9, 95);
        pos.set(debrisPos[ix], debrisPos[ix + 1], debrisPos[ix + 2]);
        spinQuat.setFromAxisAngle(debrisAxis[i], debrisSpin[i] * dt);
        debrisRot[i].premultiply(spinQuat).normalize();
        const size = debrisSize[i];
        scale.set(size, size, size);
        matrix.compose(pos, debrisRot[i], scale);
        debris.setMatrixAt(i, matrix);
      }
      debris.instanceMatrix.needsUpdate = true;
      debris.visible = debrisActive > 0;
    },
  };
}
