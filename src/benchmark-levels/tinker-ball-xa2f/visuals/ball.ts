import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';

export type RollingBallController = {
  mesh: Group;
  currentRadius: number;
  setTargetScale(radius: number): void;
  attachDebris(type: 'button' | 'pin' | 'spool' | 'eraser' | 'ruler'): void;
  update(dt: number, currentPosition: Vector3, previousPosition: Vector3): void;
};

const BUTTON_COLORS = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899];

export function createRollingBall(scene: Scene): RollingBallController {
  const ballGroup = new Group();
  scene.add(ballGroup);

  let currentRadius = 0.35;
  let targetRadius = 0.35;

  // Base Core Marble Sphere
  const coreMat = new MeshStandardMaterial({
    color: 0xe0f2fe,
    roughness: 0.15,
    metalness: 0.85,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.25,
  });
  const coreMesh = new Mesh(new SphereGeometry(1, 24, 18), coreMat);
  coreMesh.scale.setScalar(currentRadius);
  ballGroup.add(coreMesh);

  // Attached Debris Group (rotates with core)
  const attachedDebrisGroup = new Group();
  ballGroup.add(attachedDebrisGroup);

  let attachedCount = 0;

  return {
    mesh: ballGroup,
    get currentRadius() {
      return currentRadius;
    },
    setTargetScale(radius: number) {
      targetRadius = radius;
    },
    attachDebris(type) {
      if (attachedCount > 36) return; // Cap attached pieces for clean performance
      attachedCount++;

      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(2 * Math.random() - 1);
      const dir = new Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta),
      ).normalize();

      const attachPos = dir.clone().multiplyScalar(currentRadius * 0.95);
      let debrisMesh: Mesh;

      if (type === 'button') {
        const color = BUTTON_COLORS[attachedCount % BUTTON_COLORS.length];
        const mat = new MeshStandardMaterial({ color, roughness: 0.4 });
        debrisMesh = new Mesh(new CylinderGeometry(0.12, 0.12, 0.04, 12), mat);
      } else if (type === 'pin') {
        const mat = new MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.2 });
        debrisMesh = new Mesh(new CylinderGeometry(0.02, 0.02, 0.25, 6), mat);
      } else if (type === 'spool') {
        const mat = new MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.6 });
        debrisMesh = new Mesh(new CylinderGeometry(0.15, 0.15, 0.2, 10), mat);
      } else if (type === 'eraser') {
        const mat = new MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.7 });
        debrisMesh = new Mesh(new BoxGeometry(0.2, 0.1, 0.15), mat);
      } else {
        // Ruler piece
        const mat = new MeshStandardMaterial({ color: 0xeab308, roughness: 0.5 });
        debrisMesh = new Mesh(new BoxGeometry(0.35, 0.05, 0.12), mat);
      }

      debrisMesh.position.copy(attachPos);
      debrisMesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
      attachedDebrisGroup.add(debrisMesh);
    },
    update(dt, currentPosition, previousPosition) {
      // Smooth scale interpolation
      if (Math.abs(currentRadius - targetRadius) > 0.001) {
        currentRadius += (targetRadius - currentRadius) * Math.min(1, dt * 3);
        coreMesh.scale.setScalar(currentRadius);
      }

      ballGroup.position.copy(currentPosition);

      // Roll animation based on distance moved
      const dist = currentPosition.distanceTo(previousPosition);
      if (dist > 0.0001 && currentRadius > 0) {
        const rollAngle = dist / currentRadius;
        const moveDir = currentPosition.clone().sub(previousPosition).normalize();
        const rotationAxis = new Vector3(-moveDir.z, 0, moveDir.x).normalize();
        if (rotationAxis.lengthSq() > 0.5) {
          ballGroup.rotateOnWorldAxis(rotationAxis, rollAngle);
        }
      }
    },
  };
}
