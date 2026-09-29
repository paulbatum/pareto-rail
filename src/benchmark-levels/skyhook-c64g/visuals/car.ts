import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { CAR_ANCHORS, VIEW_TAN_V, tanHalfFov } from '../space';
import { MergeBuilder, addMerged } from './merge';
import { ALARM_RED, CHARCOAL, HAZARD, PANEL_SHADE, PANEL_WHITE, hdr } from './palette';

// The climber car: the frame you are looking out of. Built in camera space, so
// it is glued to the view — a low deck along the bottom edge, two side struts,
// and four mounting plates where limpets clamp on. Hostiles that go for the car
// go for *these* points (see CAR_ANCHORS), so you can always see what they are
// attacking. Damage shows up here: warning lamps and sparks; a side under attack
// strobes hazard orange.

const ASPECT_DESIGN = 16 / 9;

/** Camera-space position of a screen point at a given depth (designed for 16:9). */
function cs(nx: number, ny: number, depth: number): [number, number, number] {
  return [depth * VIEW_TAN_V * ASPECT_DESIGN * nx, depth * VIEW_TAN_V * ny, -depth];
}

export type CarFrame = {
  group: Group;
  /** `threat`: how hard the left / right side of the car is being attacked, 0..1. */
  update(camera: PerspectiveCamera, beat: number, hull: number, hullMax: number, hurt: number, time: number, threat: [number, number]): void;
};

export function createCarFrame(): CarFrame {
  const group = new Group();
  const builder = new MergeBuilder();

  // deck ---------------------------------------------------------------------------
  builder.add(new BoxGeometry(40, 0.5, 1.6), 'paint', { position: [0, -3.5, -5.8] });
  builder.add(new BoxGeometry(40, 0.55, 0.32), 'shade', { position: [0, -3.18, -6.5] });
  // hazard chevrons along the far lip
  for (let i = -8; i <= 8; i += 1) {
    builder.add(new BoxGeometry(1.15, 0.5, 0.12), i % 2 === 0 ? 'hazard' : 'dark', { position: [i * 2.35, -3.16, -6.36] });
  }

  // struts, stanchions and mounting plates ---------------------------------------------------
  const lamps: Mesh[] = [];
  const lampGeometry = new BoxGeometry(0.3, 0.6, 0.2);
  for (const side of [-1, 1]) {
    const [sx, , sz] = cs(0.905 * side, 0, 10);
    builder.add(new BoxGeometry(0.22, 16, 0.22), 'shade', { position: [sx, 0.5, sz] });
    for (let k = -2; k <= 2; k += 1) {
      builder.add(new BoxGeometry(0.3, 0.6, 0.3), k % 2 === 0 ? 'hazard' : 'dark', { position: [sx, 0.5 + k * 3.4, sz + 0.02] });
    }
    const lamp = new Mesh(lampGeometry, new MeshBasicMaterial({ color: 0xffffff }));
    lamp.position.set(sx - side * 0.3, 5.4, sz + 0.2);
    lamps.push(lamp);
    // Stanchion from the deck up to the deck pad limpets clamp onto.
    const pad = CAR_ANCHORS[side < 0 ? 0 : 1];
    const [px, py, pz] = cs(pad.nx, pad.ny, pad.depth);
    const stalk = py + 3.4;
    builder.add(new BoxGeometry(0.3, Math.max(0.5, stalk), 0.3), 'shade', { position: [px, -3.4 + stalk / 2, pz - 0.3] });
    // A short brace out to the strut.
    builder.add(new BoxGeometry(0.2, 0.2, 0.2), 'shade', { position: [px, py, pz - 0.3] });
  }
  CAR_ANCHORS.forEach((anchor) => {
    const [x, y, z] = cs(anchor.nx, anchor.ny, anchor.depth);
    builder.add(new CylinderGeometry(0.6, 0.6, 0.22, 6), 'shade', { position: [x, y, z - 0.4], rotation: [Math.PI / 2, 0, 0] });
    for (let b = 0; b < 4; b += 1) {
      const angle = (b / 4) * Math.PI * 2 + Math.PI / 4;
      builder.add(new BoxGeometry(0.16, 0.16, 0.1), 'hazard', { position: [x + Math.cos(angle) * 0.4, y + Math.sin(angle) * 0.4, z - 0.2] });
    }
  });

  addMerged(group, builder, {
    paint: new MeshLambertMaterial({ color: PANEL_WHITE, emissive: new Color(0.06, 0.06, 0.065) }),
    shade: new MeshLambertMaterial({ color: PANEL_SHADE.clone().lerp(PANEL_WHITE, 0.35), emissive: new Color(0.05, 0.05, 0.055) }),
    hazard: new MeshBasicMaterial({ color: HAZARD.clone().multiplyScalar(0.9) }),
    dark: new MeshBasicMaterial({ color: CHARCOAL.clone().multiplyScalar(2.2) }),
  }, { ignoreOcclusion: true });
  for (const lamp of lamps) {
    lamp.userData.raildIgnoreOcclusion = true;
    lamp.frustumCulled = false;
    group.add(lamp);
  }

  // deck warning lamps: hull state ------------------------------------------------------------
  const hullLamps: Mesh[] = [];
  const hullLampGeometry = new BoxGeometry(0.42, 0.1, 0.3);
  for (let i = 0; i < 7; i += 1) {
    const lamp = new Mesh(hullLampGeometry, new MeshBasicMaterial({ color: 0xffffff }));
    lamp.position.set((i - 3) * 1.0, -3.24, -5.5);
    lamp.userData.raildIgnoreOcclusion = true;
    lamp.frustumCulled = false;
    group.add(lamp);
    hullLamps.push(lamp);
  }

  const ok = new Color(1.1, 1.15, 1.2);
  const warn = HAZARD.clone().multiplyScalar(1.6);
  const bad = ALARM_RED.clone().multiplyScalar(1.7);

  return {
    group,
    update(camera, beat, hull, hullMax, hurt, time, threat) {
      group.position.copy(camera.position);
      group.quaternion.copy(camera.quaternion);
      // Glued to the screen: FOV kicks and breathing must not move the struts.
      const fit = tanHalfFov(camera.fov) / VIEW_TAN_V;
      group.scale.set((camera.aspect / ASPECT_DESIGN) * fit, fit, 1);

      const integrity = hullMax > 0 ? hull / hullMax : 1;
      const state = integrity > 0.6 ? ok : integrity > 0.3 ? warn : bad;
      const flutter = integrity > 0.6 ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(time * (integrity > 0.3 ? 5 : 11)));
      hullLamps.forEach((lamp, index) => {
        const lit = index < Math.ceil(integrity * hullLamps.length);
        (lamp.material as MeshBasicMaterial).color
          .copy(lit ? state : CHARCOAL)
          .multiplyScalar(lit ? flutter * (0.75 + beat * 0.35) + hurt * 1.4 : 1);
      });
      lamps.forEach((lamp, index) => {
        const attack = threat[index];
        const color = (lamp.material as MeshBasicMaterial).color;
        if (attack > 0.02) {
          // This side of the car is under attack: strobe hazard orange, faster as it gets worse.
          const strobe = Math.sin(time * (7 + attack * 20)) > -0.2 ? 1 : 0.12;
          color.copy(HAZARD).multiplyScalar((0.5 + attack * 2.8) * strobe);
        } else {
          color.copy(hdr(state, 0.55 + beat * 0.7));
        }
      });
    },
  };
}
