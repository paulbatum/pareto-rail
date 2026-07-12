import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Scene } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { createHullRunCvs3Rail } from '../gameplay';
import { ALERT_RED, AMBER, EDGE, GUNMETAL, hdr, mulberry32, PLATE, VOID } from './palette';

type WakeLight = { mesh: Mesh; u: number; material: MeshBasicMaterial; red: boolean };
export type HullEnvironment = { root: Group; wakeLights: WakeLight[]; masts: Group[]; deckEnd: number };

export function createHullEnvironment(scene: Scene): HullEnvironment {
  scene.background = VOID.clone();
  const root = new Group(); const curve = createHullRunCvs3Rail(); const rng = mulberry32(0xc053);
  const wakeLights: WakeLight[] = []; const masts: Group[] = [];
  const deckMaterial = new MeshBasicMaterial({ color: GUNMETAL });
  const panelMaterial = new MeshBasicMaterial({ color: PLATE });
  for (let i = 0; i < 118; i += 1) {
    const u = i / 124; const frame = sampleRailFrame(curve, u); const segment = new Group();
    segment.position.copy(frame.position).addScaledVector(frame.up, -8.2); segment.lookAt(segment.position.clone().add(frame.tangent));
    const deck = new Mesh(new BoxGeometry(54, 1.6, 18), deckMaterial); segment.add(deck);
    for (const side of [-1, 1]) { const panel = new Mesh(new BoxGeometry(23.5, 0.18, 15.5), panelMaterial); panel.position.set(side * 13.6, 0.9, 0); panel.rotation.y = (rng() - 0.5) * 0.015; segment.add(panel); }
    if (i % 5 === 0) { const ridge = new Mesh(new BoxGeometry(50, 1.4, 0.9), new MeshBasicMaterial({ color: EDGE })); ridge.position.y = 1.6; segment.add(ridge); }
    if (i % 4 === 2) {
      const side = i % 8 === 2 ? -1 : 1;
      const hatch = new Mesh(new BoxGeometry(5.8, 0.3, 5.2), new MeshBasicMaterial({ color: 0x0a0f13 })); hatch.position.set(side * (7 + rng() * 7), 1.12, 0); segment.add(hatch);
      const seam = new Mesh(new BoxGeometry(0.13, 0.08, 4.4), new MeshBasicMaterial({ color: i > 62 ? ALERT_RED : EDGE })); seam.position.set(hatch.position.x, 1.33, 0); segment.add(seam);
    }
    if (i % 3 === 0) for (const side of [-1, 1]) {
      const red = i > 64; const material = new MeshBasicMaterial({ color: hdr(red ? ALERT_RED : AMBER, 0.045) });
      const lamp = new Mesh(new BoxGeometry(0.22, 0.16, 3.8), material); lamp.position.set(side * 22, 1.15, 0); segment.add(lamp); wakeLights.push({ mesh: lamp, u, material, red });
    }
    root.add(segment);
  }
  // Eye-level antenna masts sit just outside the combat corridor and whip by.
  for (let i = 5; i < 112; i += 6) {
    const u = i / 124; const frame = sampleRailFrame(curve, u); const mast = new Group();
    mast.position.copy(frame.position).addScaledVector(frame.up, -7.3).addScaledVector(frame.right, (i % 12 === 5 ? -1 : 1) * (13 + rng() * 7));
    mast.lookAt(mast.position.clone().add(frame.tangent));
    const pole = new Mesh(new CylinderGeometry(0.18, 0.45, 12 + rng() * 7, 7), new MeshBasicMaterial({ color: PLATE })); pole.position.y = 6; mast.add(pole);
    const cross = new Mesh(new BoxGeometry(5 + rng() * 3, 0.22, 0.22), new MeshBasicMaterial({ color: EDGE })); cross.position.y = 11 + rng() * 4; mast.add(cross);
    root.add(mast); masts.push(mast);
  }
  // Bow silhouette: a dark wedge with the deck ending before the rail does.
  const bowFrame = sampleRailFrame(curve, 0.93); const bow = new Mesh(new BoxGeometry(52, 3.5, 125), deckMaterial);
  bow.position.copy(bowFrame.position).addScaledVector(bowFrame.up, -9); bow.lookAt(bow.position.clone().add(bowFrame.tangent)); root.add(bow);
  scene.add(root); return { root, wakeLights, masts, deckEnd: 0.955 };
}

export function updateHullEnvironment(environment: HullEnvironment, runProgress: number, time: number, running: boolean) {
  const front = running ? runProgress + 0.105 : (Math.sin(time * 0.16) * 0.5 + 0.5) * 0.35;
  for (const light of environment.wakeLights) {
    const wake = light.u < front ? 1 : 0.035;
    const pulse = light.red ? 0.7 + Math.max(0, Math.sin(time * 7.54)) * 0.7 : 0.78 + Math.sin(time * 3.77 + light.u * 20) * 0.2;
    light.material.color.copy(hdr(light.red ? ALERT_RED : AMBER, wake * pulse));
  }
}
