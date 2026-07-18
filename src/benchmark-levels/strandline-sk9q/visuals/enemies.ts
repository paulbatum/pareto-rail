import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { GOLD, JADE, VIOLET, VIOLET_DARK, VIOLET_HOT, VIOLET_PALE, hdr } from './palette';

// STRANDLINE parasite meshes — leaf construction. Every parasite is built from
// the same violet family: latched ticks, dashing sea-spiders, armored cysts,
// tube-worm spitters, and the spores/broodlings of the colony. Each mesh
// exposes userData.parts (fill/edge/core) so the spine can tint locked,
// denied, and damage-flash states; kind-specific pieces hang off userData for
// the animators below.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'fill' | 'edge' | 'core';
};

function part(material: MeshBasicMaterial, kind: TintPart['kind']): TintPart {
  return { material, base: material.color.clone(), kind };
}

function basic(color: Color) {
  return new MeshBasicMaterial({ color });
}

function glow(color: Color, opacity = 1) {
  return new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: AdditiveBlending, depthWrite: false });
}

// ---- latcher: a latched tick clinging to its strand ----------------------------

export function createLatcherMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  // The perch: a short bead of strand it clamps onto. Dropped when it detaches.
  const perchMaterial = new MeshBasicMaterial({ color: hdr(JADE, 0.5) });
  const perch = new Mesh(new CylinderGeometry(0.035, 0.022, 7.5, 5), perchMaterial);
  perch.position.y = 0.4;
  group.add(perch);

  const bodyMaterial = basic(VIOLET.clone());
  const body = new Mesh(new SphereGeometry(0.62, 10, 8), bodyMaterial);
  body.scale.set(1, 0.45, 1);
  parts.push(part(bodyMaterial, 'fill'));

  const suckerMaterial = glow(hdr(VIOLET_HOT, 1.3));
  const sucker = new Mesh(new RingGeometry(0.14, 0.24, 12), suckerMaterial);
  sucker.position.y = -0.26;
  sucker.rotation.x = -Math.PI / 2;
  parts.push(part(suckerMaterial, 'core'));

  const legs = new Group();
  const legMaterial = basic(VIOLET_DARK.clone());
  for (let i = 0; i < 6; i += 1) {
    const leg = new Mesh(new ConeGeometry(0.045, 0.72, 4), legMaterial);
    const angle = (i / 6) * Math.PI * 2;
    leg.position.set(Math.cos(angle) * 0.42, -0.18, Math.sin(angle) * 0.42);
    leg.rotation.z = Math.cos(angle) * 1.9;
    leg.rotation.x = -Math.sin(angle) * 1.9;
    legs.add(leg);
  }
  parts.push(part(legMaterial, 'edge'));

  const spikes = new Group();
  const spikeMaterial = basic(VIOLET_DARK.clone().multiplyScalar(0.8));
  for (let i = 0; i < 5; i += 1) {
    const spike = new Mesh(new ConeGeometry(0.05, 0.3, 4), spikeMaterial);
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    spike.position.set(Math.cos(angle) * 0.3, 0.24, Math.sin(angle) * 0.3);
    spike.rotation.z = -Math.cos(angle) * 0.5;
    spike.rotation.x = Math.sin(angle) * 0.5;
    spikes.add(spike);
  }

  group.add(body, sucker, legs, spikes);
  group.userData.parts = parts;
  group.userData.perch = perch;
  group.userData.legs = legs;
  group.userData.body = body;
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

export function animateLatcher(mesh: Object3D, dt: number, elapsed: number) {
  const pulse = (mesh.userData.pulse as number | undefined) ?? 0.5;
  const body = mesh.userData.body as Mesh | undefined;
  if (body) body.scale.set(1 + pulse * 0.12, 0.45 * (1 - pulse * 0.15), 1 + pulse * 0.12);
  const legs = mesh.userData.legs as Group | undefined;
  const perch = mesh.userData.perch as Mesh | undefined;
  if (mesh.userData.detached === true) {
    // Free-swimming: legs kick hard and the perch is gone.
    if (legs) {
      legs.children.forEach((leg, index) => {
        leg.rotation.y = Math.sin(elapsed * 16 + index) * 0.5;
      });
    }
    if (perch && perch.scale.y > 0.01) {
      perch.scale.y = Math.max(0.01, perch.scale.y - dt * 6);
      perch.rotation.x += dt * 3;
      perch.position.y -= dt * 2.5;
    }
  } else if (legs) {
    legs.rotation.y = Math.sin(elapsed * 1.3 + mesh.id) * 0.12;
  }
}

// ---- skitter: a sea-spider dashing along the strands ---------------------------

export function createSkitterMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const bodyMaterial = basic(VIOLET_DARK.clone().multiplyScalar(1.4));
  const body = new Mesh(new SphereGeometry(0.5, 10, 7), bodyMaterial);
  body.scale.set(1.6, 0.5, 0.6);
  parts.push(part(bodyMaterial, 'fill'));

  const bandMaterial = glow(hdr(VIOLET, 1.2));
  for (const offset of [-0.35, 0.05, 0.45]) {
    const band = new Mesh(new TorusGeometry(0.3, 0.03, 5, 12), bandMaterial);
    band.position.x = offset;
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 1, 0.55);
    group.add(band);
  }
  parts.push(part(bandMaterial, 'edge'));

  const eyeMaterial = glow(hdr(VIOLET_PALE, 1.5));
  const eye = new Mesh(new SphereGeometry(0.09, 6, 5), eyeMaterial);
  eye.position.set(0.72, 0.08, 0);
  parts.push(part(eyeMaterial, 'core'));

  const legs = new Group();
  const legMaterial = basic(VIOLET.clone().multiplyScalar(0.85));
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i += 1) {
      const leg = new Mesh(new CylinderGeometry(0.03, 0.016, 1.05, 4), legMaterial);
      leg.position.set(-0.5 + i * 0.34, -0.18, side * 0.38);
      leg.rotation.x = side * 1.1;
      legs.add(leg);
    }
  }
  parts.push(part(legMaterial, 'edge'));

  const antennaMaterial = basic(VIOLET.clone());
  for (let side = -1; side <= 1; side += 2) {
    const antenna = new Mesh(new CylinderGeometry(0.012, 0.008, 0.7, 4), antennaMaterial);
    antenna.position.set(0.85, 0.18, side * 0.12);
    antenna.rotation.z = -1.2;
    antenna.rotation.y = side * 0.4;
    group.add(antenna);
  }

  group.add(body, eye, legs);
  group.userData.parts = parts;
  group.userData.legs = legs;
  group.userData.accent = VIOLET.clone();
  return group;
}

export function animateSkitter(mesh: Object3D, _dt: number, elapsed: number) {
  const scurry = (mesh.userData.scurry as number | undefined) ?? 0.5;
  const legs = mesh.userData.legs as Group | undefined;
  if (legs) {
    const speed = 6 + scurry * 16;
    legs.children.forEach((leg, index) => {
      leg.rotation.x = (leg.position.z > 0 ? 1 : -1) * (1.1 + Math.sin(elapsed * speed + index * 1.7) * 0.45 * scurry);
    });
  }
  mesh.rotation.z += Math.sin(elapsed * 9 + mesh.id) * 0.002 * scurry;
}

// ---- husk: an armored brood cyst --------------------------------------------------

export function createHuskMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const coreMaterial = glow(hdr(VIOLET_HOT, 1.2));
  const core = new Mesh(new IcosahedronGeometry(0.5, 0), coreMaterial);
  parts.push(part(coreMaterial, 'core'));

  const plates = new Group();
  const plateMaterial = basic(VIOLET_DARK.clone());
  const plateEdgeMaterial = glow(hdr(VIOLET, 0.9));
  for (let i = 0; i < 6; i += 1) {
    const plate = new Mesh(new SphereGeometry(0.85, 8, 5, 0, Math.PI * 0.7, 0, Math.PI * 0.5), plateMaterial);
    const phi = (i / 6) * Math.PI * 2;
    plate.rotation.set(Math.sin(phi) * 1.1, phi, Math.cos(phi) * 0.7);
    plates.add(plate);
    const rim = new Mesh(new TorusGeometry(0.5, 0.02, 4, 10, Math.PI * 0.8), plateEdgeMaterial);
    rim.rotation.copy(plate.rotation);
    rim.position.copy(plate.position);
    plates.add(rim);
  }
  parts.push(part(plateMaterial, 'fill'));
  parts.push(part(plateEdgeMaterial, 'edge'));

  group.add(core, plates);
  group.userData.parts = parts;
  group.userData.plates = plates;
  group.userData.core = core;
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

export function animateHusk(mesh: Object3D, _dt: number, _elapsed: number) {
  const pulse = (mesh.userData.pulse as number | undefined) ?? 0.5;
  const core = mesh.userData.core as Mesh | undefined;
  if (core) core.scale.setScalar(1 + pulse * 0.2);
}

// Shed the armor plates: returns the plates' world positions for the burst.
export function crackHuskPlates(mesh: Object3D): Vector3[] {
  const plates = mesh.userData.plates as Group | undefined;
  if (!plates) return [];
  const shards: Vector3[] = [];
  for (const child of [...plates.children]) {
    shards.push(child.getWorldPosition(new Vector3()));
  }
  plates.visible = false;
  return shards;
}

// ---- spitter: a tube-worm that lobs spores ----------------------------------------

export function createSpitterMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const stalkMaterial = basic(VIOLET_DARK.clone().multiplyScalar(1.3));
  const stalk = new Mesh(new CylinderGeometry(0.14, 0.3, 1.5, 7), stalkMaterial);
  stalk.position.y = -0.4;
  stalk.rotation.z = 0.25;
  parts.push(part(stalkMaterial, 'fill'));

  const lipMaterial = glow(hdr(VIOLET_HOT, 1.5));
  const mouth = new Mesh(new ConeGeometry(0.42, 0.6, 8, 1, true), lipMaterial);
  mouth.position.set(0.18, 0.45, 0);
  mouth.rotation.z = -0.5;
  parts.push(part(lipMaterial, 'core'));

  const throatMaterial = glow(hdr(VIOLET_PALE, 1.5));
  const throat = new Mesh(new SphereGeometry(0.16, 8, 6), throatMaterial);
  throat.position.set(0.1, 0.32, 0);
  parts.push(part(throatMaterial, 'core'));

  const flagella = new Group();
  const flagellaMaterial = basic(VIOLET.clone().multiplyScalar(0.8));
  for (let i = 0; i < 3; i += 1) {
    const flagellum = new Mesh(new CylinderGeometry(0.015, 0.008, 0.9, 4), flagellaMaterial);
    const angle = (i / 3) * Math.PI * 2;
    flagellum.position.set(Math.cos(angle) * 0.3, -0.9, Math.sin(angle) * 0.3);
    flagellum.rotation.x = Math.sin(angle) * 0.4;
    flagellum.rotation.z = Math.cos(angle) * 0.4;
    flagella.add(flagellum);
  }
  parts.push(part(flagellaMaterial, 'edge'));

  group.add(stalk, mouth, throat, flagella);
  group.userData.parts = parts;
  group.userData.mouth = mouth;
  group.userData.throat = throat;
  group.userData.flagella = flagella;
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

export function animateSpitter(mesh: Object3D, _dt: number, elapsed: number) {
  const cue = (mesh.userData.cue as number | undefined) ?? 0;
  const mouth = mesh.userData.mouth as Mesh | undefined;
  const throat = mesh.userData.throat as Mesh | undefined;
  if (mouth) mouth.scale.setScalar(1 + cue * 0.8);
  if (throat) throat.scale.setScalar(1 + cue * 1.2 + Math.sin(elapsed * 3 + mesh.id) * 0.1);
  const flagella = mesh.userData.flagella as Group | undefined;
  if (flagella) flagella.rotation.y = Math.sin(elapsed * 1.8 + mesh.id) * 0.3;
}

// ---- spore: an incoming interceptable ---------------------------------------------

export function createSporeMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const coreMaterial = glow(hdr(VIOLET_HOT, 1.3));
  const core = new Mesh(new IcosahedronGeometry(0.22, 0), coreMaterial);
  parts.push(part(coreMaterial, 'core'));

  const spikeMaterial = basic(VIOLET_DARK.clone());
  for (let i = 0; i < 6; i += 1) {
    const spike = new Mesh(new ConeGeometry(0.06, 0.42, 4), spikeMaterial);
    const phi = Math.acos(1 - 2 * (i + 0.5) / 6);
    const theta = i * 2.4;
    spike.position.setFromSphericalCoords(0.28, phi, theta);
    spike.lookAt(spike.position.clone().multiplyScalar(2));
    group.add(spike);
  }
  parts.push(part(spikeMaterial, 'edge'));

  group.add(core);
  group.userData.parts = parts;
  group.userData.isHostileShot = true;
  group.userData.trailColor = VIOLET_HOT.clone().multiplyScalar(0.5);
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

// ---- broodling: a swarm pod of the parent's brood ---------------------------------

export function createBroodlingMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const podMaterial = basic(VIOLET.clone());
  const pod = new Mesh(new TetrahedronGeometry(0.5, 0), podMaterial);
  parts.push(part(podMaterial, 'fill'));

  const tipMaterial = glow(hdr(VIOLET_PALE, 1.5));
  const tip = new Mesh(new SphereGeometry(0.11, 6, 5), tipMaterial);
  tip.position.y = 0.4;
  parts.push(part(tipMaterial, 'core'));

  const flagellumMaterial = basic(VIOLET_DARK.clone());
  const flagellum = new Mesh(new CylinderGeometry(0.03, 0.008, 0.9, 4), flagellumMaterial);
  flagellum.position.y = -0.6;
  parts.push(part(flagellumMaterial, 'edge'));

  group.add(pod, tip, flagellum);
  group.userData.parts = parts;
  group.userData.flagellum = flagellum;
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

export function animateBroodling(mesh: Object3D, _dt: number, elapsed: number) {
  const flagellum = mesh.userData.flagellum as Mesh | undefined;
  if (flagellum) {
    flagellum.rotation.x = Math.sin(elapsed * 11 + mesh.id * 1.3) * 0.5;
    flagellum.rotation.z = Math.cos(elapsed * 9 + mesh.id) * 0.4;
  }
  const pulse = (mesh.userData.pulse as number | undefined) ?? 0.5;
  mesh.scale.setScalar((mesh.userData.baseScale as number | undefined ?? 1) * (1 + pulse * 0.12));
}
