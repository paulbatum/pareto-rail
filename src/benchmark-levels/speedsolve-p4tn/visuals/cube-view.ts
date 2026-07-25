import {
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import {
  CAP_SIZE,
  CAP_THICKNESS,
  CUBIE_SIZE,
  FACE_BASES,
  type SolveCube,
} from '../cube';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { GRAPHITE, HOT_WHITE, MACHINE_DARK, MACHINE_GREY, MACHINE_WHITE, solveColor } from './palette';

// Leaf file: geometry and per-frame mirroring for the cube. All decisions about
// which square is wrong, when a layer turns and when a face falls away live in
// gameplay and `cube.ts`; this only draws whatever state they hold.

/** How long a cap takes to flip when its colour changes. */
const FLIP_SECONDS = 0.3;
/** Candy stickers carry a little emissive so they stay saturated in shadow. */
const CAP_EMISSIVE = 0.16;
/** Riffle stagger across the nine squares of an incoming face. */
const FLIP_STAGGER = 0.105;

export type CubeView = {
  root: Group;
  update(dt: number): void;
  /** Caps that went away since the last frame, so the spine can throw fragments. */
  drainFallenCaps(): Array<{ position: Vector3; color: number }>;
  dispose(): void;
};

export function createCubeView(cube: SolveCube): CubeView {
  const root = new Group();
  const cubieGeometry = new BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
  const cubieEdges = new EdgesGeometry(cubieGeometry);
  const capGeometry = new BoxGeometry(CAP_SIZE, CAP_SIZE, CAP_THICKNESS);
  const bodyMaterial = new MeshLambertMaterial({
    color: MACHINE_WHITE,
    emissive: MACHINE_GREY.clone().multiplyScalar(0.10),
    flatShading: true,
  });
  const edgeMaterial = new LineBasicMaterial({ color: MACHINE_DARK });
  const ventMaterial = new MeshLambertMaterial({
    color: MACHINE_DARK,
    emissive: GRAPHITE,
    flatShading: true,
  });

  // 26 machined bodies. Each carries its own edge lines so definition survives the
  // pale void with bloom at zero.
  const cubieGroups = cube.cubies.map(() => {
    const group = new Group();
    const body = new Mesh(cubieGeometry, bodyMaterial);
    body.name = 'cubie';
    group.add(body, new LineSegments(cubieEdges, edgeMaterial));
    root.add(group);
    return group;
  });

  // Six recessed vents: once a face's caps blow off, its centre shows the socket
  // the weakpoint rises out of.
  for (const basis of FACE_BASES) {
    const vent = new Mesh(new CylinderGeometry(1.5, 1.7, 0.5, 6), ventMaterial);
    vent.name = 'vent';
    const grid = basis.out.clone();
    const cubieIndex = cube.cubies.findIndex((cubie) => cubie.grid.equals(grid));
    if (cubieIndex < 0) continue;
    vent.position.copy(basis.out).multiplyScalar(CUBIE_SIZE / 2 + 0.1);
    vent.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), basis.out);
    cubieGroups[cubieIndex].add(vent);
  }

  // The machinery you glimpse through the gaps and, at the end, all that is left.
  const hub = new Group();
  const armature = new Mesh(
    new IcosahedronGeometry(4.2, 0),
    new MeshLambertMaterial({ color: MACHINE_GREY, emissive: GRAPHITE, flatShading: true }),
  );
  armature.name = 'armature';
  hub.add(armature);
  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    const spindle = new Mesh(
      new CylinderGeometry(0.5, 0.5, 16, 8),
      new MeshLambertMaterial({ color: MACHINE_WHITE, emissive: MACHINE_DARK, flatShading: true }),
    );
    spindle.name = 'spindle';
    spindle.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis);
    hub.add(spindle);
  }
  const hubGlow = new Mesh(new TorusGeometry(5.6, 0.16, 6, 40), createAdditiveBasicMaterial({
    color: HOT_WHITE.clone().multiplyScalar(1.8),
    opacity: 0.8,
  }));
  hub.add(hubGlow);
  root.add(hub);

  const capMaterials = cube.caps.map((cap) => new MeshLambertMaterial({
    color: solveColor(cap.color),
    emissive: solveColor(cap.color).clone().multiplyScalar(CAP_EMISSIVE),
    flatShading: true,
  }));
  const capMeshes = cube.caps.map((_cap, index) => {
    const mesh = new Mesh(capGeometry, capMaterials[index]);
    mesh.name = 'cap';
    root.add(mesh);
    return mesh;
  });
  const capColorShown = cube.caps.map((cap) => cap.color);
  const capWasVisible = cube.caps.map(() => true);
  const fallen: Array<{ position: Vector3; color: number }> = [];

  return {
    root,

    update(_dt: number) {
      root.position.copy(cube.center);
      root.quaternion.copy(cube.rootQuat);

      for (let index = 0; index < cubieGroups.length; index += 1) {
        const state = cube.cubies[index];
        cubieGroups[index].position.copy(state.position);
        cubieGroups[index].quaternion.copy(state.orientation);
      }

      // The armature is what you glimpse through the seams of the closed cube. It
      // collapses as the shell blooms open, because the exposed core takes its
      // place at the centre — and because nothing may stand in front of the core.
      const collapse = Math.max(0, 1 - cube.bloom / 0.5);
      hub.visible = collapse > 0.02;
      hub.scale.setScalar(0.62 * collapse);
      hub.rotation.y = cube.time * 0.7;
      hub.rotation.x = cube.time * 0.31;
      hubGlow.rotation.x = Math.PI / 2;

      for (let index = 0; index < capMeshes.length; index += 1) {
        const cap = cube.caps[index];
        const mesh = capMeshes[index];
        if (!cap.visible) {
          if (capWasVisible[index]) {
            capWasVisible[index] = false;
            fallen.push({ position: cube.capWorld(index, new Vector3()), color: capColorShown[index] });
          }
          mesh.visible = false;
          continue;
        }
        capWasVisible[index] = true;
        mesh.visible = true;
        mesh.position.copy(cap.position);
        mesh.quaternion.copy(cap.orientation);

        // A square changing colour physically flips: the riffle that scrambles an
        // incoming face and the snap-to-solved of a destroyed square are the same
        // animation, staggered across the nine slots of the face.
        const delay = (index % 9) * FLIP_STAGGER;
        const flip = (cube.time - cap.changedAt - delay) / FLIP_SECONDS;
        if (flip < 0) {
          mesh.scale.setScalar(1);
          continue;
        }
        if (flip < 1) {
          mesh.rotateX(Math.PI * (1 - flip));
          mesh.scale.set(1, Math.abs(Math.cos(Math.PI * flip)) * 0.35 + 0.75, 1);
          if (capColorShown[index] !== cap.color && flip > 0.5) applyCapColor(index, cap.color);
          continue;
        }
        if (capColorShown[index] !== cap.color) applyCapColor(index, cap.color);
        mesh.scale.setScalar(1);
      }
    },

    drainFallenCaps() {
      const drained = fallen.splice(0, fallen.length);
      return drained;
    },

    dispose() {
      root.removeFromParent();
      cubieGeometry.dispose();
      cubieEdges.dispose();
      capGeometry.dispose();
      bodyMaterial.dispose();
      edgeMaterial.dispose();
      ventMaterial.dispose();
      for (const material of capMaterials) material.dispose();
    },
  };

  function applyCapColor(index: number, color: number) {
    capColorShown[index] = color;
    const material = capMaterials[index];
    material.color.copy(solveColor(color));
    material.emissive.copy(solveColor(color)).multiplyScalar(CAP_EMISSIVE);
  }
}

/** Solid plastic look shared by every polyhedron in the level. */
export function candyMaterial(colorIndex: number, emissiveScale = 0.18) {
  const color = solveColor(colorIndex);
  return new MeshLambertMaterial({
    color,
    emissive: color.clone().multiplyScalar(emissiveScale),
    flatShading: true,
  });
}

export function machineMaterial(emissiveScale = 0.12) {
  return new MeshLambertMaterial({
    color: MACHINE_WHITE,
    emissive: MACHINE_GREY.clone().multiplyScalar(emissiveScale),
    flatShading: true,
  });
}

export function graphiteMaterial() {
  return new MeshLambertMaterial({ color: GRAPHITE, emissive: MACHINE_DARK.clone().multiplyScalar(0.25), flatShading: true });
}

export function hotMaterial(intensity = 1.6) {
  return new MeshBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(intensity) });
}
