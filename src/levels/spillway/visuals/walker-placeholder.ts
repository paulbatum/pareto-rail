import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import type { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { WalkerPose } from '../rail';
import { WALKER_BELLY, WALKER_BODY_LENGTH } from '../rail';

// PLACEHOLDER: a box-built stand-in for the salvage walker, at the real scale
// and on the real track, so the camera framing can be judged before the boss
// is built. The walker phase replaces this file.

export type WalkerPlaceholder = {
  group: Group;
  /** Feet that touched down this frame, for splashes. */
  landed: Vector3[];
  update(pose: WalkerPose): void;
};

const HIP_SPREAD = 8;
const FOOT_SPREAD = 17;
const KNEE_HEIGHT = WALKER_BELLY + 12;

export function createWalkerPlaceholder(paint: Color): WalkerPlaceholder {
  const group = new Group();
  group.name = 'walker-placeholder';
  const material = new MeshStandardNodeMaterial({ color: paint, roughness: 0.6, metalness: 0.2 });
  const unit = new BoxGeometry(1, 1, 1);
  const part = (w: number, h: number, d: number) => {
    const mesh = new Mesh(unit, material);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    return mesh;
  };
  const body = part(14, 10, WALKER_BODY_LENGTH);
  body.position.y = WALKER_BELLY + 5;
  const cab = part(8, 6, 8);
  cab.position.set(0, WALKER_BELLY + 13, -WALKER_BODY_LENGTH / 2 + 5);
  const boom = part(2, 2, 26);
  boom.position.set(0, WALKER_BELLY + 16, -WALKER_BODY_LENGTH / 2 - 8);
  boom.rotation.x = -0.35;
  group.add(body, cab, boom);

  const legs = [-1, 1].flatMap((side) => [-1, 1].map((end) => {
    const thigh = part(2.4, 2.4, 1);
    const shin = part(2, 2, 1);
    const foot = part(6, 1.5, 7);
    group.add(thigh, shin, foot);
    return {
      side,
      end,
      phase: (side * end > 0 ? 0 : 0.5) + (end > 0 ? 0.25 : 0),
      thigh,
      shin,
      foot,
      down: true,
    };
  }));

  const hip = new Vector3();
  const knee = new Vector3();
  const foot = new Vector3();
  const world = new Vector3();
  const landed: Vector3[] = [];
  const place = (mesh: Mesh, from: Vector3, to: Vector3) => {
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.z = from.distanceTo(to);
    mesh.lookAt(world.copy(to).applyMatrix4(group.matrixWorld));
  };

  return {
    group,
    landed,
    update(pose) {
      landed.length = 0;
      group.position.copy(pose.position);
      group.rotation.set(0, -pose.heading, 0);
      group.updateMatrixWorld();
      const stepping = pose.state === 'wading' && pose.speed > 1;
      for (const leg of legs) {
        const cycle = (pose.gaitPhase + leg.phase) % 1;
        const swing = stepping ? Math.max(0, Math.sin(cycle * Math.PI * 2)) : 0;
        const stride = stepping ? Math.cos(cycle * Math.PI * 2) * 9 : 0;
        hip.set(leg.side * HIP_SPREAD, WALKER_BELLY + 2, leg.end * (WALKER_BODY_LENGTH / 2 - 4));
        foot.set(leg.side * FOOT_SPREAD, swing * 7, leg.end * (WALKER_BODY_LENGTH / 2 + 2) - stride);
        knee.set(leg.side * (FOOT_SPREAD + 3), KNEE_HEIGHT, (hip.z + foot.z) / 2 + leg.end * 4);
        place(leg.thigh, hip, knee);
        place(leg.shin, knee, foot);
        leg.foot.position.copy(foot);
        const down = swing < 0.05;
        if (down && !leg.down) landed.push(foot.clone().applyMatrix4(group.matrixWorld));
        leg.down = down;
      }
      body.position.y = WALKER_BELLY + 5 + (stepping ? Math.sin(pose.gaitPhase * Math.PI * 4) * 0.6 : 0);
    },
  };
}
