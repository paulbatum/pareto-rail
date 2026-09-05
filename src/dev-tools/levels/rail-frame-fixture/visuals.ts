// Dev-only fixture visuals: rings around the rail make roll and the transported
// frame visible, a floor grid gives a world horizon, and a beacon marks the
// look target.
import {
  BoxGeometry,
  DoubleSide,
  Fog,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { BEACON_POSITION } from './gameplay';

const ringGeometry = new TorusGeometry(9, 0.18, 6, 48);
const ringMaterial = new MeshBasicMaterial({ color: 0x38d8ff });
const postGeometry = new BoxGeometry(0.5, 4, 0.5);
const postMaterial = new MeshBasicMaterial({ color: 0xffa040 });

export function createEnvironment(scene: Scene, curve: CatmullRomCurve3) {
  scene.fog = new Fog(0x03060c, 60, 260);
  const root = new Group();
  const grid = new GridHelper(2400, 120, 0x1c3a4a, 0x0e1f2a);
  grid.position.set(0, -30, -600);
  root.add(grid);

  const beacon = new Mesh(new SphereGeometry(4, 16, 12), new MeshBasicMaterial({ color: 0xff4fd8 }));
  beacon.position.copy(BEACON_POSITION);
  root.add(beacon);

  const rings = scatterAlongRail(curve, {
    count: 48,
    seed: 7,
    window: { behind: 20, ahead: 240 },
    place: (index) => ({ u: index / 48, offset: new Vector3(0, 0, 0) }),
    make: () => {
      const ring = new Group();
      ring.add(new Mesh(ringGeometry, ringMaterial));
      // A post on the ring's local up shows which way the frame's up points.
      const post = new Mesh(postGeometry, postMaterial);
      post.position.set(0, 9, 0);
      ring.add(post);
      return ring;
    },
  });
  root.add(rings.group);
  scene.add(root);
  return { root, rings };
}

export function disposeEnvironment(scene: Scene, environment: { root: Group; rings: ScatterField }) {
  environment.rings.dispose();
  scene.remove(environment.root);
}

const orbGeometry = new OctahedronGeometry(1.1, 0);
const bladeGeometry = new BoxGeometry(2.6, 0.5, 0.5);
const orbMaterial = new MeshBasicMaterial({ color: 0x9cff5a });
const bladeMaterial = new MeshBasicMaterial({ color: 0xff6a3d });
const lockedMaterial = new MeshBasicMaterial({ color: 0xffffff });

export function createEnemyMesh(kind: string) {
  const mesh = new Mesh(kind === 'blade' ? bladeGeometry : orbGeometry, kind === 'blade' ? bladeMaterial : orbMaterial);
  mesh.userData.baseMaterial = mesh.material;
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (!(mesh instanceof Mesh)) return;
  mesh.material = locked ? lockedMaterial : mesh.userData.baseMaterial;
}

export function setEnemyDenied() {}

export function createProjectileMesh() {
  return new Mesh(new SphereGeometry(0.3, 8, 6), new MeshBasicMaterial({ color: 0xffe066 }));
}

export function createReticle() {
  const group = new Group();
  group.add(new Mesh(new RingGeometry(0.5, 0.56, 32), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, depthTest: false })));
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.scale.setScalar(1 + lockCount * 0.08 + (active ? 0.1 : 0));
}
