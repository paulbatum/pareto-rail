import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { PartBin, glowMesh, solidMesh } from './build';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { AMBER, CHROME, GANG_RED, NIGHT, STEEL, hdr } from './palette';

/**
 * You are hanging out of the passenger window, so the car is *behind and to
 * your left*: the window sill under your ribs, the roof rail over your
 * shoulder, the A-pillar, and the wing mirror out on its stalk. All of it lives
 * in the lower-left third of the frame, clear of the lanes ahead, and all of it
 * is flagged `raildIgnoreOcclusion` — it is the player's own vehicle, not
 * cover.
 *
 * The rig follows the camera with a deliberate lag so the car leans a beat
 * after you do. That lag *is* the lean-out feel; without it the bodywork is
 * painted onto the lens.
 */

const HALF_PI = Math.PI / 2;

/** The mirror glass: written every frame with whatever light is behind you. */
export const mirrorGlassMaterial = createAdditiveBasicMaterial({ color: hdr(AMBER, 0.5) });
/** Chrome trim catches the streetlight cadence as you pass under each lamp. */
export const trimMaterial = createAdditiveBasicMaterial({ color: hdr(CHROME, 0.5) });

export type Cockpit = {
  root: Group;
  update(camera: Camera, dt: number, sway: number, glint: number, mirrorLight: number): void;
  dispose(): void;
};

export function createCockpit(): Cockpit {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  root.renderOrder = 5;

  const shell = new PartBin();
  // Window sill and the door skin dropping away below it.
  // Everything structural is nearly black: at night an unlit body panel is a
  // silhouette, and a bright one reads as a HUD overlay pasted on the lens.
  shell.add(new BoxGeometry(0.34, 0.14, 4.4), hdr(STEEL, 0.075), { at: [-0.78, -0.54, 0.5] });
  shell.add(new BoxGeometry(0.3, 1.6, 4.4), hdr(GANG_RED, 0.012), { at: [-0.82, -1.36, 0.5] });
  // Roof rail over the shoulder, and the pillar tying it to the sill.
  shell.add(new BoxGeometry(0.26, 0.13, 3.4), hdr(STEEL, 0.06), { at: [-1.16, 0.72, 0.7] });
  shell.add(new BoxGeometry(0.12, 1.35, 0.22), hdr(STEEL, 0.08), { at: [-1.14, 0.1, -1.6], rotate: [0, 0, 0.09] });
  // Mirror stalk.
  shell.add(new CylinderGeometry(0.04, 0.05, 0.5, 5), hdr(STEEL, 0.07), {
    at: [-0.98, -0.5, -1.8],
    rotate: [0, 0, -0.5],
  });
  shell.add(new BoxGeometry(0.38, 0.28, 0.14), hdr(STEEL, 0.08), { at: [-1.12, -0.54, -2.0] });
  shell.add(new BoxGeometry(0.42, 0.32, 0.05), NIGHT, { at: [-1.12, -0.54, -1.94] });
  const body = solidMesh(shell.merge());

  const trim = new PartBin();
  // Chrome beading. These are additive and sit a metre from the lens, so they
  // have to stay *lines*: any width here becomes the brightest slab on screen.
  trim.add(new BoxGeometry(0.04, 0.02, 4.4), hdr(CHROME, 0.8), { at: [-0.62, -0.47, 0.5] });
  trim.add(new BoxGeometry(0.04, 0.02, 4.4), hdr(CHROME, 0.45), { at: [-0.94, -0.47, 0.5] });
  trim.add(new BoxGeometry(0.045, 0.022, 3.4), hdr(CHROME, 0.7), { at: [-1.04, 0.66, 0.7] });
  trim.add(new BoxGeometry(0.34, 0.022, 0.02), hdr(CHROME, 0.5), { at: [-1.12, -0.69, -2.0] });
  const chrome = new Mesh(trim.merge(), trimMaterial);

  const glass = new Mesh(new PlaneGeometry(0.33, 0.23), mirrorGlassMaterial);
  glass.position.set(-1.12, -0.54, -2.07);
  glass.rotation.y = Math.PI + 0.18;

  // A hint of the dashboard's amber wash leaking out over the sill.
  const wash = new PartBin();
  wash.add(new PlaneGeometry(0.2, 1.6), hdr(AMBER, 0.05), { at: [-0.78, -0.49, 0.9], rotate: [-HALF_PI, 0, 0] });
  const dash = glowMesh(wash.merge());

  root.add(body, chrome, glass, dash);
  for (const child of root.children) child.userData.raildIgnoreOcclusion = true;

  const lagged = new Quaternion();
  const offset = new Vector3();
  let seeded = false;

  return {
    root,
    update(camera, dt, sway, glint, mirrorLight) {
      if (!seeded) {
        lagged.copy(camera.quaternion);
        seeded = true;
      }
      // Slerp toward the camera: the body follows your head, late.
      lagged.slerp(camera.quaternion, Math.min(1, dt * 13));
      root.quaternion.copy(lagged);
      // Lane changes push the bodywork across the frame before it settles.
      offset.set(sway * 0.16, -Math.abs(sway) * 0.05, 0).applyQuaternion(lagged);
      root.position.copy(camera.position).add(offset);
      root.rotateZ(sway * 0.055);

      trimMaterial.color.copy(hdr(CHROME, 0.09 + glint * 0.34));
      mirrorGlassMaterial.color.copy(hdr(AMBER, 0.16 + glint * 0.5)).lerp(hdr(CHROME, 2.4), mirrorLight);
    },
    dispose() {
      root.removeFromParent();
    },
  };
}
