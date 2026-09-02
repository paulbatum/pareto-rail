import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  hdr,
  PARASITE_CORE,
  PARASITE_DEEP,
  PARASITE_LILAC,
  PARASITE_VIOLET,
  PARASITE_WEB,
} from './palette';
import type { ShardSpec } from './effects';

// Helper to assemble compound meshes with shard explosion specs
function makeWireEdges(geometry: BufferGeometry, color: Color, intensity = 1.4): LineSegments {
  const edges = new EdgesGeometry(geometry);
  const mat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(color, intensity) }),
  );
  return new LineSegments(edges, mat);
}

// 1. Polyp: Bulbous parasitic cyst clamped to a strand with hooked barbs
export function createPolypMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  // Bulbous central cyst
  const bodyGeo = new SphereGeometry(0.85, 12, 10);
  const bodyMat = createAdditiveBasicMaterial({
    color: PARASITE_VIOLET.clone().multiplyScalar(0.7),
    opacity: 0.9,
  });
  const bodyMesh = new Mesh(bodyGeo, bodyMat);
  bodyMesh.scale.set(1.0, 1.25, 0.9);
  group.add(bodyMesh);

  // Toxic pulsing core
  const coreGeo = new SphereGeometry(0.45, 8, 6);
  const coreMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_CORE, 1.8),
  });
  const coreMesh = new Mesh(coreGeo, coreMat);
  group.add(coreMesh);

  // 4 hooked chitin barbs clamping onto the strand
  const barbGeo = new ConeGeometry(0.2, 0.9, 5);
  const barbMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_DEEP, 1.2),
  });
  for (let i = 0; i < 4; i += 1) {
    const ang = (i / 4) * Math.PI * 2;
    const barb = new Mesh(barbGeo, barbMat);
    barb.position.set(Math.cos(ang) * 0.7, -0.4, Math.sin(ang) * 0.7);
    barb.rotation.x = Math.PI * 0.75;
    barb.rotation.z = -ang;
    group.add(barb);

    const dir = new Vector3(Math.cos(ang), -0.5, Math.sin(ang)).normalize();
    shardSpecs.push({ direction: dir, color: PARASITE_DEEP.clone(), size: 0.35 });
  }

  // Sensory feelers
  const feelerGeo = new CylinderGeometry(0.04, 0.02, 1.1, 4);
  const feelerMat = new LineBasicMaterial({ color: hdr(PARASITE_LILAC, 1.5) });
  for (let i = 0; i < 2; i += 1) {
    const feeler = new Mesh(feelerGeo, feelerMat);
    feeler.position.set((i === 0 ? -1 : 1) * 0.35, 0.9, 0.2);
    feeler.rotation.z = (i === 0 ? 1 : -1) * 0.3;
    group.add(feeler);
  }

  shardSpecs.push(
    { direction: new Vector3(0, 1, 0), color: PARASITE_VIOLET.clone(), size: 0.4 },
    { direction: new Vector3(0, -1, 0), color: PARASITE_CORE.clone(), size: 0.4 },
  );

  group.userData.shardSpecs = shardSpecs;
  group.userData.core = coreMesh;
  group.userData.accent = PARASITE_VIOLET.clone();
  return group;
}

// 2. Mite: Sleek, fast-skittering winged predator with twin serrated fins
export function createMiteMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  // Central streamlined body
  const bodyGeo = new OctahedronGeometry(0.8, 0);
  const bodyMat = createAdditiveBasicMaterial({
    color: PARASITE_VIOLET.clone().multiplyScalar(0.75),
    opacity: 0.85,
  });
  const bodyMesh = new Mesh(bodyGeo, bodyMat);
  bodyMesh.scale.set(0.7, 0.5, 1.6);
  group.add(bodyMesh);

  const wire = makeWireEdges(bodyGeo, PARASITE_LILAC, 1.6);
  wire.scale.copy(bodyMesh.scale);
  group.add(wire);

  // Toxic stinger eye
  const eyeGeo = new SphereGeometry(0.28, 8, 6);
  const eyeMat = createAdditiveBasicMaterial({ color: hdr(PARASITE_CORE, 2.0) });
  const eyeMesh = new Mesh(eyeGeo, eyeMat);
  eyeMesh.position.set(0, 0.1, 0.9);
  group.add(eyeMesh);

  // Twin sweeping razor fins / wings
  const wingGeo = new TetrahedronGeometry(0.9, 0);
  const wingMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_DEEP, 1.2),
    side: DoubleSide,
    opacity: 0.8,
  });

  const leftWing = new Mesh(wingGeo, wingMat);
  leftWing.position.set(-1.1, 0, -0.2);
  leftWing.scale.set(1.4, 0.15, 0.8);
  leftWing.rotation.y = -0.3;
  group.add(leftWing);

  const rightWing = new Mesh(wingGeo, wingMat);
  rightWing.position.set(1.1, 0, -0.2);
  rightWing.scale.set(1.4, 0.15, 0.8);
  rightWing.rotation.y = 0.3;
  group.add(rightWing);

  shardSpecs.push(
    { direction: new Vector3(-1, 0.3, 0).normalize(), color: PARASITE_VIOLET.clone(), size: 0.35 },
    { direction: new Vector3(1, 0.3, 0).normalize(), color: PARASITE_VIOLET.clone(), size: 0.35 },
    { direction: new Vector3(0, 0, 1), color: PARASITE_CORE.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: PARASITE_DEEP.clone(), size: 0.35 },
  );

  group.userData.shardSpecs = shardSpecs;
  group.userData.eye = eyeMesh;
  group.userData.accent = PARASITE_LILAC.clone();
  return group;
}

// 3. Spitter: Armored spore siphon with ribbed shell plates
export function createSpitterMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  // Ribbed siphon body (multi-segment cylinder/cone)
  const segments = 3;
  for (let i = 0; i < segments; i += 1) {
    const radius = 1.1 - i * 0.22;
    const ringGeo = new TorusGeometry(radius, 0.28, 8, 16);
    const ringMat = createAdditiveBasicMaterial({
      color: PARASITE_VIOLET.clone().multiplyScalar(0.7),
    });
    const ringMesh = new Mesh(ringGeo, ringMat);
    ringMesh.position.z = -i * 0.7;
    group.add(ringMesh);

    const wire = makeWireEdges(ringGeo, PARASITE_LILAC, 1.3);
    wire.position.copy(ringMesh.position);
    group.add(wire);
  }

  // Glowing venom chamber inside
  const chamberGeo = new SphereGeometry(0.75, 10, 8);
  const chamberMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_CORE, 1.8),
  });
  const chamberMesh = new Mesh(chamberGeo, chamberMat);
  chamberMesh.position.z = -0.6;
  group.add(chamberMesh);

  // Venom nozzle / mouth
  const nozzleGeo = new CylinderGeometry(0.35, 0.6, 0.8, 8, 1, true);
  const nozzleMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_DEEP, 1.4),
    side: DoubleSide,
  });
  const nozzleMesh = new Mesh(nozzleGeo, nozzleMat);
  nozzleMesh.rotation.x = Math.PI / 2;
  nozzleMesh.position.z = 0.5;
  group.add(nozzleMesh);

  shardSpecs.push(
    { direction: new Vector3(0, 1, 0), color: PARASITE_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(0, -1, 0), color: PARASITE_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(1, 0, 0), color: PARASITE_LILAC.clone(), size: 0.45 },
    { direction: new Vector3(-1, 0, 0), color: PARASITE_LILAC.clone(), size: 0.45 },
    { direction: new Vector3(0, 0, 1), color: PARASITE_CORE.clone(), size: 0.5 },
  );

  group.userData.shardSpecs = shardSpecs;
  group.userData.chamber = chamberMesh;
  group.userData.accent = PARASITE_CORE.clone();
  return group;
}

// 4. Spore: Lockable venom mine / hostile shot hazard
export function createSporeMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  const coreGeo = new IcosahedronGeometry(0.35, 1);
  const coreMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_CORE, 2.2),
  });
  const coreMesh = new Mesh(coreGeo, coreMat);
  group.add(coreMesh);

  const spikeGeo = new OctahedronGeometry(0.55, 0);
  const spikeMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_LILAC, 1.5),
    opacity: 0.85,
  });
  const spikeMesh = new Mesh(spikeGeo, spikeMat);
  group.add(spikeMesh);

  shardSpecs.push(
    { direction: new Vector3(0, 1, 0), color: PARASITE_CORE.clone(), size: 0.25 },
    { direction: new Vector3(0, -1, 0), color: PARASITE_CORE.clone(), size: 0.25 },
  );

  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  return group;
}

// 5. Lattice: Boss Webbing Node guarding the parent organism
export function createLatticeMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  // Geometric web node
  const nodeGeo = new OctahedronGeometry(1.2, 0);
  const nodeMat = createAdditiveBasicMaterial({
    color: PARASITE_WEB.clone().multiplyScalar(0.7),
    opacity: 0.9,
  });
  const nodeMesh = new Mesh(nodeGeo, nodeMat);
  group.add(nodeMesh);

  const wire = makeWireEdges(nodeGeo, PARASITE_LILAC, 1.8);
  group.add(wire);

  // Glowing web junction center
  const centerGeo = new SphereGeometry(0.5, 8, 6);
  const centerMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_CORE, 2.0),
  });
  const centerMesh = new Mesh(centerGeo, centerMat);
  group.add(centerMesh);

  // Radiating web filament rings
  const ringGeo = new RingGeometry(1.4, 1.55, 16);
  const ringMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_WEB, 1.2),
    side: DoubleSide,
    opacity: 0.7,
  });
  const ringMesh = new Mesh(ringGeo, ringMat);
  group.add(ringMesh);

  shardSpecs.push(
    { direction: new Vector3(1, 1, 0).normalize(), color: PARASITE_WEB.clone(), size: 0.4 },
    { direction: new Vector3(-1, 1, 0).normalize(), color: PARASITE_WEB.clone(), size: 0.4 },
    { direction: new Vector3(1, -1, 0).normalize(), color: PARASITE_WEB.clone(), size: 0.4 },
    { direction: new Vector3(-1, -1, 0).normalize(), color: PARASITE_WEB.clone(), size: 0.4 },
  );

  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_WEB.clone();
  return group;
}

// 6. Brood: Mini skittering parasite spawned by boss
export function createBroodMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  const bodyGeo = new TetrahedronGeometry(0.55, 0);
  const bodyMat = createAdditiveBasicMaterial({
    color: PARASITE_VIOLET.clone().multiplyScalar(0.8),
  });
  const bodyMesh = new Mesh(bodyGeo, bodyMat);
  group.add(bodyMesh);

  const eyeGeo = new SphereGeometry(0.2, 6, 6);
  const eyeMat = createAdditiveBasicMaterial({ color: hdr(PARASITE_CORE, 2.2) });
  const eyeMesh = new Mesh(eyeGeo, eyeMat);
  eyeMesh.position.z = 0.35;
  group.add(eyeMesh);

  shardSpecs.push({ direction: new Vector3(0, 0, 1), color: PARASITE_CORE.clone(), size: 0.25 });

  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  return group;
}

// 7. Parent: The Colossal Crown Parasite (Boss)
export function createParentMesh(): Group {
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];

  // Massive swollen central brood-sac
  const sacGeo = new SphereGeometry(3.6, 18, 14);
  const sacMat = createAdditiveBasicMaterial({
    color: PARASITE_VIOLET.clone().multiplyScalar(0.65),
    opacity: 0.88,
  });
  const sacMesh = new Mesh(sacGeo, sacMat);
  sacMesh.scale.set(1.2, 1.4, 1.0);
  group.add(sacMesh);

  // Pulsing necrotic core inside
  const coreGeo = new SphereGeometry(2.0, 12, 10);
  const coreMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_CORE, 2.4),
  });
  const coreMesh = new Mesh(coreGeo, coreMat);
  group.add(coreMesh);

  // Barbed chitin carapaces layered around the crown
  for (let c = 0; c < 5; c += 1) {
    const plateGeo = new TorusGeometry(3.2 + c * 0.4, 0.4, 8, 20, Math.PI * 1.2);
    const plateMat = createAdditiveBasicMaterial({
      color: hdr(PARASITE_DEEP, 1.3),
    });
    const plateMesh = new Mesh(plateGeo, plateMat);
    plateMesh.position.z = -1.2 + c * 0.6;
    plateMesh.rotation.z = (c * Math.PI) / 3;
    group.add(plateMesh);
  }

  // 6 massive grasping claw arms digging into the jellyfish crown
  const armGeo = new CylinderGeometry(0.3, 0.1, 4.2, 6);
  const armMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_DEEP, 1.5),
  });
  for (let a = 0; a < 6; a += 1) {
    const ang = (a / 6) * Math.PI * 2;
    const arm = new Mesh(armGeo, armMat);
    arm.position.set(Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, -1.0);
    arm.rotation.z = ang - Math.PI / 2;
    arm.rotation.x = Math.PI * 0.35;
    group.add(arm);

    const dir = new Vector3(Math.cos(ang), Math.sin(ang), -0.5).normalize();
    shardSpecs.push({ direction: dir, color: PARASITE_DEEP.clone(), size: 0.6 });
  }

  for (let i = 0; i < 12; i += 1) {
    const ang = (i / 12) * Math.PI * 2;
    shardSpecs.push({
      direction: new Vector3(Math.cos(ang), Math.sin(ang), (Math.random() - 0.5) * 2).normalize(),
      color: i % 2 === 0 ? PARASITE_VIOLET.clone() : PARASITE_CORE.clone(),
      size: 0.55,
    });
  }

  group.userData.shardSpecs = shardSpecs;
  group.userData.core = coreMesh;
  group.userData.accent = PARASITE_CORE.clone();
  return group;
}
