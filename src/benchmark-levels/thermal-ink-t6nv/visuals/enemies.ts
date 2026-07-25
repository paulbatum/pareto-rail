import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';

// 1. Scavenger Spawn Mesh (Scavenger drone made from flesh & harbor scrap)
export function createScavengerMesh(): Group {
  const group = new Group();

  const bodyMat = new MeshBasicMaterial({ color: new Color(0.2, 0.08, 0.06) });
  const bladeMat = new MeshBasicMaterial({ color: new Color(1.6, 0.7, 0.15) }); // Sodium orange rim

  // Jagged central core
  const coreGeo = new SphereGeometry(0.85, 8, 6);
  coreGeo.scale(1.2, 0.7, 1.0);
  const coreMesh = new Mesh(coreGeo, bodyMat);
  group.add(coreMesh);

  // Rusted sawblade / scrap jaws attached
  const bladeGeo = new TorusGeometry(1.1, 0.12, 6, 12);
  const bladeMesh = new Mesh(bladeGeo, bladeMat);
  bladeMesh.rotation.x = Math.PI / 3;
  group.add(bladeMesh);

  const spikeGeo = new BoxGeometry(0.15, 0.7, 0.15);
  for (let i = 0; i < 4; i += 1) {
    const spike = new Mesh(spikeGeo, bladeMat);
    const angle = (i * Math.PI) / 2;
    spike.position.set(Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0);
    spike.rotation.z = angle;
    group.add(spike);
  }

  group.userData.kind = 'scavenger';
  group.userData.materials = { bodyMat, bladeMat };
  return group;
}

// 2. Harbor Mine / Bio-Electric Cable Mine Mesh
export function createHarborMineMesh(): Group {
  const group = new Group();

  const steelMat = new MeshBasicMaterial({ color: new Color(0.12, 0.14, 0.16) });
  const lightMat = new MeshBasicMaterial({ color: new Color(2.5, 0.1, 0.1) }); // Warning red glow

  // Mine sphere
  const sphereGeo = new SphereGeometry(0.9, 10, 8);
  const sphereMesh = new Mesh(sphereGeo, steelMat);
  group.add(sphereMesh);

  // Warning light cap
  const capGeo = new SphereGeometry(0.35, 8, 8);
  const capMesh = new Mesh(capGeo, lightMat);
  capMesh.position.y = 0.85;
  group.add(capMesh);

  // Snapped cable dangling beneath
  const cableGeo = new CylinderGeometry(0.06, 0.06, 2.5, 6);
  const cableMesh = new Mesh(cableGeo, steelMat);
  cableMesh.position.y = -1.6;
  group.add(cableMesh);

  group.userData.kind = 'harbor_mine';
  group.userData.materials = { steelMat, lightMat };
  return group;
}

// 3. Projectile Mesh (Homing shot)
export function createThermalProjectileMesh(): Group {
  const group = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(2.8, 0.2, 0.1) }); // Blazing red signal pulse
  const geo = new SphereGeometry(0.25, 8, 6);
  const mesh = new Mesh(geo, mat);
  group.add(mesh);
  return group;
}

// 4. Reticle Mesh (Tactical thermal reticle)
// Lock radius in engine defaults is 0.085 NDC. Standard viewport reticle scale:
export function createThermalReticle(): Group {
  const group = new Group();

  const outerMat = new LineBasicMaterial({ color: new Color(1.8, 0.9, 0.2) }); // Sodium orange / Thermal white
  const innerMat = new MeshBasicMaterial({ color: new Color(2.2, 0.2, 0.1) });

  // Reticle outer ring
  const ringGeo = new RingGeometry(0.48, 0.54, 32);
  const ringMesh = new Mesh(ringGeo, innerMat);
  group.add(ringMesh);

  // Crosshair notches
  const notchGeo = new BoxGeometry(0.06, 0.25, 0.02);
  for (let i = 0; i < 4; i += 1) {
    const notch = new Mesh(notchGeo, innerMat);
    const angle = (i * Math.PI) / 2;
    notch.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, 0);
    notch.rotation.z = angle;
    group.add(notch);
  }

  group.userData.materials = { outerMat, innerMat };
  return group;
}

export function updateReticleState(reticle: Group, active: boolean, lockCount: number) {
  reticle.visible = true;
  const baseScale = 1.0 + lockCount * 0.08;
  const pulse = active ? 1.15 : 1.0;
  reticle.scale.setScalar(baseScale * pulse);
}
