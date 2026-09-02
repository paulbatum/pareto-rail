import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../engine/rng';
import { MACHINE_DARK, MACHINE_GREY, MACHINE_WHITE, VOID_BOTTOM, VOID_FOG, VOID_TOP } from './palette';

// Leaf: the arena. A pale, softly lit void with a white gantry ring the rail
// orbits inside, thin machinery arcs above and below, and slow white motes for
// orbital parallax. Nothing here wears a solve colour.

export type Environment = {
  root: Group;
  update(dt: number, elapsed: number, cameraPosition: Vector3): void;
};

const MOTE_COUNT = 170;
const MOTE_RADIUS = 70;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);
  scene.background = VOID_FOG.clone();
  scene.fog = new Fog(VOID_FOG.clone(), 55, 170);

  // Soft lighting: a bright pale sky, a cooler floor, and one key light so the
  // cubie bodies and machinery read as forms.
  const hemi = new HemisphereLight(VOID_TOP.clone(), VOID_BOTTOM.clone().multiplyScalar(0.7), 0.9);
  root.add(hemi);
  const key = new DirectionalLight(0xffffff, 0.75);
  key.position.set(28, 44, 30);
  root.add(key);
  const fill = new DirectionalLight(new Color(0.82, 0.86, 0.95), 0.4);
  fill.position.set(-30, -18, -24);
  root.add(fill);

  // Gradient sky dome: brighter overhead, cooler underfoot.
  const dome = new SphereGeometry(300, 24, 16);
  const domeColors = new Float32Array(dome.attributes.position.count * 3);
  const position = dome.attributes.position as BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) / 300 + 1) / 2;
    const color = VOID_BOTTOM.clone().lerp(VOID_TOP, Math.pow(t, 0.8));
    domeColors[i * 3] = color.r;
    domeColors[i * 3 + 1] = color.g;
    domeColors[i * 3 + 2] = color.b;
  }
  dome.setAttribute('color', new Float32BufferAttribute(domeColors, 3));
  const domeMesh = new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  domeMesh.userData.raildIgnoreOcclusion = true;
  domeMesh.name = 'void-dome';
  root.add(domeMesh);

  // The arena gantry: a white ring the rail orbits inside, with a second,
  // tilted ring and thin machinery arcs so the orbit has parallax.
  const gantry = new Group();
  const ringMaterial = new MeshStandardMaterial({ color: MACHINE_GREY.clone().lerp(MACHINE_WHITE, 0.45), roughness: 0.55, metalness: 0.15 });
  const mainRing = new Mesh(new TorusGeometry(58, 0.9, 10, 96), ringMaterial);
  mainRing.rotation.x = Math.PI / 2;
  gantry.add(mainRing);
  const tiltedRing = new Mesh(new TorusGeometry(72, 0.45, 8, 96), new MeshStandardMaterial({ color: MACHINE_GREY.clone(), roughness: 0.6 }));
  tiltedRing.rotation.x = Math.PI / 2 + 0.42;
  tiltedRing.rotation.z = 0.3;
  gantry.add(tiltedRing);
  const capRing = new Mesh(new TorusGeometry(26, 0.35, 8, 64), new MeshStandardMaterial({ color: MACHINE_GREY.clone(), roughness: 0.6 }));
  capRing.rotation.x = Math.PI / 2;
  capRing.position.y = 52;
  gantry.add(capRing);
  const floorRing = capRing.clone();
  floorRing.position.y = -52;
  gantry.add(floorRing);
  // Struts from the main ring to the polar rings.
  const strutGeometry = new BufferGeometry();
  const strutPoints: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    strutPoints.push(x * 58, 0, z * 58, x * 26, 52, z * 26);
    strutPoints.push(x * 58, 0, z * 58, x * 26, -52, z * 26);
  }
  strutGeometry.setAttribute('position', new Float32BufferAttribute(strutPoints, 3));
  gantry.add(new LineSegments(strutGeometry, new LineBasicMaterial({ color: MACHINE_DARK.clone().lerp(MACHINE_GREY, 0.4) })));
  // Tick marks around the main ring: the arena is a timer dial.
  const tickGeometry = new BufferGeometry();
  const tickPoints: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const angle = (i / 60) * Math.PI * 2;
    const inner = i % 5 === 0 ? 54.5 : 56.2;
    tickPoints.push(Math.cos(angle) * inner, 0.2, Math.sin(angle) * inner, Math.cos(angle) * 57, 0.2, Math.sin(angle) * 57);
  }
  tickGeometry.setAttribute('position', new Float32BufferAttribute(tickPoints, 3));
  gantry.add(new LineSegments(tickGeometry, new LineBasicMaterial({ color: MACHINE_DARK.clone() })));
  gantry.userData.raildIgnoreOcclusion = true;
  root.add(gantry);

  // Motes: soft white specks drifting through the void.
  const rng = mulberry32(0x4d0735);
  const motes = new InstancedMesh(
    new PlaneGeometry(0.5, 0.5),
    new MeshBasicMaterial({ color: MACHINE_WHITE.clone(), transparent: true, opacity: 0.4, depthWrite: false }),
    MOTE_COUNT,
  );
  motes.frustumCulled = false;
  motes.userData.raildIgnoreOcclusion = true;
  const moteSeeds: Array<{ base: Vector3; phase: number; speed: number; size: number }> = [];
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const radius = 22 + rng() * MOTE_RADIUS;
    moteSeeds.push({ base: direction.multiplyScalar(radius), phase: rng() * Math.PI * 2, speed: 0.2 + rng() * 0.5, size: 0.22 + rng() * 0.55 });
  }
  root.add(motes);

  return {
    root,
    update(_dt, elapsed, cameraPosition) {
      for (let i = 0; i < MOTE_COUNT; i += 1) {
        const seed = moteSeeds[i];
        const x = seed.base.x + Math.sin(elapsed * seed.speed + seed.phase) * 2.2;
        const y = seed.base.y + Math.cos(elapsed * seed.speed * 0.7 + seed.phase) * 1.8;
        const z = seed.base.z + Math.sin(elapsed * seed.speed * 0.5 + seed.phase * 2) * 2.2;
        const distance = Math.hypot(x - cameraPosition.x, y - cameraPosition.y, z - cameraPosition.z);
        scratchScale.setScalar(seed.size * (0.6 + Math.min(1.6, distance / 45)));
        // Billboard toward the camera.
        scratchQuaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(cameraPosition.x - x, cameraPosition.y - y, cameraPosition.z - z).normalize());
        scratchMatrix.compose(new Vector3(x, y, z), scratchQuaternion, scratchScale);
        motes.setMatrixAt(i, scratchMatrix);
      }
      motes.instanceMatrix.needsUpdate = true;
      gantry.rotation.y = elapsed * 0.006;
    },
  };
}
