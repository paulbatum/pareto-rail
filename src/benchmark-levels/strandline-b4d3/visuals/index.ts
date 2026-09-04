import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Line,
  LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera,
  RingGeometry, Scene, SphereGeometry, Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { disposeObject3D } from '../../../engine/visual-kit';
import type { VisualFactories } from '../../../engine/types';
import { PARENT, STRAND_COUNT, strandPoint, smooth, type RescueState } from '../world';
import { buildEnvironment } from './environment';
import { buildLetter, buildParasite } from './models';

export const PALETTE = {
  water: new Color(0x075875), deep: new Color(0x02132f), surface: new Color(0x40a3b5),
  bell: new Color(0x459f73), green: new Color(0x84d995), gold: new Color(0xe7df88),
  silt: new Color(0x8ebcba), shell: new Color(0x291544), violet: new Color(0xb85bd5),
  hostileLight: new Color(0xf6b0ee).multiplyScalar(1.25), letter: new Color(0xe2f0c4),
};
export type Palette = typeof PALETTE;

export function createParasiteModel(kind = 'louse') { return buildParasite(kind, PALETTE); }

type Record = { mesh: Group; tether: Line<BufferGeometry, LineBasicMaterial> };
type Ring = { mesh: Mesh<RingGeometry, MeshBasicMaterial>; age: number; life: number; radius: number; speed: number };
type Particle = { p: Vector3; v: Vector3; age: number; life: number; size: number; color: Color };

export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus, state: RescueState, feel: CameraFeelRig) {
  const environment = buildEnvironment(scene, PALETTE, 960);
  const protectedParent = buildParasite('parent', PALETTE);
  protectedParent.position.copy(PARENT);
  protectedParent.visible = false;
  scene.add(protectedParent);
  const records = new Map<number, Record>();
  const pending: Group[] = [];
  const effects = new Group(); scene.add(effects);
  const rings: Ring[] = [];
  const ringGeo = new RingGeometry(0.94, 1, 52);
  const particleGeo = new SphereGeometry(1, 5, 4);
  const particleMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  const particleMesh = new InstancedMesh(particleGeo, particleMat, 480);
  particleMesh.instanceMatrix.setUsage(35048);
  particleMesh.frustumCulled = false;
  effects.add(particleMesh);
  const particles: Particle[] = Array.from({ length: 480 }, () => ({ p: new Vector3(), v: new Vector3(), age: 1, life: 0, size: 0, color: PALETTE.gold.clone() }));
  let particleCursor = 0;
  let serial = 0;
  let beat = 0;
  let reject = 0;
  let reticleMesh: Group | undefined;
  const matrix = new Matrix4();
  const point = new Vector3();
  const rootPoint = new Vector3();
  const tempColor = new Color();
  const projectileGeometry = new SphereGeometry(1, 8, 6).scale(0.09, 0.09, 0.62);
  const projectileMaterial = new MeshBasicMaterial({ color: PALETTE.gold.clone().multiplyScalar(1.7) });
  const projectileTailGeometry = new SphereGeometry(1, 6, 4).scale(0.05, 0.05, 1.65).translate(0, 0, 1.2);
  const projectileTailMaterial = new MeshBasicMaterial({ color: PALETTE.green, transparent: true, opacity: 0.45, depthWrite: false });

  function ring(position: Vector3, color: Color, radius: number, speed: number, life = 0.65) {
    const mesh = new Mesh(ringGeo, new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    mesh.position.copy(position); mesh.quaternion.copy(camera.quaternion);
    effects.add(mesh); rings.push({ mesh, age: 0, life, radius, speed });
  }
  function burst(position: Vector3, count: number, color: Color, force: number) {
    for (let i = 0; i < count; i++) {
      const p = particles[particleCursor++ % particles.length];
      const k = serial++;
      const angle = k * 2.39996323;
      const z = Math.sin(k * 1.91);
      p.p.copy(position);
      p.v.set(Math.cos(angle) * Math.sqrt(1 - z * z), z, Math.sin(angle) * Math.sqrt(1 - z * z)).multiplyScalar(force * (0.45 + k % 7 / 9));
      p.age = 0; p.life = 0.6 + k % 11 * 0.085; p.size = 0.045 + k % 5 * 0.027;
      p.color.copy(color);
    }
  }
  function retire(id: number) {
    const record = records.get(id);
    if (!record) return;
    record.tether.removeFromParent(); record.tether.geometry.dispose(); record.tether.material.dispose();
    disposeObject3D(record.mesh);
    records.delete(id);
  }

  const off = [
    bus.on('spawn', ({ enemyId, worldPosition, letter }) => {
      const mesh = pending.shift(); if (!mesh) return;
      const geo = new BufferGeometry().setFromPoints([worldPosition, worldPosition, worldPosition]);
      const tether = new Line(geo, new LineBasicMaterial({ color: PALETTE.violet, transparent: true, opacity: 0.62, depthWrite: false }));
      effects.add(tether); records.set(enemyId, { mesh, tether });
      if (!letter) { ring(worldPosition, PALETTE.violet, 2.2, -1.8, 0.55); burst(worldPosition, 5, PALETTE.violet, 1.7); }
    }),
    bus.on('lock', ({ worldPosition, lockCount }) => {
      ring(worldPosition, PALETTE.gold, 1.75, -1.3, 0.32);
      if (lockCount === 6) { ring(worldPosition, PALETTE.letter, 2, 3.6, 0.65); feel.kickFov(0.6); }
    }),
    bus.on('unlock', ({ worldPosition }) => ring(worldPosition, PALETTE.green, 1, 2, 0.3)),
    bus.on('fire', ({ worldPosition, volleySize, indexInVolley }) => {
      burst(worldPosition, 3, PALETTE.gold, 1.3);
      if (indexInVolley === 0) {
        feel.kickFov(volleySize === 6 ? 2.6 : 0.7);
        if (volleySize === 6) ring(worldPosition.clone().add(new Vector3(0, 0, -5).applyQuaternion(camera.quaternion)), PALETTE.gold, 0.4, 11, 0.8);
      }
    }),
    bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
      const record = records.get(enemyId);
      if (record) record.mesh.userData.hitFlash = 0.3;
      ring(worldPosition, PALETTE.letter, 0.35, lethal ? 6 : 3.5, 0.36);
      if (!lethal) { burst(worldPosition, 10, PALETTE.violet, 3); feel.shake(0.13); }
    }),
    bus.on('kill', ({ enemyId, worldPosition, letter }) => {
      const parent = records.get(enemyId)?.mesh.userData.kind === 'parent';
      burst(worldPosition, parent ? 95 : letter ? 14 : 22, PALETTE.gold, parent ? 16 : 4.5);
      burst(worldPosition, parent ? 55 : 10, PALETTE.violet, parent ? 10 : 2.6);
      ring(worldPosition, PALETTE.green, 0.3, parent ? 32 : 5, parent ? 2.3 : 0.85);
      if (parent) { feel.kickFov(4); feel.shake(0.28, { decay: 1.2 }); }
      retire(enemyId);
    }),
    bus.on('miss', ({ enemyId, worldPosition, letter }) => {
      if (!letter) { ring(worldPosition, PALETTE.violet, 2.5, -2.1, 0.65); burst(worldPosition, 8, PALETTE.violet, 1.4); }
      retire(enemyId);
    }),
    bus.on('reject', () => { reject = 0.65; feel.kickFov(-0.8); }),
    bus.on('stage', ({ worldPosition }) => { ring(worldPosition, PALETTE.gold, 3, 12, 1.1); burst(worldPosition, 35, PALETTE.violet, 8); }),
    bus.on('playerhit', () => { reject = 0.6; feel.shake(0.3); }),
    bus.on('beat', ({ isDownbeat }) => { beat = isDownbeat ? 1 : 0.45; }),
    bus.on('runstart', () => {
      beat = 0; reject = 0;
      for (const id of [...records.keys()]) retire(id);
      for (const p of particles) p.age = p.life;
      for (const r of rings) { r.mesh.removeFromParent(); r.mesh.material.dispose(); }
      rings.length = 0;
    }),
  ];

  const factories: VisualFactories = {
    createEnemyMesh(kind, letter) {
      const mesh = kind === 'letter' ? buildLetter(letter ?? 'A', PALETTE) : buildParasite(kind, PALETTE);
      if (kind === 'parent') (mesh.userData.webs as Group[]).forEach((web) => { web.scale.set(0, 0, 1); web.visible = false; });
      pending.push(mesh); return mesh;
    },
    setEnemyLocked(mesh, locked, count = 0) {
      mesh.userData.locked = locked;
      (mesh.userData.halo as Mesh).visible = locked;
      const hot = mesh.userData.hot as MeshBasicMaterial;
      hot.color.copy(locked ? PALETTE.gold : mesh.userData.kind === 'letter' ? PALETTE.letter : PALETTE.hostileLight);
      mesh.userData.lockCount = count;
    },
    setEnemyDenied(mesh) { mesh.userData.denied = 0.65; },
    createProjectileMesh() {
      const group = new Group();
      group.add(new Mesh(projectileGeometry, projectileMaterial), new Mesh(projectileTailGeometry, projectileTailMaterial));
      return group;
    },
    createReticle() {
      const group = new Group();
      const mat = new MeshBasicMaterial({ color: PALETTE.letter, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: DoubleSide });
      const ring = new Mesh(new RingGeometry(0.27, 0.29, 40), mat);
      const inner = new Mesh(new RingGeometry(0.025, 0.044, 12), mat);
      group.add(ring, inner);
      for (let i = 0; i < 6; i++) {
        const petal = new Mesh(new RingGeometry(0.34, 0.4, 12, 1, i * Math.PI / 3 + 0.09, Math.PI / 3 - 0.18), mat.clone());
        group.add(petal);
      }
      group.renderOrder = 1000;
      reticleMesh = group;
      return group;
    },
    setReticleActive(reticle, active, count) {
      reticle.scale.setScalar(active ? 1 + Math.sin(state.time * 4) * 0.035 : 0.92);
      reticle.children.forEach((child, i) => {
        const material = (child as Mesh<RingGeometry, MeshBasicMaterial>).material;
        material.color.copy(reject > 0 ? PALETTE.violet : i >= 2 && i - 2 < count ? PALETTE.gold : PALETTE.letter);
        material.opacity = i < 2 ? 0.95 : i - 2 < count ? 1 : 0.2;
      });
    },
  };

  function update(dt: number, elapsed: number) {
    beat *= Math.exp(-dt * 3.4); reject = Math.max(0, reject - dt);
    const freed = state.freedAt >= 0 ? smooth(state.freedAt, state.freedAt + 3.6, state.time) : 0;
    environment.animal.position.y = freed * Math.sin((state.time - state.freedAt) * 0.08) * 6;
    environment.animal.rotation.z = freed * 0.018;
    environment.bell.scale.set(1 + Math.sin(elapsed * 0.86) * 0.009, 1 + Math.sin(elapsed * 0.86) * 0.022, 1 + Math.sin(elapsed * 0.86) * 0.009);
    environment.veinMat.color.copy(PALETTE.green).lerp(PALETTE.gold, 0.18 + freed * 0.12).multiplyScalar(0.8 + beat * 0.12 + freed * 0.32);
    const reveal = smooth(14, 17, state.time) * (1 - smooth(21, 24, state.time));
    environment.fog.density = (0.0062 - reveal * 0.0024) * (1 - freed) + 0.0017 * freed;
    environment.updateSky(camera);
    environment.dust.position.y = Math.sin(elapsed * 0.06) * 3;
    for (let i = 0; i < STRAND_COUNT; i++) {
      const strand = environment.strands[i];
      const health = state.cleansed.has(i) ? 1 : freed;
      strand.group.rotation.z = Math.sin(elapsed * 0.42 + i * 1.9) * 0.009;
      strand.group.rotation.x = Math.sin(elapsed * 0.31 + i) * 0.007;
      strand.light.color.copy(PALETTE.green).lerp(PALETTE.gold, 0.05 + health * 0.23).multiplyScalar(0.62 + health * 0.65 + beat * 0.085);
      strand.sheath.opacity = 0.1 + health * 0.07;
      for (let j = 0; j < 4; j++) {
        const t = (j / 4 + 1 - ((elapsed * (0.037 + health * 0.022) + i * 0.017) % 1)) % 1;
        strandPoint(i, t, point); rootPoint.copy(strand.group.position);
        point.sub(rootPoint).applyEuler(strand.group.rotation).add(rootPoint);
        matrix.makeScale(0.7 + health * 0.7, 2.6, 0.7 + health * 0.7); matrix.setPosition(point);
        environment.pearls.setMatrixAt(i * 4 + j, matrix);
      }
    }
    environment.pearls.instanceMatrix.needsUpdate = true;
    protectedParent.visible = state.time >= 37.5 && state.freedAt < 0 && (!state.exposed || state.ended);
    protectedParent.quaternion.copy(camera.quaternion);
    (protectedParent.userData.webs as Group[]).forEach((web, i) => {
      const target = state.broodKills[i] >= 3 ? 0 : 1 - state.broodKills[i] * 0.16;
      web.scale.lerp(new Vector3(target, target, 1), Math.min(1, dt * 2.8));
      web.visible = web.scale.x > 0.02;
      (web.children[0] as Mesh<BufferGeometry, MeshBasicMaterial>).material.opacity = web.scale.x * 0.88;
    });

    for (const { mesh, tether } of records.values()) {
      const kind = mesh.userData.kind as string;
      const denied = Math.max(0, (mesh.userData.denied as number) - dt);
      const hit = Math.max(0, (mesh.userData.hitFlash as number) - dt);
      mesh.userData.denied = denied; mesh.userData.hitFlash = hit;
      const hot = mesh.userData.hot as MeshBasicMaterial;
      hot.color.copy(denied > 0 ? PALETTE.violet : hit > 0 ? PALETTE.letter : mesh.userData.locked ? PALETTE.gold : kind === 'letter' ? PALETTE.letter : PALETTE.hostileLight);
      const shell = mesh.userData.shell as MeshBasicMaterial | undefined;
      if (shell) shell.color.copy(PALETTE.shell).lerp(PALETTE.violet, hit > 0 ? hit * 2 : 0.05 + beat * 0.06);
      const halo = mesh.userData.halo as Mesh;
      halo.rotation.z = elapsed * 0.25;
      if (kind !== 'letter') halo.scale.setScalar(1 + (mesh.userData.lockCount ?? 0) * 0.06);
      if (denied > 0) halo.visible = Math.sin(denied * 36) > 0;
      else halo.visible = mesh.userData.locked === true;
      const fins = mesh.userData.fins as Mesh[] | undefined;
      fins?.forEach((fin, i) => { fin.rotation.y = Math.sin(elapsed * (kind === 'ribbon' ? 5 : 3.2) + i * 2) * 0.4; });
      if (kind === 'cyst') (mesh.userData.legMesh as Mesh).rotation.z = Math.sin(elapsed * 1.65) * 0.13;
      if (kind === 'parent') {
        const webs = mesh.userData.webs as Group[];
        const counts = (mesh.userData.broodKills as number[] | undefined) ?? [0, 0, 0];
        webs.forEach((web, i) => {
          const target = counts[i] >= 3 ? 0 : 1 - counts[i] * 0.16;
          web.scale.lerp(new Vector3(target, target, 1), Math.min(1, dt * 2.8));
          web.visible = web.scale.x > 0.02;
          (web.children[0] as Mesh<BufferGeometry, MeshBasicMaterial>).material.opacity = web.scale.x * 0.88;
        });
        const shellMesh = mesh.userData.shellMesh as Mesh;
        shellMesh.scale.setScalar(1 + Math.sin(elapsed * 2.1) * 0.035);
        (mesh.userData.healthPips as Mesh<SphereGeometry, MeshBasicMaterial>[]).forEach((pip, i) => {
          pip.visible = true;
          pip.material.color.copy(i < (mesh.userData.damage ?? 0) ? PALETTE.green : PALETTE.hostileLight);
          pip.scale.setScalar(i < (mesh.userData.damage ?? 0) ? 0.6 : 1);
        });
        if (mesh.userData.stage > 0) (mesh.userData.legMesh as Mesh).scale.setScalar(0.76);
      }
      tether.visible = mesh.userData.latched === true && mesh.userData.tether !== undefined;
      if (tether.visible) {
        const target = mesh.userData.tether as Vector3;
        const position = tether.geometry.getAttribute('position') as BufferAttribute;
        position.setXYZ(0, mesh.position.x, mesh.position.y, mesh.position.z);
        point.copy(mesh.position).lerp(target, 0.5); point.y -= Math.min(2, mesh.position.distanceTo(target) * 0.15);
        position.setXYZ(1, point.x, point.y, point.z); position.setXYZ(2, target.x, target.y, target.z);
        position.needsUpdate = true; tether.geometry.computeBoundingSphere();
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.age += dt;
      if (r.age >= r.life) { r.mesh.removeFromParent(); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(Math.max(0.04, r.radius + r.age * r.speed));
      r.mesh.material.opacity = (1 - r.age / r.life) * 0.72;
      r.mesh.position.y += dt * 0.5;
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]; p.age += dt;
      if (p.age < p.life) {
        p.v.y += dt * 1.6; p.v.multiplyScalar(Math.exp(-dt * 1.3)); p.p.addScaledVector(p.v, dt);
        const scale = p.size * (1 - p.age / p.life);
        matrix.makeScale(scale, scale * 1.55, scale); matrix.setPosition(p.p);
        tempColor.copy(p.color).lerp(PALETTE.green, p.age / p.life * 0.5);
        particleMesh.setColorAt(i, tempColor);
      } else matrix.makeScale(0, 0, 0);
      particleMesh.setMatrixAt(i, matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  }

  return { factories, update, dispose() {
    off.forEach((fn) => fn());
    for (const id of [...records.keys()]) retire(id);
    disposeObject3D(environment.root); environment.root.removeFromParent();
    disposeObject3D(protectedParent); protectedParent.removeFromParent();
    disposeObject3D(effects); effects.removeFromParent();
    if (reticleMesh) disposeObject3D(reticleMesh);
    projectileGeometry.dispose(); projectileMaterial.dispose(); projectileTailGeometry.dispose(); projectileTailMaterial.dispose(); ringGeo.dispose();
    scene.fog = null;
  } };
}
