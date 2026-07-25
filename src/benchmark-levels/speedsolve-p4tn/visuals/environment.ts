import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';
import { HOT_WHITE, MACHINE_DARK, MACHINE_GREY, MACHINE_WHITE, VOID_CORE, VOID_FAR, VOID_NEAR } from './palette';

// Leaf file: the pale hall the cube hangs in. Nothing here is a candy colour and
// nothing here is a target. The grids and the gantry hoops carry all the motion:
// the rail corkscrews, the camera rolls sixty degrees per face swing, and the
// whole hall wheels around the cube because of it.

const GRID_SPACING = 26;
const GRID_HALF = 22;
const FLOOR_Y = -40;
const CEILING_Y = 66;
const MOTE_COUNT = 150;
const MOTE_BOX = 46;
const PYLON_COUNT = 11;
/** Towers stand outside this cylinder; the rail helix has radius 38. */
const PYLON_MIN_RADIUS = 255;
/** Pale enough that a distant tower reads as scaffolding, not as a girder in the way. */
const PYLON_TONE = new Color(0.50, 0.53, 0.61);

export type Environment = {
  root: Group;
  update(context: { camera: Camera; dt: number; elapsed: number; cubeCenter: Vector3 }): void;
  setCharge(charge: number): void;
  dispose(): void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = VOID_NEAR.clone();
  scene.fog = new Fog(VOID_FAR.clone(), 55, 330);
  const root = new Group();
  const rng = mulberry32(20260724);

  // Soft, high-key lighting: the machinery needs real form, and a pale hall means
  // shading rather than glow does the work.
  // Budgeted so a lit white face lands just under 1.0 linear: the pale void sits
  // around 0.42, so machinery still separates from it without clipping, and the
  // whole range above 1 stays reserved for the elements meant to bloom.
  root.add(new AmbientLight(0xdfe6f2, 0.24));
  root.add(new HemisphereLight(0xf2f5ff, 0x8b93a4, 0.34));
  const key = new DirectionalLight(0xffffff, 0.42);
  key.position.set(-0.45, 1, 0.6);
  root.add(key);
  const rim = new DirectionalLight(0xbcd0ff, 0.13);
  rim.position.set(0.7, -0.35, -0.5);
  root.add(rim);

  const floor = makeGrid(MACHINE_DARK, 0.85);
  floor.position.y = FLOOR_Y;
  const ceiling = makeGrid(MACHINE_DARK, 0.38);
  ceiling.position.y = CEILING_Y;
  root.add(floor, ceiling);

  // Two colossal gantry hoops that hold the cube. They are line geometry on
  // purpose: they cross in front of orbiting targets constantly and must never
  // count as cover.
  const rig = new Group();
  rig.add(makeHoop(31, 96, MACHINE_DARK, 1));
  rig.add(makeHoop(38, 120, MACHINE_GREY, 0.75));
  rig.add(makeSpokes(20, 40, MACHINE_DARK));
  const rigGlow = new LineSegments(
    hoopGeometry(31.6, 96),
    new LineBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(0.92), transparent: true, opacity: 0.55 }),
  );
  rig.add(rigGlow);
  root.add(rig);

  // Drifting cubie flecks: the level's speed cue. One instanced mesh, wrapped in
  // camera space, exempt from occlusion because they are dust, not cover.
  const moteMesh = new InstancedMesh(
    new BoxGeometry(0.44, 0.44, 0.44),
    new MeshLambertMaterial({ color: MACHINE_WHITE, emissive: MACHINE_GREY.clone().multiplyScalar(0.14), flatShading: true }),
    MOTE_COUNT,
  );
  moteMesh.name = 'motes';
  moteMesh.frustumCulled = false;
  moteMesh.userData.raildIgnoreOcclusion = true;
  const motes = Array.from({ length: MOTE_COUNT }, () => ({
    offset: new Vector3(
      (rng() - 0.5) * MOTE_BOX * 2,
      (rng() - 0.5) * MOTE_BOX * 2,
      rng() * MOTE_BOX * 2.2,
    ),
    axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
    spin: 0.5 + rng() * 2.4,
    scale: 0.4 + rng() * 1.5,
  }));
  root.add(moteMesh);

  // Far scaffold towers: the parallax that proves the camera is really moving.
  // They are placed in world space on a cylinder well outside the rail helix, so
  // no tower is ever closer to the camera than the arena the player shoots in —
  // a tower can never come between the reticle and a target.
  const pylonMaterial = new MeshLambertMaterial({
    color: PYLON_TONE,
    emissive: MACHINE_DARK.clone().multiplyScalar(0.12),
    flatShading: true,
  });
  const pylonParts: BufferGeometry[] = [];
  for (let index = 0; index < PYLON_COUNT; index += 1) {
    const angle = (index / PYLON_COUNT) * Math.PI * 2 + rng() * 0.9;
    const radius = PYLON_MIN_RADIUS + rng() * 150;
    const height = 100 + rng() * 130;
    const width = 6 + rng() * 7;
    const base = new Vector3(
      Math.cos(angle) * radius,
      -40 + rng() * 50,
      -40 - (index / PYLON_COUNT) * 520 - rng() * 60,
    );
    pylonParts.push(new BoxGeometry(width, height, width)
      .translate(base.x, base.y, base.z));
    for (let band = 0; band < 4; band += 1) {
      pylonParts.push(new BoxGeometry(width * 1.55, 2.6, width * 1.55)
        .translate(base.x, base.y - height / 2 + (band + 0.6) * (height / 4.4), base.z));
    }
  }
  const pylons = new Mesh(mergeGeometries(pylonParts), pylonMaterial);
  pylons.name = 'pylon';
  pylons.frustumCulled = false;
  for (const part of pylonParts) part.dispose();
  root.add(pylons);

  scene.add(root);

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scaleVector = new Vector3();
  const scratch = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  let charge = 0;

  return {
    root,

    setCharge(value: number) {
      charge = value;
    },

    update({ camera, dt, elapsed, cubeCenter }) {
      // Snap the grids to the lattice so a finite mesh reads as an infinite floor.
      camera.getWorldPosition(scratch);
      for (const grid of [floor, ceiling]) {
        grid.position.x = Math.round(scratch.x / GRID_SPACING) * GRID_SPACING;
        grid.position.z = Math.round(scratch.z / GRID_SPACING) * GRID_SPACING;
      }

      // The hall darkens and cools as the solve closes in on the core.
      const tone = VOID_NEAR.clone().lerp(VOID_CORE, charge);
      if (scene.background instanceof Color) scene.background.copy(tone);
      if (scene.fog) scene.fog.color.copy(VOID_FAR).lerp(VOID_CORE, charge);

      // The hoops keep a world-space orientation, so the camera roll swings them
      // bodily around the cube — this is what sells the orbit.
      rig.position.copy(cubeCenter);
      rig.rotation.set(elapsed * 0.11, elapsed * 0.07, 0.32 + Math.sin(elapsed * 0.19) * 0.1);
      rigGlow.rotation.z = -elapsed * 0.5;

      camera.getWorldDirection(forward);
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      for (let index = 0; index < motes.length; index += 1) {
        const mote = motes[index];
        mote.offset.z -= dt * 16;
        if (mote.offset.z < -MOTE_BOX * 0.3) mote.offset.z += MOTE_BOX * 2.2;
        scratch.copy(camera.position)
          .addScaledVector(right, mote.offset.x)
          .addScaledVector(up, mote.offset.y)
          .addScaledVector(forward, mote.offset.z);
        quaternion.setFromAxisAngle(mote.axis, elapsed * mote.spin);
        scaleVector.setScalar(mote.scale);
        matrix.compose(scratch, quaternion, scaleVector);
        moteMesh.setMatrixAt(index, matrix);
      }
      moteMesh.instanceMatrix.needsUpdate = true;

    },

    dispose() {
      pylons.geometry.dispose();
      moteMesh.geometry.dispose();
      (moteMesh.material as MeshLambertMaterial).dispose();
      pylonMaterial.dispose();
      root.removeFromParent();
      scene.fog = null;
    },
  };
}

function hoopGeometry(radius: number, segments: number) {
  const positions: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const b = ((index + 1) / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0, Math.cos(b) * radius, Math.sin(b) * radius, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function makeHoop(radius: number, segments: number, color: Color, opacity: number) {
  const lines = new LineSegments(hoopGeometry(radius, segments), new LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  }));
  lines.frustumCulled = false;
  return lines;
}

function makeSpokes(inner: number, outer: number, color: Color) {
  const positions: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const a = (index / 12) * Math.PI * 2;
    positions.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a) * outer, Math.sin(a) * outer, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
  lines.frustumCulled = false;
  return lines;
}

function makeGrid(color: Color, opacity: number) {
  const positions: number[] = [];
  const extent = GRID_HALF * GRID_SPACING;
  for (let index = -GRID_HALF; index <= GRID_HALF; index += 1) {
    const offset = index * GRID_SPACING;
    positions.push(-extent, 0, offset, extent, 0, offset);
    positions.push(offset, 0, -extent, offset, 0, extent);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity }));
  lines.frustumCulled = false;
  return lines;
}
