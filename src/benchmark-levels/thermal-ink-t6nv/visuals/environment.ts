import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';

export interface HarborEnvironment {
  group: Group;
  waterMesh: Mesh;
  update: (elapsed: number, dt: number, inkAmount: number) => void;
}

export function createHarborEnvironment(scene: Scene): HarborEnvironment {
  const group = new Group();

  // 1. Water Plane (Tobacco brown water)
  const waterGeo = new PlaneGeometry(800, 800, 32, 32);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new MeshBasicMaterial({
    color: new Color(0.08, 0.05, 0.03),
    side: DoubleSide,
  });
  const waterMesh = new Mesh(waterGeo, waterMat);
  waterMesh.position.y = -22;
  group.add(waterMesh);

  // 2. Wrecked Hulls & Steel Crane Towers
  const hullMat = new MeshBasicMaterial({ color: new Color(0.22, 0.08, 0.05) }); // Rust red
  const steelMat = new MeshBasicMaterial({ color: new Color(0.1, 0.11, 0.13) }); // Dark steel
  const pipeMat = new MeshBasicMaterial({ color: new Color(0.45, 0.42, 0.38) }); // Dirty cream

  // Wrecked Ship Cargo Hulls placed safely away from combat line-of-sight
  const hullGeo = new BoxGeometry(20, 24, 75);
  const hull1 = new Mesh(hullGeo, hullMat);
  hull1.position.set(-42, -12, -80);
  hull1.rotation.set(0.1, 0.35, -0.15);
  group.add(hull1);

  const hull2 = new Mesh(hullGeo, hullMat);
  hull2.position.set(48, -14, -140);
  hull2.rotation.set(-0.15, -0.4, 0.1);
  group.add(hull2);

  // Crane towers and structural girders
  const girderGeo = new BoxGeometry(1.0, 1.0, 35);
  const girderMeshCount = 35;
  const girderInstanced = new InstancedMesh(girderGeo, steelMat, girderMeshCount);
  const dummy = new Matrix4();
  const quat = new Quaternion();

  for (let i = 0; i < girderMeshCount; i += 1) {
    const angle = (i / girderMeshCount) * Math.PI * 4;
    const radius = 42 + Math.sin(i * 1.7) * 12;
    const z = -20 - i * 8;
    const y = -12 + Math.cos(i * 0.9) * 14;
    quat.setFromAxisAngle(new Vector3(0, 1, 0), angle + Math.sin(i));
    dummy.compose(
      new Vector3(Math.cos(angle) * radius, y, z),
      quat,
      new Vector3(1 + Math.sin(i), 1 + Math.cos(i * 2) * 0.5, 1 + Math.cos(i * 0.5) * 1.5),
    );
    girderInstanced.setMatrixAt(i, dummy);
  }
  girderInstanced.instanceMatrix.needsUpdate = true;
  group.add(girderInstanced);

  // 3. Hanging Snapped Cables & Pipes
  const pipeGeo = new CylinderGeometry(0.35, 0.35, 25, 8);
  const pipeInstanced = new InstancedMesh(pipeGeo, pipeMat, 20);
  for (let i = 0; i < 20; i += 1) {
    const z = -15 - i * 14;
    const x = Math.sin(i * 1.3) * 32;
    const y = 12 + Math.cos(i * 2.1) * 8;
    quat.setFromAxisAngle(new Vector3(0, 0, 1), 0.3 + Math.sin(i) * 0.5);
    dummy.compose(new Vector3(x, y, z), quat, new Vector3(1, 1, 1));
    pipeInstanced.setMatrixAt(i, dummy);
  }
  pipeInstanced.instanceMatrix.needsUpdate = true;
  group.add(pipeInstanced);

  // 4. Sodium Industrial Lamps (Glow spheres)
  const lampMat = new MeshBasicMaterial({ color: new Color(2.5, 1.3, 0.3) }); // Glowing sodium orange
  const lampGeo = new BoxGeometry(0.8, 0.8, 0.8);
  const lampInstanced = new InstancedMesh(lampGeo, lampMat, 16);
  for (let i = 0; i < 16; i += 1) {
    const z = -25 - i * 16;
    const x = Math.cos(i * 1.5) * 28;
    const y = 10 + Math.sin(i * 0.8) * 6;
    dummy.compose(new Vector3(x, y, z), new Quaternion(), new Vector3(1, 1, 1));
    lampInstanced.setMatrixAt(i, dummy);
  }
  lampInstanced.instanceMatrix.needsUpdate = true;
  group.add(lampInstanced);

  scene.add(group);

  return {
    group,
    waterMesh,
    update(elapsed: number, _dt: number, _inkAmount: number) {
      // Gentle water bobbing
      waterMesh.position.y = -22 + Math.sin(elapsed * 1.2) * 0.4;
    },
  };
}
