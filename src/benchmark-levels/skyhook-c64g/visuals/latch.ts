import {
  AdditiveBlending,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { BOSS_START_DISTANCE } from '../boss';
import { sampleRailFrame } from '../../../engine/rail';
import { CLIMB_LENGTH, skyhookRunProgress, tetherPointAhead } from '../space';
import { LATCH_TIME } from '../timing';
import { HAZARD_HOT, SIGNAL_WHITE, hdr } from './palette';
import { spawnRing } from './effects';

// The Ripper does not fade in: it falls out of the sky as a comet, strikes the
// cable a few hundred metres up, and the strike runs down the tether toward the
// car as a ripple of rings. Everything here is a function of the run clock.

const COMET_SECONDS = 1.05;
const UP_Z = new Vector3(0, 0, 1);

export type LatchShow = {
  group: Group;
  /** World position where the Ripper grips the cable. */
  strikePoint: Vector3;
  update(time: number, running: boolean): void;
  reset(): void;
};

export function createLatchShow(scene: Scene, curve: CatmullRomCurve3): LatchShow {
  const group = new Group();
  const strikePoint = tetherPointAhead(curve, LATCH_TIME, BOSS_START_DISTANCE);
  // The comet sweeps in across the frame from the upper left, out of the black above the cable.
  const frame = sampleRailFrame(curve, MathUtils.clamp(skyhookRunProgress(LATCH_TIME) + BOSS_START_DISTANCE / CLIMB_LENGTH, 0, 1));
  const start = strikePoint.clone().addScaledVector(frame.right, -470).addScaledVector(frame.up, 330).addScaledVector(frame.tangent, 330);
  const direction = strikePoint.clone().sub(start).normalize();
  const tailQuat = new Quaternion().setFromUnitVectors(UP_Z, direction);

  const tailMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_HOT, 2.6), blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const headMaterial = new MeshBasicMaterial({ color: hdr(SIGNAL_WHITE, 3.2), blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const tail = new Mesh(new BoxGeometry(3.6, 3.6, 1), tailMaterial);
  const head = new Mesh(new SphereGeometry(8, 14, 10), headMaterial);
  const comet = new Group();
  comet.add(tail, head);
  comet.visible = false;
  comet.traverse((o) => {
    o.userData.raildIgnoreOcclusion = true;
    o.frustumCulled = false;
  });
  group.add(comet);
  scene.add(group);

  let nextRipple = 0;

  return {
    group,
    strikePoint,
    reset() {
      comet.visible = false;
      nextRipple = 0;
    },
    update(time, running) {
      const t = time - (LATCH_TIME - COMET_SECONDS);
      if (!running || t < 0 || t > COMET_SECONDS) {
        comet.visible = false;
      } else {
        const k = MathUtils.clamp(t / COMET_SECONDS, 0, 1);
        const eased = k * k * (3 - 2 * k) * 0.35 + k * k * 0.65;
        comet.position.lerpVectors(start, strikePoint, eased);
        comet.quaternion.copy(tailQuat);
        const length = 120 + 380 * k;
        tail.scale.set(1 + k * 0.5, 1 + k * 0.5, length);
        tail.position.z = -length / 2;
        comet.visible = true;
      }
      // The strike runs down the cable as a ripple of rings.
      const since = time - LATCH_TIME;
      if (running && since >= 0 && since < 1.5 && time >= nextRipple) {
        nextRipple = time + 0.07;
        const distance = BOSS_START_DISTANCE - since * 260;
        if (distance > 110) spawnRing(tetherPointAhead(curve, time, distance), hdr(HAZARD_HOT, 1.4), 12 + (BOSS_START_DISTANCE - distance) * 0.02, 0.5);
      }
    },
  };
}
