import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import {
  DARK_RUST,
  DIRTY_CREAM,
  FLESH_RIDGE,
  INK,
  LAMP,
  OILY_FLESH,
  OCHRE,
  RUST,
  UI_CREAM,
  UI_RED,
} from './palette';
import { thermalBasic, thermalStandard } from './materials';

const sphere = new SphereGeometry(1, 14, 10);
const lowSphere = new IcosahedronGeometry(1, 1);
const box = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(1, 1, 1, 10);
const capsule = new CapsuleGeometry(0.5, 1.2, 5, 9);

function addLockBrackets(group: Group, radius: number) {
  const brackets = new Group();
  brackets.name = 'thermal-lock-brackets';
  brackets.visible = false;
  for (let index = 0; index < 4; index += 1) {
    const arc = new Mesh(
      new TorusGeometry(radius, 0.055, 5, 10, Math.PI * 0.38),
      thermalBasic('ui-red', UI_RED),
    );
    arc.rotation.z = index * Math.PI / 2 + Math.PI * 0.31;
    brackets.add(arc);
  }
  brackets.userData.lockBrackets = true;
  group.add(brackets);
  group.userData.lockBrackets = brackets;
}

export function createArmTarget() {
  const group = new Group();
  group.userData.targetKind = 'arm';

  for (let index = 0; index < 9; index += 1) {
    const radius = 1.2 + index * 0.18;
    const segment = new Mesh(
      sphere,
      thermalStandard('hot', index % 2 === 0 ? OILY_FLESH : FLESH_RIDGE, {
        roughness: 0.48,
        metalness: 0.05,
        emissive: 0x090302,
        emissiveIntensity: 0.12,
      }),
    );
    segment.scale.set(radius * 1.02, radius * 0.78, radius * 1.28);
    segment.position.set(
      Math.sin(index * 0.9) * (0.4 + index * 0.08),
      Math.cos(index * 0.72) * (0.3 + index * 0.045),
      index * 1.9,
    );
    segment.userData.armSegment = index;
    group.add(segment);

    if (index > 0 && index % 2 === 0) {
      const sucker = new Mesh(
        new TorusGeometry(radius * 0.28, 0.08, 5, 12),
        thermalStandard('hot', 0x7f5141, { roughness: 0.56 }),
      );
      sucker.position.set(segment.position.x, segment.position.y - radius * 0.73, segment.position.z - 0.18);
      sucker.rotation.x = Math.PI / 2;
      group.add(sucker);
    }
  }

  const nerve = new Mesh(
    new SphereGeometry(0.62, 14, 10),
    thermalStandard('core', 0x6d1910, {
      emissive: 0x6d1308,
      emissiveIntensity: 0.85,
      thermalEmissiveIntensity: 1.8,
      roughness: 0.35,
    }),
  );
  nerve.scale.z = 0.62;
  nerve.position.z = -0.45;
  group.add(nerve);

  // Harbor debris has been pulled into the flesh: cable collars and a snapped
  // cream plate make the silhouette read as mutant-industrial, not generic.
  const collar = new Mesh(
    new TorusGeometry(1.55, 0.18, 7, 20),
    thermalStandard('hot', RUST, { roughness: 0.78, metalness: 0.52 }),
  );
  collar.position.z = 4.2;
  group.add(collar);
  const plate = new Mesh(box, thermalStandard('hot', DIRTY_CREAM, { roughness: 0.86, metalness: 0.3 }));
  plate.scale.set(1.65, 0.18, 0.9);
  plate.position.set(1.2, 0.4, 6.2);
  plate.rotation.set(0.3, 0.2, 0.5);
  group.add(plate);

  addLockBrackets(group, 2.05);
  return group;
}

export function createScavengerTarget() {
  const group = new Group();
  group.userData.targetKind = 'scavenger';
  const body = new Mesh(
    new DodecahedronGeometry(1.3, 0),
    thermalStandard('hot', OILY_FLESH, {
      roughness: 0.52,
      emissive: 0x080302,
      emissiveIntensity: 0.1,
    }),
  );
  body.scale.set(1.4, 0.7, 1);
  group.add(body);

  for (let side = -1; side <= 1; side += 2) {
    for (let leg = 0; leg < 3; leg += 1) {
      const limb = new Mesh(
        cylinder,
        thermalStandard('hot', leg % 2 ? RUST : FLESH_RIDGE, { roughness: 0.72, metalness: 0.18 }),
      );
      limb.scale.set(0.12, 1.45 + leg * 0.25, 0.12);
      limb.position.set(side * (1.35 + leg * 0.45), -0.45 + leg * 0.12, (leg - 1) * 0.65);
      limb.rotation.z = side * (0.78 + leg * 0.12);
      limb.rotation.x = (leg - 1) * 0.28;
      limb.userData.scavengerLeg = side * (leg + 1);
      group.add(limb);
    }
    const claw = new Mesh(
      new ConeGeometry(0.45, 1.5, 5),
      thermalStandard('hot', DARK_RUST, { roughness: 0.72, metalness: 0.42 }),
    );
    claw.position.set(side * 2.65, 0.2, 0.45);
    claw.rotation.z = -side * Math.PI / 2;
    group.add(claw);
  }

  const eye = new Mesh(
    new SphereGeometry(0.28, 10, 7),
    thermalStandard('core', 0x66160c, {
      emissive: 0x721508,
      emissiveIntensity: 0.75,
      thermalEmissiveIntensity: 1.55,
    }),
  );
  eye.position.set(0, 0.18, -1.28);
  group.add(eye);
  addLockBrackets(group, 2.0);
  return group;
}

export function createCableEelTarget() {
  const group = new Group();
  group.userData.targetKind = 'cable-eel';
  for (let index = 0; index < 10; index += 1) {
    const vertebra = new Mesh(
      capsule,
      thermalStandard('hot', index % 3 === 0 ? RUST : OILY_FLESH, {
        roughness: 0.58,
        metalness: index % 3 === 0 ? 0.46 : 0.04,
      }),
    );
    const taper = 1 - index * 0.055;
    vertebra.scale.set(taper, 0.72 + taper * 0.2, taper);
    vertebra.position.set(
      Math.sin(index * 0.72) * 0.62,
      Math.cos(index * 0.55) * 0.25,
      index * 1.05,
    );
    vertebra.rotation.x = Math.PI / 2 + Math.sin(index * 0.7) * 0.24;
    vertebra.userData.eelSegment = index;
    group.add(vertebra);
  }
  const jaw = new Mesh(
    new ConeGeometry(0.82, 1.7, 6),
    thermalStandard('hot', FLESH_RIDGE, { roughness: 0.48 }),
  );
  jaw.rotation.x = -Math.PI / 2;
  jaw.position.z = -0.72;
  group.add(jaw);
  const sensor = new Mesh(
    new SphereGeometry(0.3, 10, 7),
    thermalStandard('core', 0x78180d, {
      emissive: 0x7b1208,
      emissiveIntensity: 0.8,
      thermalEmissiveIntensity: 1.65,
    }),
  );
  sensor.position.set(0, 0.42, -0.7);
  group.add(sensor);
  addLockBrackets(group, 1.55);
  return group;
}

export function createBoilerSpawnTarget() {
  const group = new Group();
  group.userData.targetKind = 'boiler-spawn';
  const shell = new Mesh(
    new DodecahedronGeometry(1.75, 1),
    thermalStandard('hot', RUST, { roughness: 0.76, metalness: 0.48 }),
  );
  shell.scale.set(1, 1.18, 0.82);
  group.add(shell);
  const belly = new Mesh(
    new SphereGeometry(1.03, 14, 10),
    thermalStandard('hot', OILY_FLESH, {
      emissive: 0x100402,
      emissiveIntensity: 0.14,
      roughness: 0.42,
    }),
  );
  belly.position.z = -1.2;
  group.add(belly);
  const pressureCore = new Mesh(
    new SphereGeometry(0.52, 12, 8),
    thermalStandard('core', 0x77180c, {
      emissive: 0x831609,
      emissiveIntensity: 0.9,
      thermalEmissiveIntensity: 1.75,
    }),
  );
  pressureCore.position.z = -2;
  group.add(pressureCore);
  for (let index = 0; index < 4; index += 1) {
    const pipe = new Mesh(
      new CylinderGeometry(0.17, 0.25, 2.4, 7),
      thermalStandard('hot', index % 2 ? DIRTY_CREAM : DARK_RUST, {
        roughness: 0.8,
        metalness: 0.45,
      }),
    );
    const angle = index * Math.PI / 2;
    pipe.position.set(Math.cos(angle) * 1.9, Math.sin(angle) * 1.9, 0.3);
    pipe.rotation.z = angle + Math.PI / 2;
    group.add(pipe);
  }
  const valve = new Mesh(
    new TorusGeometry(0.72, 0.1, 6, 18),
    thermalStandard('hot', DIRTY_CREAM, { roughness: 0.8, metalness: 0.52 }),
  );
  valve.position.z = 1.7;
  group.add(valve);
  addLockBrackets(group, 2.6);
  return group;
}

export function createInkCloudTarget() {
  const group = new Group();
  group.userData.targetKind = 'ink-cloud';
  group.userData.raildIgnoreOcclusion = true;
  const geometry = new DodecahedronGeometry(1, 1);
  for (let index = 0; index < 24; index += 1) {
    const blob = new Mesh(
      geometry,
      thermalBasic('ink', INK, {
        opacity: 0.28 + (index % 5) * 0.035,
        depthWrite: false,
      }),
    );
    const angle = index * 2.399963;
    const radius = 3.5 + (index % 7) * 1.9;
    blob.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.66,
      ((index * 7) % 11) - 5,
    );
    const scale = 2.1 + (index % 6) * 0.75;
    blob.scale.set(scale * 1.4, scale, scale * 1.15);
    blob.userData.inkBlob = index;
    group.add(blob);
  }
  return group;
}

export function createCoreTarget() {
  const group = new Group();
  group.userData.targetKind = 'core';
  const membrane = new Mesh(
    new SphereGeometry(2.25, 20, 14),
    thermalStandard('hot', OILY_FLESH, {
      opacity: 0.88,
      roughness: 0.38,
      emissive: 0x0b0202,
      emissiveIntensity: 0.2,
    }),
  );
  membrane.scale.set(1.25, 1.45, 0.72);
  group.add(membrane);
  const core = new Mesh(
    new IcosahedronGeometry(1.15, 2),
    thermalStandard('core', 0x86180d, {
      emissive: 0x9b170a,
      emissiveIntensity: 1.1,
      thermalEmissiveIntensity: 2.15,
      roughness: 0.26,
    }),
  );
  core.position.z = -1.65;
  group.add(core);
  for (let index = 0; index < 6; index += 1) {
    const rib = new Mesh(
      new TorusGeometry(2.65 + index * 0.13, 0.12, 6, 28, Math.PI * 1.35),
      thermalStandard('hot', index % 2 ? RUST : FLESH_RIDGE, { roughness: 0.6 }),
    );
    rib.rotation.z = index * Math.PI / 3 + 0.35;
    rib.position.z = 0.2 + index * 0.06;
    group.add(rib);
  }
  addLockBrackets(group, 3.4);
  return group;
}

export function createLetterTarget(character: string) {
  const group = new Group();
  group.userData.targetKind = 'letter';
  const cells = glyphOnCells(character);
  const cellGeometry = new BoxGeometry(0.24, 0.24, 0.12);
  const cellMaterial = thermalStandard('ui', DIRTY_CREAM, {
    emissive: LAMP,
    emissiveIntensity: 0.38,
    thermalEmissiveIntensity: 0.72,
    roughness: 0.5,
  });
  for (const cell of cells) {
    const block = new Mesh(cellGeometry, cellMaterial);
    block.position.set((cell.x - 2) * 0.31, (3 - cell.y) * 0.31, 0);
    group.add(block);
  }
  const cage = new Mesh(
    new TorusGeometry(1.19, 0.055, 5, 28),
    thermalStandard('ui-red', RUST, {
      emissive: 0x401007,
      emissiveIntensity: 0.32,
      thermalEmissiveIntensity: 1.05,
      roughness: 0.65,
      metalness: 0.4,
    }),
  );
  cage.scale.y = 1.15;
  group.add(cage);
  const underline = new Mesh(box, thermalBasic('ui', UI_CREAM));
  underline.scale.set(1.18, 0.035, 0.05);
  underline.position.y = -1.27;
  group.add(underline);
  addLockBrackets(group, 1.43);
  return group;
}

export function createProjectile() {
  const group = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.07, 0.19, 1.5, 7),
    thermalBasic('ui', UI_CREAM),
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const head = new Mesh(
    new ConeGeometry(0.22, 0.55, 7),
    thermalBasic('ui-red', UI_RED),
  );
  head.rotation.x = -Math.PI / 2;
  head.position.z = -0.95;
  group.add(head);
  const halo = new Mesh(new RingGeometry(0.25, 0.34, 18), thermalBasic('ui', LAMP, { opacity: 0.72 }));
  halo.position.z = -0.88;
  group.add(halo);
  return group;
}

export function createIndustrialReticle() {
  const group = new Group();
  group.userData.raildRole = 'reticle';
  const outer = new Mesh(new RingGeometry(1.12, 1.19, 48), thermalBasic('ui', UI_CREAM, { opacity: 0.88 }));
  outer.userData.reticleOuter = true;
  group.add(outer);
  const inner = new Mesh(new RingGeometry(0.37, 0.42, 28), thermalBasic('ui-red', UI_RED, { opacity: 0.88 }));
  inner.userData.reticleInner = true;
  group.add(inner);
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(box, thermalBasic(index % 2 ? 'ui' : 'ui-red', index % 2 ? UI_CREAM : UI_RED));
    tick.scale.set(0.32, 0.035, 0.02);
    tick.position.x = 0.82;
    tick.rotation.z = index * Math.PI / 2;
    tick.position.applyAxisAngle(new Vector3(0, 0, 1), index * Math.PI / 2);
    group.add(tick);
  }
  const sensor = new Mesh(new SphereGeometry(0.055, 8, 6), thermalBasic('ui-red', UI_RED));
  sensor.position.set(-0.18, -1.34, 0);
  sensor.userData.thermalSensor = true;
  group.add(sensor);
  return group;
}

export function setTargetLocked(mesh: Object3D, locked: boolean) {
  const brackets = mesh.userData.lockBrackets as Object3D | undefined;
  if (brackets) brackets.visible = locked;
  mesh.userData.locked = locked;
  mesh.userData.lockKick = locked ? 1 : 0;
}

export function denyTarget(mesh: Object3D) {
  mesh.userData.denied = 1;
}

export function animateTargetModel(mesh: Object3D, dt: number, elapsed: number) {
  const denied = Number(mesh.userData.denied ?? 0);
  if (denied > 0) {
    mesh.userData.denied = Math.max(0, denied - dt * 3.4);
    const kick = 1 - Math.sin(denied * Math.PI * 5) * denied * 0.12;
    mesh.scale.setScalar(kick);
  } else {
    mesh.scale.lerp(new Vector3(1, 1, 1), Math.min(1, dt * 9));
  }

  const brackets = mesh.userData.lockBrackets as Object3D | undefined;
  if (brackets?.visible) {
    brackets.rotation.z += dt * 2.8;
    const pulse = 1 + Math.sin(elapsed * 9) * 0.08;
    brackets.scale.setScalar(pulse);
  }

  if (mesh.userData.targetKind === 'arm') {
    const flex = Number(mesh.userData.flex ?? elapsed);
    mesh.traverse((child) => {
      const segment = child.userData.armSegment;
      if (typeof segment !== 'number') return;
      child.position.x += Math.sin(flex * 2 + segment * 0.9) * dt * 0.16;
      child.rotation.z = Math.sin(flex * 1.5 + segment * 0.6) * 0.14;
    });
  } else if (mesh.userData.targetKind === 'cable-eel') {
    const swim = Number(mesh.userData.swim ?? elapsed);
    mesh.traverse((child) => {
      const segment = child.userData.eelSegment;
      if (typeof segment !== 'number') return;
      child.position.x = Math.sin(segment * 0.72 + swim * 4.1) * (0.35 + segment * 0.045);
      child.rotation.z = Math.sin(segment * 0.6 + swim * 3.2) * 0.26;
    });
  } else if (mesh.userData.targetKind === 'scavenger') {
    const scuttle = Number(mesh.userData.scuttle ?? elapsed);
    mesh.traverse((child) => {
      const leg = child.userData.scavengerLeg;
      if (typeof leg !== 'number') return;
      child.rotation.x = Math.sin(scuttle * 10 + Math.abs(leg)) * 0.35;
    });
  } else if (mesh.userData.targetKind === 'ink-cloud') {
    const cloudAge = Number(mesh.userData.cloudAge ?? elapsed);
    mesh.traverse((child) => {
      const index = child.userData.inkBlob;
      if (typeof index !== 'number') return;
      child.rotation.x += dt * (0.08 + (index % 4) * 0.025);
      child.rotation.y -= dt * (0.06 + (index % 5) * 0.02);
      child.position.x += Math.sin(cloudAge * 0.5 + index) * dt * 0.12;
    });
  } else if (mesh.userData.targetKind === 'core') {
    const heartbeat = Number(mesh.userData.heartbeat ?? elapsed);
    const pulse = 1 + Math.sin(heartbeat * Math.PI * 1.6) * 0.045;
    mesh.scale.multiplyScalar(pulse / Math.max(0.001, mesh.scale.x));
  }
}

