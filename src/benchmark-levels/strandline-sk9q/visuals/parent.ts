import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { VIOLET, VIOLET_DARK, VIOLET_HOT, VIOLET_PALE, hdr } from './palette';
import type { TintPart } from './enemies';

// THE PARENT — the source of the infestation, dug in at the crown where the
// strands root into the bell. A great violet sac veined with light, crowned by
// rooting tendrils, three translucent brood sacs pulsing beneath it. It hides
// behind three fans of its own webbing; each brood that dies takes its fan
// down with it. Leaf construction: the spine owns when panels die and sacs
// deflate.

function part(material: MeshBasicMaterial, kind: TintPart['kind']): TintPart {
  return { material, base: material.color.clone(), kind };
}

export type ParentRig = {
  group: Group;
  parts: TintPart[];
  sacs: Mesh[];
  maw: Mesh;
  mawMaterial: MeshBasicMaterial;
  veinMaterial: MeshBasicMaterial;
  tendrils: Group;
  stageRings: Mesh[];
};

export function createParentMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  // Core sac: a lumpy violet body.
  const sacMaterial = new MeshBasicMaterial({ color: VIOLET_DARK.clone().multiplyScalar(1.5) });
  const sac = new Mesh(new IcosahedronGeometry(3.1, 1), sacMaterial);
  group.add(sac);
  parts.push(part(sacMaterial, 'fill'));

  // Vein light: a hot wireframe skin just off the surface.
  const veinMaterial = new MeshBasicMaterial({
    color: hdr(VIOLET_HOT, 0.8),
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const veins = new Mesh(new IcosahedronGeometry(3.24, 1), veinMaterial);
  group.add(veins);
  parts.push(part(veinMaterial, 'edge'));

  // The maw-eye at the front: hot and brightening as stages tear.
  const mawMaterial = new MeshBasicMaterial({ color: hdr(VIOLET_PALE, 1.35) });
  const maw = new Mesh(new SphereGeometry(0.85, 12, 10), mawMaterial);
  maw.position.set(0, 0.2, 2.6);
  group.add(maw);
  parts.push(part(mawMaterial, 'core'));

  // Rooting tendrils: thick cones splayed up into the crown.
  const tendrils = new Group();
  const tendrilMaterial = new MeshBasicMaterial({ color: VIOLET.clone().multiplyScalar(0.55) });
  for (let i = 0; i < 7; i += 1) {
    const tendril = new Mesh(new ConeGeometry(0.55, 6.5, 6), tendrilMaterial);
    const angle = (i / 7) * Math.PI * 2;
    tendril.position.set(Math.cos(angle) * 2.4, 3.6, Math.sin(angle) * 2.4);
    tendril.rotation.z = -Math.cos(angle) * 0.55;
    tendril.rotation.x = Math.sin(angle) * 0.55;
    tendrils.add(tendril);
  }
  group.add(tendrils);
  parts.push(part(tendrilMaterial, 'edge'));

  // Three translucent brood sacs beneath the body — one per brood.
  const sacs: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const sacI = new Mesh(
      new SphereGeometry(1.15, 10, 8),
      new MeshBasicMaterial({
        color: hdr(VIOLET_HOT, 0.9),
        transparent: true,
        opacity: 0.6,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    sacI.position.set(Math.cos(angle) * 1.9, -2.6, Math.sin(angle) * 1.9);
    group.add(sacI);
    sacs.push(sacI);
  }

  // Stage rings: clean gold circles revealed around the sac as it is torn.
  const stageRings: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const ring = new Mesh(
      new TorusGeometry(3.6 + i * 0.35, 0.05, 6, 48),
      new MeshBasicMaterial({ color: hdr(new Color(1.0, 0.82, 0.42), 1.6), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2 + i * 0.35;
    group.add(ring);
    stageRings.push(ring);
  }

  group.userData.parts = parts;
  group.userData.parentRig = { group, parts, sacs, maw, mawMaterial, veinMaterial, tendrils, stageRings } satisfies ParentRig;
  group.userData.accent = VIOLET_HOT.clone();
  return group;
}

export function animateParent(mesh: Object3D, _dt: number, elapsed: number) {
  const rig = mesh.userData.parentRig as ParentRig | undefined;
  if (!rig) return;
  const pulse = (mesh.userData.pulse as number | undefined) ?? 0.5;
  const stageIndex = (mesh.userData.stageIndex as number | undefined) ?? 0;
  const bare = mesh.userData.bare === true;

  // The sac breathes; the maw flares when bare. PARENT_SCALE gives the boss
  // real presence at its working distance; baseScale is the spawn grow-in.
  rig.group.scale.setScalar((mesh.userData.baseScale as number | undefined ?? 1) * 1.35 * (1 + pulse * 0.04));
  rig.mawMaterial.color.setRGB(0.75 + pulse * 0.25, 0.55 + pulse * 0.2, 0.9);
  rig.maw.scale.setScalar(1 + pulse * 0.18 + (bare ? 0.25 : 0));
  rig.veinMaterial.opacity = 0.28 + pulse * 0.18 + stageIndex * 0.07;

  // Brood sacs pulse out of phase; deflated ones hang slack.
  rig.sacs.forEach((sac, index) => {
    if (sac.userData.deflated === true) return;
    sac.scale.setScalar(1 + Math.sin(elapsed * 2.4 + index * 2.1) * 0.14);
  });

  // Stage rings shine where it has been torn.
  rig.stageRings.forEach((ring, index) => {
    const material = ring.material as MeshBasicMaterial;
    const target = stageIndex > index ? 0.9 : 0;
    material.opacity += (target - material.opacity) * 0.08;
    ring.rotation.z += 0.003 + index * 0.001;
  });

  rig.tendrils.rotation.y = Math.sin(elapsed * 0.6) * 0.05;
}

// Deflate brood sac i (its brood is dead).
export function deflateParentSac(mesh: Object3D, index: number) {
  const rig = mesh.userData.parentRig as ParentRig | undefined;
  const sac = rig?.sacs[index];
  if (!sac) return;
  sac.userData.deflated = true;
  sac.scale.setScalar(0.32);
  (sac.material as MeshBasicMaterial).opacity = 0.15;
}

// ---- the webbing lattice ----------------------------------------------------

export type WebPanel = {
  group: Group;
  membranes: MeshBasicMaterial[];
  dying: boolean;
  dieT: number;
};

// Three fans of webbing anchored around the parent, between it and the
// oncoming player. Each is a membrane arc with sinew spokes; when its brood
// dies the fan shrivels and drifts apart.
export function createWebbing(): { root: Group; panels: WebPanel[] } {
  const root = new Group();
  const panels: WebPanel[] = [];

  for (let i = 0; i < 3; i += 1) {
    const panel = new Group();
    const membranes: MeshBasicMaterial[] = [];
    const span = Math.PI * 0.5;
    const baseAngle = -span / 2 + (i / 3) * Math.PI * 2 + 0.35;

    for (let s = 0; s < 5; s += 1) {
      const t = s / 4;
      const angle = baseAngle + (t - 0.5) * span;
      const material = new MeshBasicMaterial({
        color: hdr(VIOLET_HOT, 0.75),
        transparent: true,
        opacity: 0.3,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
        fog: false,
      });
      const membrane = new Mesh(new PlaneGeometry(2.6, 3.6), material);
      membrane.position.set(Math.cos(angle) * 6.5, Math.sin(angle) * 4.2, 4.5 - t * 0.6);
      membrane.rotation.z = angle + Math.PI / 2;
      membrane.rotation.y = (t - 0.5) * 0.4;
      panel.add(membrane);
      membranes.push(material);

      // A sinew spoke from the parent to the membrane edge.
      const sinewMaterial = new MeshBasicMaterial({
        color: hdr(VIOLET, 0.9),
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const sinew = new Mesh(new PlaneGeometry(0.08, 6.2), sinewMaterial);
      sinew.position.set(Math.cos(angle) * 3.4, Math.sin(angle) * 2.2, 4.6 - t * 0.5);
      sinew.rotation.z = angle + Math.PI / 2 + 0.28;
      panel.add(sinew);
      membranes.push(sinewMaterial);
    }

    root.add(panel);
    panels.push({ group: panel, membranes, dying: false, dieT: 0 });
  }

  return { root, panels };
}

// Shrivel a dying panel; call each frame. Returns false when fully dead.
export function updateWebPanel(panel: WebPanel, dt: number, elapsed: number) {
  if (!panel.dying) {
    panel.group.rotation.z = Math.sin(elapsed * 0.5 + panel.group.id) * 0.03;
    return true;
  }
  panel.dieT += dt;
  const t = Math.min(1, panel.dieT / 1.1);
  const eased = 1 - (1 - t) ** 2;
  panel.group.scale.set(1 - eased * 0.7, Math.max(0.02, 1 - eased), 1);
  panel.group.position.y -= dt * 2.2 * (1 - t);
  panel.group.rotation.z += dt * 0.35 * (1 - t);
  for (const material of panel.membranes) material.opacity = (1 - eased) * 0.32;
  return t < 1;
}
