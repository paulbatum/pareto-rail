import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BRASS_METAL,
  BUTTON_CYAN,
  BUTTON_LIME,
  BUTTON_MAGENTA,
  BUTTON_ORANGE,
  BUTTON_PURPLE,
  BUTTON_YELLOW,
  CARDBOARD_KRAFT,
  CLEAN_SPARKLE,
  ERASER_PINK,
  hdr,
  LAMP_WARM,
  mulberry32,
  PENCIL_WOOD,
  PENCIL_YELLOW,
  SPOOL_WOOD,
  STEEL_METAL,
  type Rng,
} from './palette';

export type DebrisKind =
  | 'button'
  | 'pin'
  | 'clip'
  | 'pencil'
  | 'eraser'
  | 'spool'
  | 'ruler'
  | 'cardboard'
  | 'block';

export type LooseDebris = {
  mesh: Object3D;
  position: Vector3;
  velocity: Vector3;
  kind: DebrisKind;
  age: number;
  collected: boolean;
};

export type TinkerBall = {
  root: Group;
  ballSphere: Mesh;
  debrisContainer: Group;
  looseContainer: Group;
  currentRadius: number;
  attachedCount: number;
  addDebrisScatter(position: Vector3, count: number, act: number): void;
  update(dt: number, speed: number, runProgress: number, cameraPosition: Vector3, cameraQuaternion: Quaternion): void;
  dispose(): void;
};

const BUTTON_COLORS = [BUTTON_CYAN, BUTTON_MAGENTA, BUTTON_YELLOW, BUTTON_LIME, BUTTON_ORANGE, BUTTON_PURPLE];

export function createTinkerBall(scene: Scene): TinkerBall {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  const rng = mulberry32(4242);

  // Ball core sphere
  const baseRadius = 0.38;
  const sphereGeom = new SphereGeometry(baseRadius, 18, 18);
  const sphereMat = createAdditiveBasicMaterial({
    color: hdr(LAMP_WARM, 1.4),
  });
  const ballSphere = new Mesh(sphereGeom, sphereMat);

  // Inner core glow
  const innerGeom = new SphereGeometry(baseRadius * 0.7, 12, 12);
  const innerMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_YELLOW, 2.0) });
  const innerMesh = new Mesh(innerGeom, innerMat);
  ballSphere.add(innerMesh);

  // Container that rotates as the ball rolls
  const rollingGroup = new Group();
  rollingGroup.add(ballSphere);

  // Container for items stuck to the ball
  const debrisContainer = new Group();
  rollingGroup.add(debrisContainer);
  root.add(rollingGroup);

  // Loose debris scattered on the table awaiting collection
  const looseContainer = new Group();
  looseContainer.userData.raildIgnoreOcclusion = true;
  scene.add(looseContainer);
  scene.add(root);

  const looseItems: LooseDebris[] = [];

  // Geometries for debris items
  const geoms = {
    button: new CylinderGeometry(0.24, 0.24, 0.08, 10),
    pin: new CylinderGeometry(0.04, 0.04, 0.7, 6),
    clip: new TorusGeometry(0.22, 0.04, 6, 12, Math.PI * 1.5),
    pencil: new CylinderGeometry(0.09, 0.09, 1.2, 6),
    eraser: new BoxGeometry(0.35, 0.2, 0.45),
    spool: new CylinderGeometry(0.35, 0.35, 0.6, 10),
    ruler: new BoxGeometry(0.3, 0.06, 1.8),
    cardboard: new BoxGeometry(0.6, 0.06, 0.6),
    block: new BoxGeometry(0.4, 0.4, 0.4),
  };

  function createDebrisMesh(kind: DebrisKind, debrisRng: Rng): Object3D {
    let mesh: Mesh;
    const color = BUTTON_COLORS[Math.floor(debrisRng() * BUTTON_COLORS.length)];
    switch (kind) {
      case 'button':
        mesh = new Mesh(geoms.button, new MeshBasicMaterial({ color }));
        break;
      case 'pin':
        mesh = new Mesh(geoms.pin, new MeshBasicMaterial({ color: debrisRng() > 0.5 ? BRASS_METAL : STEEL_METAL }));
        break;
      case 'clip':
        mesh = new Mesh(geoms.clip, new MeshBasicMaterial({ color: STEEL_METAL }));
        break;
      case 'pencil':
        mesh = new Mesh(geoms.pencil, new MeshBasicMaterial({ color: PENCIL_YELLOW }));
        break;
      case 'eraser':
        mesh = new Mesh(geoms.eraser, new MeshBasicMaterial({ color: ERASER_PINK }));
        break;
      case 'spool':
        mesh = new Mesh(geoms.spool, new MeshBasicMaterial({ color: SPOOL_WOOD }));
        break;
      case 'ruler':
        mesh = new Mesh(geoms.ruler, new MeshBasicMaterial({ color: PENCIL_WOOD }));
        break;
      case 'cardboard':
        mesh = new Mesh(geoms.cardboard, new MeshBasicMaterial({ color: CARDBOARD_KRAFT }));
        break;
      case 'block':
      default:
        mesh = new Mesh(geoms.block, new MeshBasicMaterial({ color: color }));
        break;
    }
    return mesh;
  }

  let currentRadius = baseRadius;
  let attachedCount = 0;
  let rollRotationX = 0;

  function attachToBall(kind: DebrisKind, debrisRng: Rng) {
    const mesh = createDebrisMesh(kind, debrisRng);
    // Random point on sphere surface
    const phi = debrisRng() * Math.PI * 2;
    const theta = Math.acos(2 * debrisRng() - 1);
    const rad = currentRadius * 0.95;
    const x = rad * Math.sin(theta) * Math.cos(phi);
    const y = rad * Math.sin(theta) * Math.sin(phi);
    const z = rad * Math.cos(theta);

    mesh.position.set(x, y, z);
    const normal = new Vector3(x, y, z).normalize();
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
    debrisContainer.add(mesh);
    attachedCount += 1;
  }

  return {
    root,
    ballSphere,
    debrisContainer,
    looseContainer,
    get currentRadius() {
      return currentRadius;
    },
    get attachedCount() {
      return attachedCount;
    },
    addDebrisScatter(position: Vector3, count: number, act: number) {
      const kinds: DebrisKind[] = act === 0
        ? ['button', 'pin', 'clip']
        : act === 1
        ? ['button', 'clip', 'pencil', 'eraser', 'spool', 'block']
        : ['pencil', 'spool', 'ruler', 'cardboard', 'block'];

      for (let i = 0; i < count; i += 1) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const mesh = createDebrisMesh(kind, rng);
        const p = position.clone().add(new Vector3(
          (rng() - 0.5) * 3.5,
          (rng() - 0.5) * 2.0,
          (rng() - 0.5) * 3.5,
        ));
        mesh.position.copy(p);
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        looseContainer.add(mesh);

        const vel = new Vector3((rng() - 0.5) * 6, rng() * 4 + 1.5, (rng() - 0.5) * 6);
        looseItems.push({
          mesh,
          position: p,
          velocity: vel,
          kind,
          age: 0,
          collected: false,
        });
      }
    },
    update(dt: number, speed: number, runProgress: number, cameraPosition: Vector3, cameraQuaternion: Quaternion) {
      // 1. Scale progression across the run
      const targetRadius = runProgress < 0.33
        ? MathUtils.lerp(0.38, 0.65, runProgress / 0.33)
        : runProgress < 0.66
        ? MathUtils.lerp(0.65, 1.25, (runProgress - 0.33) / 0.33)
        : MathUtils.lerp(1.25, 2.2, (runProgress - 0.66) / 0.34);

      currentRadius = MathUtils.lerp(currentRadius, targetRadius, Math.min(1, dt * 2.5));
      ballSphere.scale.setScalar(currentRadius / baseRadius);

      // 2. Position the ball neatly in front of the camera
      const forwardDist = MathUtils.lerp(4.2, 7.8, (currentRadius - 0.38) / 1.8);
      const downOffset = MathUtils.lerp(-1.1, -1.6, (currentRadius - 0.38) / 1.8);
      const localOffset = new Vector3(0, downOffset, -forwardDist);
      const worldBallPos = localOffset.clone().applyQuaternion(cameraQuaternion).add(cameraPosition);

      root.position.copy(worldBallPos);

      // 3. Roll rotation physics based on speed and radius
      const forwardDelta = Math.max(0.1, speed) * dt;
      rollRotationX += forwardDelta / currentRadius;
      rollingGroup.rotation.x = rollRotationX;
      rollingGroup.rotation.y = runProgress * Math.PI * 4;

      // 4. Update loose debris and magnetic collection
      for (let i = looseItems.length - 1; i >= 0; i -= 1) {
        const item = looseItems[i];
        item.age += dt;

        if (!item.collected) {
          item.velocity.y -= 9.8 * dt;
          item.position.addScaledVector(item.velocity, dt);
          item.mesh.position.copy(item.position);

          const distToBall = item.position.distanceTo(worldBallPos);
          if (distToBall < currentRadius * 3.2 || item.age > 0.8) {
            const toBall = worldBallPos.clone().sub(item.position);
            item.velocity.addScaledVector(toBall.normalize(), 28 * dt);

            if (distToBall < currentRadius * 1.2 || item.age > 1.8) {
              item.collected = true;
              looseContainer.remove(item.mesh);
              attachToBall(item.kind, rng);
              looseItems.splice(i, 1);
            }
          }
        }
      }
    },
    dispose() {
      scene.remove(root);
      scene.remove(looseContainer);
      for (const g of Object.values(geoms)) g.dispose();
    },
  };
}
