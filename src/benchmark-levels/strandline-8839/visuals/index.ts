import { BackSide, BufferAttribute, Color, Fog, Group, InstancedMesh, MathUtils, Matrix4, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Quaternion, RingGeometry, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { EventBus } from '../../../events';
import { CROWN, type Life } from '../gameplay';
import { buildAnimal, buildWater } from './environment';
import { makeTarget } from './models';

export const PALETTE = { green: 0x8ce4a2, gold: 0xe8ef99, membrane: 0x77bca1, strand: 0xbbe9bf, violet: 0x9849c8, pink: 0xfaa4ea, parasite: 0x321b52, strandBody: 0x67bb95, sun: 0xd9ffc2, skyLight: 0xc5fff1, seaLight: 0x034568, plankton: 0x4cacc0, sunbeam: 0x9cead5, letterShadow: 0x053d4c };
export type Palette = typeof PALETTE;
export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus, life: Life) {
  const root = new Group(); scene.add(root);
  const animal = buildAnimal(PALETTE); root.add(animal.root, buildWater(PALETTE));
  const nestingParent = makeTarget('parent', undefined, PALETTE);
  root.add(nestingParent); nestingParent.visible = false;
  scene.background = new Color(0x07536e); scene.fog = new Fog(0x07536e, 75, 400);
  const skyGeometry = new SphereGeometry(700, 32, 24);
  const vertices = skyGeometry.getAttribute('position');
  const colors = new Float32Array(vertices.count * 3);
  const top = new Color(0x43a5a8), bottom = new Color(0x031e46), middle = new Color(0x086683);
  for (let i = 0; i < vertices.count; i++) {
    const h = vertices.getY(i) / 700;
    const c = h > 0 ? middle.clone().lerp(top, Math.pow(h, 0.6)) : middle.clone().lerp(bottom, -h);
    c.toArray(colors, i * 3);
  }
  skyGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  const sky = new Mesh(skyGeometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false })); root.add(sky);
  const allocated = new Set<Object3D>();
  const particleGeometry = new OctahedronGeometry(0.13);
  const particleMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const particles = new InstancedMesh(particleGeometry, particleMat, 360); particles.frustumCulled = false; root.add(particles);
  const zero = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < 360; i++) particles.setMatrixAt(i, zero);
  type Particle = { position: Vector3; velocity: Vector3; age: number; duration: number; scale: number };
  const specs: Array<Particle | null> = Array.from({ length: 360 }, () => null);
  let cursor = 0, beat = 0, flash = 0;
  const matrix = new Matrix4(), quaternion = new Quaternion(), scale = new Vector3();
  const rings = Array.from({ length: 20 }, () => {
    const mesh = new Mesh(new TorusGeometry(1, 0.028, 4, 40), new MeshBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 0, depthWrite: false }));
    root.add(mesh); mesh.visible = false;
    return { mesh, age: 2, duration: 0.6, size: 1 };
  });
  let ringCursor = 0;
  function ring(position: Vector3, color: number, size: number, duration = 0.65) {
    const r = rings[ringCursor++ % rings.length]; r.mesh.position.copy(position); r.mesh.quaternion.copy(camera.quaternion); r.mesh.material.color.set(color); r.mesh.visible = true; r.age = 0; r.size = size; r.duration = duration;
  }
  function burst(position: Vector3, color: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996 + cursor;
      const direction = new Vector3(Math.cos(a), Math.sin(a), Math.sin(i * 7.1) * 0.7).normalize();
      const slot = cursor++ % specs.length;
      specs[slot] = { position: position.clone(), velocity: direction.multiplyScalar(power * (0.5 + (i % 5) / 8)), age: 0, duration: 0.7 + (i % 4) * 0.14, scale: 0.7 + (i % 3) * 0.4 };
      particles.setColorAt(slot, new Color(color));
    }
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
  }
  const unsub = [
    bus.on('spawn', e => { if (!e.letter) ring(e.kind === 'brood' ? CROWN : e.worldPosition, PALETTE.violet, e.kind === 'brood' ? 4 : 2, 0.5); }),
    bus.on('lock', e => { ring(e.worldPosition, PALETTE.gold, 1.6, 0.3); burst(e.worldPosition, PALETTE.gold, 4, 2); }),
    bus.on('unlock', e => ring(e.worldPosition, PALETTE.green, 0.7, 0.2)),
    bus.on('fire', e => { burst(e.worldPosition, PALETTE.gold, 4, 2); if (e.volleySize === 6) flash = 0.6; }),
    bus.on('hit', e => { ring(e.worldPosition, PALETTE.pink, 1.7, 0.3); burst(e.worldPosition, PALETTE.pink, 8, 5); }),
    bus.on('kill', e => { ring(e.worldPosition, PALETTE.gold, e.enemyId === life.parentId ? 13 : 3.2, 1); burst(e.worldPosition, PALETTE.green, e.enemyId === life.parentId ? 100 : 18, 6); }),
    bus.on('miss', e => { ring(e.worldPosition, PALETTE.violet, 0.7); burst(e.worldPosition, PALETTE.violet, 6, 1); }),
    bus.on('reject', () => { flash = -0.7; }),
    bus.on('beat', () => { beat = 1; }),
    bus.on('bossphase', e => { if (e.phase === 'destroyed') flash = 1; }),
    bus.on('runstart', () => { specs.fill(null); rings.forEach(r => { r.mesh.visible = false; r.age = 2; }); }),
  ];
  const reticleMaterial = new MeshBasicMaterial({ color: PALETTE.gold, depthTest: false, depthWrite: false });
  const factories = {
    createEnemyMesh(kind: string, letter?: string) { const mesh = makeTarget(kind, letter, PALETTE); allocated.add(mesh); return mesh; },
    setEnemyLocked(mesh: Object3D, locked: boolean) {
      const materials = mesh.userData.materials;
      materials?.skin.color.set(locked ? PALETTE.gold : mesh.userData.letter ? PALETTE.gold : PALETTE.violet);
      materials?.bright.color.set(locked ? 0xffffd6 : mesh.userData.letter ? PALETTE.strand : PALETTE.pink);
      const lock = mesh.getObjectByName('lock'); if (lock) lock.visible = locked;
    },
    setEnemyDenied(mesh: Object3D) { mesh.userData.materials?.bright.color.set(0xff648b); ring(mesh.position, 0xff648b, 2); },
    createProjectileMesh() {
      const mesh = new Group();
      const core = new Mesh(new SphereGeometry(0.16, 8, 6), new MeshBasicMaterial({ color: new Color(PALETTE.gold).multiplyScalar(2) }));
      const tail = new Mesh(new SphereGeometry(0.12, 6, 4), new MeshBasicMaterial({ color: PALETTE.strand, transparent: true, opacity: 0.7, depthWrite: false })); tail.scale.z = 5; tail.position.z = 0.5;
      mesh.add(core, tail); allocated.add(mesh); return mesh;
    },
    createReticle() {
      const group = new Group();
      const ring = new Mesh(new RingGeometry(0.4, 0.44, 40), reticleMaterial); group.add(ring);
      for (let i = 0; i < 6; i++) { const dot = new Mesh(new SphereGeometry(0.045, 6, 4), reticleMaterial); const a = i / 6 * Math.PI * 2; dot.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0); dot.name = `charge${i}`; group.add(dot); }
      allocated.add(group); return group;
    },
    setReticleActive(reticle: Object3D, active: boolean, count: number) {
      reticleMaterial.color.set(flash < -0.1 ? 0xff648b : active ? 0xffffd9 : PALETTE.strand);
      reticle.scale.setScalar(1 + (active ? 0.05 : 0) + Math.max(0, flash) * 0.2);
      reticle.children.forEach((c, i) => { if (i > 0) c.scale.setScalar(i <= count ? 1.8 : 0.65); });
    },
  };
  return { factories, update(dt: number, elapsed: number) {
    for (const object of allocated) {
      if (object.parent) continue;
      disposeObjects([object]); allocated.delete(object);
    }
    const time = life.running ? life.time : elapsed;
    animal.update(time, life); sky.position.copy(camera.position);
    nestingParent.visible = life.running && life.time >= 39.5 && !life.exposed;
    nestingParent.position.copy(CROWN);
    nestingParent.quaternion.copy(camera.quaternion);
    nestingParent.children[0].scale.setScalar(1 + Math.sin(time * 3) * 0.07);
    nestingParent.userData.webs.forEach((web: Group, i: number) => {
      const target = life.broods[i] >= 3 ? 0 : 1;
      const size = MathUtils.lerp(web.scale.x, target, 1 - Math.exp(-dt * 7));
      web.scale.setScalar(size); web.visible = size > 0.03;
      web.rotation.z = Math.sin(time * 0.5 + i) * 0.06;
    });
    if (scene.fog instanceof Fog) { scene.fog.near = life.freed ? 200 : 75; scene.fog.far = life.freed ? 680 : 400; }
    beat *= Math.exp(-dt * 5); flash *= Math.exp(-dt * 5);
    for (const r of rings) {
      r.age += dt; r.mesh.visible = r.age < r.duration;
      if (!r.mesh.visible) continue;
      const f = r.age / r.duration; r.mesh.scale.setScalar(0.2 + f * r.size); r.mesh.material.opacity = (1 - f) * 0.8;
    }
    specs.forEach((s, i) => {
      if (!s) { particles.setMatrixAt(i, zero); return; }
      s.age += dt;
      if (s.age > s.duration) { specs[i] = null; particles.setMatrixAt(i, zero); return; }
      s.position.addScaledVector(s.velocity, dt); s.velocity.y += dt * 1.4;
      scale.setScalar(s.scale * (1 - s.age / s.duration)); matrix.compose(s.position, quaternion, scale); particles.setMatrixAt(i, matrix);
    });
    particles.instanceMatrix.needsUpdate = true;
    animal.root.rotation.z = Math.sin(time * 0.23) * 0.007 + beat * 0.0006;
  }, dispose() {
    unsub.forEach(fn => fn());
    disposeObjects([root, ...allocated]); allocated.clear(); scene.remove(root); scene.fog = null;
  } };
}

function disposeObjects(objects: Object3D[]) {
  const geometries = new Set<{ dispose(): void }>(), materials = new Set<{ dispose(): void }>();
  for (const object of objects) object.traverse(o => {
    const mesh = o as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
