import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mix, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BONE, GRAPHITE, MACHINE_GREY, MACHINE_WHITE, SOLVE_COLORS, VOID_HIGH, VOID_LOW, VOID_FOG, hdr } from './palette';

// The arena is a pale, softly lit nothing — a photographer's cyclorama with no
// horizon — so the cube is the only thing in it with a hard edge. Everything
// else is jig: three colossal square gantry rings that hold the cube in place,
// a haze of loose cubies drifting far out, and six tally lamps that light one
// by one as faces come off. The rings are what make the orbit legible; without
// something at a hundred units, circling a centered object looks like standing
// still.

export const beatUniform = uniform(0);
export const voidLevelUniform = uniform(1);

const MOTE_COUNT = 110;
const RING_RADII = [82, 104, 132];

export type Environment = {
  root: Group;
  update(dt: number, context: { elapsed: number; beatEnergy: number; running: boolean }): void;
  setFacesConquered(count: number): void;
  reset(): void;
  dispose(): void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const rng = mulberry32(0x0c0be5);
  const root = new Group();

  scene.fog = new FogExp2(VOID_FOG.getHex(), 0.0056);
  scene.background = null;

  // --- backdrop -----------------------------------------------------------------
  const backdropMaterial = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const height = positionLocal.y.div(420).mul(0.5).add(0.5);
  backdropMaterial.colorNode = mix(
    vec3(VOID_LOW.r, VOID_LOW.g, VOID_LOW.b),
    vec3(VOID_HIGH.r, VOID_HIGH.g, VOID_HIGH.b),
    smoothstep(0.12, 0.94, height),
  ).mul(voidLevelUniform);
  const backdrop = new Mesh(new SphereGeometry(420, 24, 16), backdropMaterial);
  backdrop.userData.raildIgnoreOcclusion = true;
  root.add(backdrop);

  // --- gantry rings ---------------------------------------------------------------
  const rings: Group[] = [];
  const ringMaterial = new MeshBasicMaterial({ color: GRAPHITE.clone().multiplyScalar(2.6) });
  for (let i = 0; i < RING_RADII.length; i += 1) {
    const ring = new Group();
    const radius = RING_RADII[i];
    // A square torus with four radial segments reads as a fabricated frame
    // rather than a hoop — the same square language as the cube.
    const band = new Mesh(new TorusGeometry(radius, 1.5 + i * 0.5, 4, 4), ringMaterial);
    band.rotation.z = Math.PI / 4;
    ring.add(band);

    const struts: BufferGeometry[] = [];
    for (let k = 0; k < 8; k += 1) {
      const angle = (k / 8) * Math.PI * 2 + i;
      struts.push(new BoxGeometry(1.1, 1.1, 22).applyMatrix4(new Matrix4().compose(
        new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
        new Quaternion(),
        new Vector3(1, 1, 1),
      )));
    }
    const merged = mergeGeometries(struts);
    if (merged) ring.add(new Mesh(merged, ringMaterial));
    for (const strut of struts) strut.dispose();

    ring.rotation.set(i === 1 ? Math.PI / 2 : 0.2 * i, i === 2 ? Math.PI / 2 : 0.35 * i, 0);
    ring.userData.spin = (i % 2 === 0 ? 1 : -1) * (0.026 + i * 0.011);
    rings.push(ring);
    root.add(ring);
  }

  // --- tally lamps ------------------------------------------------------------------
  // Six blocks on the inner ring, one per face. They light as faces come off,
  // so the arena itself keeps score.
  const lamps: MeshBasicMaterial[] = [];
  const tally = new Group();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.4;
    const material = createAdditiveBasicMaterial({ color: MACHINE_GREY.clone().multiplyScalar(0.35), opacity: 0.9 });
    const lamp = new Mesh(new BoxGeometry(6, 6, 1.4), material);
    lamp.position.set(Math.cos(angle) * (RING_RADII[0] - 6), Math.sin(angle) * (RING_RADII[0] - 6), 0);
    lamp.lookAt(0, 0, 0);
    lamp.userData.raildIgnoreOcclusion = true;
    lamps.push(material);
    tally.add(lamp);
  }
  tally.rotation.copy(rings[0].rotation);
  root.add(tally);

  // --- drifting cubies ---------------------------------------------------------------
  const moteMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: BONE.clone() }), MOTE_COUNT);
  moteMesh.userData.raildIgnoreOcclusion = true;
  moteMesh.frustumCulled = false;
  const motes: Array<{ position: Vector3; axis: Vector3; spin: number; size: number; rotation: Quaternion; color: Color }> = [];
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    const radius = 46 + rng() * 130;
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(rng() * 2 - 1);
    motes.push({
      position: new Vector3(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius * 0.7,
        Math.sin(phi) * Math.sin(theta) * radius,
      ),
      axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      spin: (rng() - 0.5) * 0.5,
      size: 1.4 + rng() * 4.4,
      rotation: new Quaternion(),
      color: rng() < 0.16 ? SOLVE_COLORS[Math.floor(rng() * 6)].clone().multiplyScalar(0.55) : MACHINE_WHITE.clone().multiplyScalar(0.5 + rng() * 0.4),
    });
  }
  root.add(moteMesh);

  scene.add(root);

  const scratchMatrix = new Matrix4();
  const scratchScale = new Vector3();
  let facesLit = 0;

  function writeMotes() {
    for (let i = 0; i < motes.length; i += 1) {
      const mote = motes[i];
      scratchScale.setScalar(mote.size);
      scratchMatrix.compose(mote.position, mote.rotation, scratchScale);
      moteMesh.setMatrixAt(i, scratchMatrix);
      moteMesh.setColorAt(i, mote.color);
    }
    moteMesh.instanceMatrix.needsUpdate = true;
    if (moteMesh.instanceColor) moteMesh.instanceColor.needsUpdate = true;
  }
  writeMotes();

  const spinQuat = new Quaternion();

  return {
    root,
    update(dt, { elapsed, beatEnergy, running }) {
      beatUniform.value = beatEnergy;
      // The void dims a touch as the machine loses faces: the light in the room
      // is coming from the cube, and the cube is being taken apart.
      const target = running ? 1 - facesLit * 0.055 : 1;
      voidLevelUniform.value += (target - voidLevelUniform.value) * Math.min(1, dt * 1.4);

      for (const ring of rings) {
        ring.rotation.z += dt * (ring.userData.spin as number);
        ring.scale.setScalar(1 + beatEnergy * 0.004);
      }
      tally.rotation.z += dt * (rings[0].userData.spin as number);

      for (let i = 0; i < motes.length; i += 1) {
        const mote = motes[i];
        mote.rotation.multiply(spinQuat.setFromAxisAngle(mote.axis, mote.spin * dt));
        scratchScale.setScalar(mote.size * (1 + beatEnergy * 0.05));
        scratchMatrix.compose(mote.position, mote.rotation, scratchScale);
        moteMesh.setMatrixAt(i, scratchMatrix);
      }
      moteMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < lamps.length; i += 1) {
        const lit = i < facesLit;
        const pulse = lit ? 1.1 + Math.sin(elapsed * 3 + i) * 0.18 + beatEnergy * 0.3 : 0.32;
        lamps[i].color.copy(lit ? hdr(SOLVE_COLORS[i], pulse) : MACHINE_GREY.clone().multiplyScalar(pulse));
      }
    },
    setFacesConquered(count) {
      facesLit = Math.max(0, Math.min(6, count));
    },
    reset() {
      facesLit = 0;
      voidLevelUniform.value = 1;
      writeMotes();
    },
    dispose() {
      root.removeFromParent();
      root.traverse((child) => {
        const mesh = child as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(material)) for (const item of material) item.dispose();
        else material?.dispose();
      });
      scene.fog = null;
    },
  };
}
