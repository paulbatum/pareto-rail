import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry } from 'three';
import type { Object3D } from 'three';

export interface RoseBossState {
  hp: number;
  stage: number;
  timeAlive: number;
  lastShotTime: number;
  isDead: boolean;
}

export function createRoseBossMesh(): Group {
  const group = new Group();

  // 1. Outer Dark Stone Gothic Ring
  const ringGeo = new TorusGeometry(4.5, 0.35, 12, 32);
  const stoneMat = new MeshBasicMaterial({ color: 0x111318 });
  const ringMesh = new Mesh(ringGeo, stoneMat);
  ringMesh.name = 'boss-outer-ring';
  group.add(ringMesh);

  // 2. Stolen Stained-Glass Petals (Outer Shield - Stage 1)
  const petalGroup = new Group();
  petalGroup.name = 'boss-petals';
  const colors = [0x0033ff, 0xff0d33, 0x00cc66, 0xffaa00]; // Cobalt, Crimson, Emerald, Amber Gold

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const petalGeo = new BoxGeometry(0.8, 2.2, 0.15);
    const petalMat = new MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.85,
    });
    const petal = new Mesh(petalGeo, petalMat);
    petal.position.set(Math.cos(angle) * 3.0, Math.sin(angle) * 3.0, 0);
    petal.rotation.z = angle + Math.PI / 2;
    petalGroup.add(petal);
  }
  group.add(petalGroup);

  // 3. Inner Dark Core Seed (Stage 2/3)
  const coreGeo = new SphereGeometry(1.6, 16, 16);
  const coreMat = new MeshBasicMaterial({ color: 0x050508 });
  const coreMesh = new Mesh(coreGeo, coreMat);
  coreMesh.name = 'boss-core';
  group.add(coreMesh);

  // 4. Stolen Light Heart
  const heartGeo = new SphereGeometry(0.9, 12, 12);
  const heartMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const heartMesh = new Mesh(heartGeo, heartMat);
  heartMesh.name = 'boss-heart';
  group.add(heartMesh);

  return group;
}

export function updateRoseBossMesh(mesh: Object3D, state: RoseBossState, dt: number) {
  state.timeAlive += dt;

  // Gentle rotation of boss rose ring
  const petals = mesh.getObjectByName('boss-petals');
  if (petals) {
    petals.rotation.z += dt * 0.4;
  }

  // Pulsing stolen light heart
  const heart = mesh.getObjectByName('boss-heart');
  if (heart) {
    const pulse = 1.0 + Math.sin(state.timeAlive * 4.0) * 0.15;
    heart.scale.setScalar(pulse);
  }

  // Visual feedback per HP stage
  if (state.hp <= 2 && petals) {
    petals.scale.setScalar(0.5); // Outer shield broken
  }
}
