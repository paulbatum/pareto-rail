import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { CAUSTIC_AQUA, DEEP_BLUE, hdr, PLANKTON_CYAN, SHALLOW_CYAN } from './palette';

const PLANKTON_COUNT = 320;
const GODRAY_COUNT = 14;

export type Environment = {
  group: Group;
  update(elapsed: number, dt: number, cameraPosition: Vector3): void;
  dispose(): void;
};

// Procedural underwater oceanic environment:
// - Sunlit caustic light shafts beaming down through the surface
// - Marine snow (bioluminescent plankton motes) drifting in ocean currents
// - Deep oceanic blue-green fog ramp
export function createEnvironment(scene: Scene): Environment {
  const group = new Group();

  // Background and oceanic fog
  scene.background = DEEP_BLUE.clone();
  scene.fog = new Fog(DEEP_BLUE.getHex(), 40, 340);

  // 1. Sunlit God-Rays / Caustic Shafts
  // Angled translucent cylinders piercing down from above
  const godrayGroup = new Group();
  const godrayGeo = new CylinderGeometry(4.0, 14.0, 260, 8, 1, true);
  const godrayMat = createAdditiveBasicMaterial({
    color: CAUSTIC_AQUA.clone().multiplyScalar(0.18),
    side: DoubleSide,
    opacity: 0.25,
  });

  const godrayMeshes: Mesh[] = [];
  for (let i = 0; i < GODRAY_COUNT; i += 1) {
    const ray = new Mesh(godrayGeo, godrayMat);
    const ang = (i / GODRAY_COUNT) * Math.PI * 2;
    const dist = 60 + (i % 3) * 45;
    const zOffset = -i * 55;

    ray.position.set(Math.cos(ang) * dist, 120, zOffset);
    // Tilted sun angle
    ray.rotation.x = 0.25;
    ray.rotation.z = -0.3 + (i % 2) * 0.1;
    godrayGroup.add(ray);
    godrayMeshes.push(ray);
  }
  group.add(godrayGroup);

  // 2. Marine Snow / Drifting Plankton
  // Instanced tiny drifting motes
  const planktonGeo = new CylinderGeometry(0.08, 0.08, 0.2, 4);
  const planktonMat = createAdditiveBasicMaterial({
    color: hdr(PLANKTON_CYAN, 0.9),
    opacity: 0.65,
  });
  const planktonMesh = new InstancedMesh(planktonGeo, planktonMat, PLANKTON_COUNT);
  planktonMesh.frustumCulled = false;

  const planktonData: Array<{
    basePos: Vector3;
    speed: number;
    driftPhase: number;
  }> = [];

  const matrix = new Matrix4();
  for (let i = 0; i < PLANKTON_COUNT; i += 1) {
    const pos = new Vector3(
      (Math.random() - 0.5) * 160,
      -40 + Math.random() * 160,
      -Math.random() * 850,
    );
    planktonData.push({
      basePos: pos.clone(),
      speed: 0.6 + Math.random() * 0.8,
      driftPhase: Math.random() * Math.PI * 2,
    });
    matrix.setPosition(pos);
    planktonMesh.setMatrixAt(i, matrix);
  }
  planktonMesh.instanceMatrix.needsUpdate = true;
  group.add(planktonMesh);

  scene.add(group);

  const scratchMat = new Matrix4();

  return {
    group,
    update(elapsed, dt, cameraPosition) {
      // Gentle shimmer in godrays
      const causticPulse = 0.15 + Math.sin(elapsed * 1.8) * 0.04 + Math.sin(elapsed * 3.4) * 0.02;
      godrayMat.color.copy(CAUSTIC_AQUA).multiplyScalar(causticPulse);

      // Animate marine snow drifting in ocean currents
      for (let i = 0; i < PLANKTON_COUNT; i += 1) {
        const p = planktonData[i];
        const driftY = Math.sin(elapsed * p.speed + p.driftPhase) * 2.0;
        const driftX = Math.cos(elapsed * 0.5 + p.driftPhase) * 1.5;

        // Wrap plankton around camera along Z so there's always motes around the player
        let z = p.basePos.z;
        const relZ = z - cameraPosition.z;
        if (relZ > 40) p.basePos.z -= 800;
        else if (relZ < -760) p.basePos.z += 800;

        scratchMat.makeTranslation(p.basePos.x + driftX, p.basePos.y + driftY, p.basePos.z);
        planktonMesh.setMatrixAt(i, scratchMat);
      }
      planktonMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      group.removeFromParent();
      disposeObject3D(group);
    },
  };
}
