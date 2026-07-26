import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three';

export type WorktableEnvironment = {
  tableGroup: Group;
  glueSpillMesh: Mesh;
  update(dt: number, elapsed: number): void;
};

export function createWorktableEnvironment(scene: Scene): WorktableEnvironment {
  const tableGroup = new Group();
  scene.add(tableGroup);

  // Main table surface (Mahogany wood background)
  const tableGeo = new PlaneGeometry(180, 240);
  const tableMat = new MeshStandardMaterial({
    color: 0x2d1f15,
    roughness: 0.7,
    metalness: 0.1,
  });
  const tableMesh = new Mesh(tableGeo, tableMat);
  tableMesh.rotation.x = -Math.PI / 2;
  tableMesh.position.set(0, -3, -100);
  tableMesh.receiveShadow = true;
  tableGroup.add(tableMesh);

  // Central Green Cutting Mat
  const matGeo = new PlaneGeometry(80, 180);
  const matMaterial = new MeshStandardMaterial({
    color: 0x1a3d2e,
    roughness: 0.6,
    metalness: 0.05,
  });
  const matMesh = new Mesh(matGeo, matMaterial);
  matMesh.rotation.x = -Math.PI / 2;
  matMesh.position.set(0, -2.95, -100);
  tableGroup.add(matMesh);

  // Grid lines on cutting mat (procedural strips)
  const lineMat = new MeshBasicMaterial({ color: 0x386b52 });
  for (let x = -35; x <= 35; x += 10) {
    const vLineGeo = new PlaneGeometry(0.15, 175);
    const vLine = new Mesh(vLineGeo, lineMat);
    vLine.rotation.x = -Math.PI / 2;
    vLine.position.set(x, -2.93, -100);
    tableGroup.add(vLine);
  }
  for (let z = -180; z <= -20; z += 10) {
    const hLineGeo = new PlaneGeometry(75, 0.15);
    const hLine = new Mesh(hLineGeo, lineMat);
    hLine.rotation.x = -Math.PI / 2;
    hLine.position.set(0, -2.93, z);
    tableGroup.add(hLine);
  }

  // Scratches / road lines on table
  const scratchMat = new MeshBasicMaterial({ color: 0x5a4835 });
  const scratchPositions = [
    { x: -12, z: -40, w: 0.4, h: 25, rot: 0.2 },
    { x: 14, z: -80, w: 0.4, h: 30, rot: -0.15 },
    { x: -8, z: -130, w: 0.4, h: 35, rot: 0.1 },
    { x: 10, z: -170, w: 0.4, h: 28, rot: -0.25 },
  ];
  for (const s of scratchPositions) {
    const scratch = new Mesh(new PlaneGeometry(s.w, s.h), scratchMat);
    scratch.rotation.x = -Math.PI / 2;
    scratch.rotation.z = s.rot;
    scratch.position.set(s.x, -2.92, s.z);
    tableGroup.add(scratch);
  }

  // Central dark Glue Spill pool (at boss area z = -140)
  const spillGeo = new SphereGeometry(12, 32, 16);
  spillGeo.scale(1, 0.05, 1);
  const spillMat = new MeshStandardMaterial({
    color: 0x120a1f,
    roughness: 0.2,
    metalness: 0.8,
    emissive: 0x1f0b3b,
    emissiveIntensity: 0.4,
  });
  const glueSpillMesh = new Mesh(spillGeo, spillMat);
  glueSpillMesh.position.set(0, -2.85, -140);
  tableGroup.add(glueSpillMesh);

  // Warm Desk Lamp Lighting
  const lampLight = new SpotLight(0xfff3d1, 2.8, 150, Math.PI / 3, 0.4, 1);
  lampLight.position.set(20, 45, -80);
  lampLight.target.position.set(0, -3, -100);
  scene.add(lampLight);
  scene.add(lampLight.target);

  const ambientWarmth = new PointLight(0xff9d42, 0.8, 200);
  ambientWarmth.position.set(-25, 30, -60);
  scene.add(ambientWarmth);

  // Stationery Clutter Props (Pencil Cup, Erasers, Cards, Rulers along edges)
  createTableProps(tableGroup);

  return {
    tableGroup,
    glueSpillMesh,
    update(_dt, elapsed) {
      // Subtle glow pulse on glue spill
      spillMat.emissiveIntensity = 0.35 + Math.sin(elapsed * 2.5) * 0.15;
    },
  };
}

function createTableProps(parent: Group) {
  // Pencil Cup
  const cupGroup = new Group();
  cupGroup.position.set(-32, -2.9, -60);

  const cupMat = new MeshStandardMaterial({ color: 0x8899aa, roughness: 0.3, metalness: 0.7 });
  const cupMesh = new Mesh(new CylinderGeometry(3.5, 3, 9, 16), cupMat);
  cupMesh.position.y = 4.5;
  cupGroup.add(cupMesh);

  // Pencils inside cup
  const pencilMat = new MeshStandardMaterial({ color: 0xe6a100, roughness: 0.5 });
  const pencilGeo = new CylinderGeometry(0.3, 0.3, 14, 8);
  for (let i = 0; i < 5; i++) {
    const pencil = new Mesh(pencilGeo, pencilMat);
    pencil.position.set((i - 2) * 1.1, 7, (i % 2) * 0.8);
    pencil.rotation.z = (i - 2) * 0.12;
    cupGroup.add(pencil);
  }
  parent.add(cupGroup);

  // Eraser blocks
  const pinkEraserMat = new MeshStandardMaterial({ color: 0xff7799, roughness: 0.8 });
  const eraser1 = new Mesh(new BoxGeometry(3, 1.2, 5), pinkEraserMat);
  eraser1.position.set(28, -2.3, -45);
  eraser1.rotation.y = 0.4;
  parent.add(eraser1);

  const whiteEraserMat = new MeshStandardMaterial({ color: 0xf0f0f5, roughness: 0.6 });
  const eraser2 = new Mesh(new BoxGeometry(2.5, 1, 4), whiteEraserMat);
  eraser2.position.set(30, -2.4, -90);
  eraser2.rotation.y = -0.3;
  parent.add(eraser2);

  // Large Wooden Rulers along edges
  const rulerMat = new MeshStandardMaterial({ color: 0xd4a359, roughness: 0.5 });
  const ruler1 = new Mesh(new BoxGeometry(1.5, 0.3, 35), rulerMat);
  ruler1.position.set(-34, -2.8, -110);
  ruler1.rotation.y = 0.08;
  parent.add(ruler1);

  const ruler2 = new Mesh(new BoxGeometry(1.5, 0.3, 45), rulerMat);
  ruler2.position.set(33, -2.8, -150);
  ruler2.rotation.y = -0.05;
  parent.add(ruler2);

  // Scattered Paper Clips & Buttons around table
  const clipMat = new MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });
  const clipGeo = new CylinderGeometry(0.1, 0.1, 1.8, 8);
  for (let i = 0; i < 15; i++) {
    const clip = new Mesh(clipGeo, clipMat);
    const angle = (i / 15) * Math.PI * 2;
    clip.position.set(Math.cos(angle) * 25 + (i % 3), -2.85, -30 - i * 9);
    clip.rotation.x = Math.PI / 2;
    clip.rotation.z = i * 0.7;
    parent.add(clip);
  }
}
