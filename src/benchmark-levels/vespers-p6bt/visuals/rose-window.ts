import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { ROSE_RADIUS, ROSE_Y, ROSE_Z } from '../nave';
import { BONE, GLASS, LEAD, STONE, hdr } from './palette';
import { mergeParts, softDiscGeometry } from './shapes';

// The dead rose at the west end. Twelve outer lights and eight inner ones, all
// of them holding a colour that was taken out of the nave and none of them
// burning. Petals come back one at a time as the fight is won; the killing
// blow on the heart opens every light at once, and that is the largest single
// event in the run.

const OUTER_LIGHTS = 12;
const INNER_LIGHTS = 8;

export type RoseWindow = {
  root: Group;
  /** World position of one of the twelve outer lights. */
  lightPosition(index: number): Vector3;
  /** A petal has been broken: its two outer lights come back. */
  litPetal(petal: number): void;
  /** The heart is dead. Everything opens. */
  ignite(): void;
  reset(): void;
  update(dt: number, elapsed: number): void;
};

export function createRoseWindow(): RoseWindow {
  const root = new Group();
  root.position.set(0, ROSE_Y, ROSE_Z + 1.6);

  const stoneMaterial = new MeshBasicMaterial({ color: STONE.clone().multiplyScalar(2.6), side: DoubleSide });
  const traceryMaterial = new MeshBasicMaterial({ color: LEAD.clone().multiplyScalar(0.5), side: DoubleSide });

  root.add(new Mesh(buildSurround(), stoneMaterial));
  root.add(new Mesh(buildTracery(), traceryMaterial));

  const outerGeometry = new RingGeometry(
    ROSE_RADIUS * 0.5,
    ROSE_RADIUS * 0.9,
    6,
    1,
    -Math.PI / OUTER_LIGHTS * 0.84,
    (Math.PI * 2 / OUTER_LIGHTS) * 0.84,
  );
  const innerGeometry = new RingGeometry(
    ROSE_RADIUS * 0.16,
    ROSE_RADIUS * 0.42,
    5,
    1,
    -Math.PI / INNER_LIGHTS * 0.8,
    (Math.PI * 2 / INNER_LIGHTS) * 0.8,
  );
  const glassMaterial = () => new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff, side: DoubleSide }));

  const outer = new InstancedMesh(outerGeometry, glassMaterial(), OUTER_LIGHTS);
  const inner = new InstancedMesh(innerGeometry, glassMaterial(), INNER_LIGHTS);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const origin = new Vector3();
  const unit = new Vector3(1, 1, 1);
  const axis = new Vector3(0, 0, 1);
  const outerColours: Color[] = [];
  const innerColours: Color[] = [];
  const outerLevel = new Float32Array(OUTER_LIGHTS);
  const innerLevel = new Float32Array(INNER_LIGHTS);
  const outerTarget = new Float32Array(OUTER_LIGHTS);
  const innerTarget = new Float32Array(INNER_LIGHTS);

  for (let i = 0; i < OUTER_LIGHTS; i += 1) {
    quaternion.setFromAxisAngle(axis, (i / OUTER_LIGHTS) * Math.PI * 2);
    outer.setMatrixAt(i, matrix.compose(origin, quaternion, unit));
    outerColours[i] = GLASS[i % GLASS.length].clone();
  }
  for (let i = 0; i < INNER_LIGHTS; i += 1) {
    quaternion.setFromAxisAngle(axis, ((i + 0.5) / INNER_LIGHTS) * Math.PI * 2);
    inner.setMatrixAt(i, matrix.compose(origin, quaternion, unit));
    innerColours[i] = GLASS[(i * 3 + 1) % GLASS.length].clone();
  }
  outer.instanceMatrix.needsUpdate = true;
  inner.instanceMatrix.needsUpdate = true;
  root.add(outer, inner);

  // The oculus the heart is nested in: a single dark eye until the end.
  const oculusMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: 0x000000, side: DoubleSide }));
  const oculus = new Mesh(new CircleGeometry(ROSE_RADIUS * 0.15, 24), oculusMaterial);
  oculus.position.z = 0.3;
  root.add(oculus);

  // A wash of colour thrown back down the nave when the rose is burning. It
  // fades to nothing at its rim and stays weak: a lit cathedral still has to
  // read as black stone with windows in it, not as a white screen.
  const spillMaterial = new MeshBasicMaterial(additiveMaterialParameters({
    color: 0x000000,
    side: DoubleSide,
    vertexColors: true,
  }));
  const spill = new Mesh(softDiscGeometry(ROSE_RADIUS * 1.7, 32), spillMaterial);
  spill.position.z = 1.4;
  root.add(spill);

  root.userData.raildIgnoreOcclusion = true;

  const scratch = new Color();
  let ignitionLevel = 0;
  let ignited = false;

  return {
    root,
    lightPosition(index) {
      const angle = ((index % OUTER_LIGHTS) / OUTER_LIGHTS) * Math.PI * 2;
      return new Vector3(
        Math.cos(angle) * ROSE_RADIUS * 0.7,
        ROSE_Y + Math.sin(angle) * ROSE_RADIUS * 0.7,
        ROSE_Z + 1.6,
      );
    },
    litPetal(petal) {
      for (const light of [petal * 2, petal * 2 + 1]) outerTarget[light % OUTER_LIGHTS] = 1;
    },
    ignite() {
      ignited = true;
      outerTarget.fill(1);
      innerTarget.fill(1);
    },
    reset() {
      ignited = false;
      ignitionLevel = 0;
      outerTarget.fill(0);
      innerTarget.fill(0);
      outerLevel.fill(0);
      innerLevel.fill(0);
    },
    update(dt, elapsed) {
      ignitionLevel += ((ignited ? 1 : 0) - ignitionLevel) * Math.min(1, dt * 2.4);
      // Dead, the rose still turns over in its sleep; lit, it beats.
      const breath = 0.03 + 0.014 * Math.sin(elapsed * 0.7);
      const beat = 1 + ignitionLevel * 0.12 * Math.sin(elapsed * 3.1);

      for (let i = 0; i < OUTER_LIGHTS; i += 1) {
        outerLevel[i] += (outerTarget[i] - outerLevel[i]) * Math.min(1, dt * 4.5);
        scratch.copy(outerColours[i]).multiplyScalar((breath + outerLevel[i] * 1.15) * beat);
        outer.setColorAt(i, scratch);
      }
      for (let i = 0; i < INNER_LIGHTS; i += 1) {
        innerLevel[i] += (innerTarget[i] - innerLevel[i]) * Math.min(1, dt * 3.4);
        scratch.copy(innerColours[i]).multiplyScalar((breath * 0.7 + innerLevel[i] * 1.5) * beat);
        inner.setColorAt(i, scratch);
      }
      if (outer.instanceColor) outer.instanceColor.needsUpdate = true;
      if (inner.instanceColor) inner.instanceColor.needsUpdate = true;

      oculusMaterial.color.copy(hdr(BONE, 0.012 + ignitionLevel * 1.9)).multiplyScalar(beat);
      spillMaterial.color.copy(hdr(GLASS[3], ignitionLevel * 0.11));
      root.rotation.z = elapsed * 0.014;
    },
  };
}

/** Blind arcading and the gable that frames the wheel: the west front. */
function buildSurround() {
  const parts: BufferGeometry[] = [
    new TorusGeometry(ROSE_RADIUS, 1.5, 6, 40),
    new TorusGeometry(ROSE_RADIUS * 1.24, 1.1, 6, 44),
  ];
  for (const sign of [1, -1]) {
    parts.push(new PlaneGeometry(9, 44).translate(sign * 40, -22, -0.4));
    parts.push(new TorusGeometry(5.4, 0.9, 5, 20, Math.PI).translate(sign * 40, 0, -0.4));
  }
  // A string course under the wheel, running the width of the front.
  parts.push(new PlaneGeometry(104, 2.4).translate(0, -ROSE_RADIUS * 1.44, -0.6));
  return mergeParts(parts);
}

/** The stone bars the lights are cut between. */
function buildTracery() {
  const parts: BufferGeometry[] = [
    new TorusGeometry(ROSE_RADIUS * 0.9, 0.5, 5, 36),
    new TorusGeometry(ROSE_RADIUS * 0.48, 0.45, 5, 30),
    new TorusGeometry(ROSE_RADIUS * 0.16, 0.4, 5, 20),
  ];
  for (let i = 0; i < OUTER_LIGHTS; i += 1) {
    const angle = ((i + 0.5) / OUTER_LIGHTS) * Math.PI * 2;
    parts.push(
      new PlaneGeometry(ROSE_RADIUS * 0.42, 0.7)
        .translate(ROSE_RADIUS * 0.7, 0, 0)
        .rotateZ(angle),
    );
  }
  for (let i = 0; i < INNER_LIGHTS; i += 1) {
    const angle = (i / INNER_LIGHTS) * Math.PI * 2;
    parts.push(
      new PlaneGeometry(ROSE_RADIUS * 0.28, 0.55)
        .translate(ROSE_RADIUS * 0.29, 0, 0)
        .rotateZ(angle),
    );
  }
  return mergeParts(parts);
}
