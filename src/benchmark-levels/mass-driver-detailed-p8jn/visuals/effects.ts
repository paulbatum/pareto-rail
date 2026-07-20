import {
  BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh,
  MeshBasicMaterial, Object3D, RingGeometry, Scene, Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, ION_WHITE, hdr } from './palette';

type Spark = { mesh: Mesh; velocity: Vector3; born: number; life: number };
type Pulse = { mesh: Object3D; born: number; life: number; endScale: number };
type Lightning = { line: Line; from: Vector3; to: Vector3; born: number; life: number; seed: number };

let scene: Scene | null = null;
let now = 0;
const sparks: Spark[] = [];
const pulses: Pulse[] = [];
const lightning: Lightning[] = [];

export function createEffects(target: Scene) { scene = target; }

function disposeObject(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function burst(position: Vector3, color: Color, count: number, speed: number, life = 0.42) {
  if (!scene) return;
  for (let i = 0; i < count; i += 1) {
    const geometry = new BoxGeometry(0.035, 0.035, 0.75 + (i % 4) * 0.25);
    const material = createAdditiveBasicMaterial({ color: hdr(color, 1.2), opacity: 0.9 });
    const mesh = new Mesh(geometry, material); mesh.position.copy(position);
    const velocity = new Vector3(Math.sin(i * 12.989 + count), Math.cos(i * 7.331 + 0.8), Math.sin(i * 4.177 + 2.1)).normalize().multiplyScalar(speed * (0.5 + (i % 5) * 0.12));
    mesh.lookAt(position.clone().add(velocity)); scene.add(mesh); sparks.push({ mesh, velocity, born: now, life });
  }
}

export function pulse(position: Vector3, color: Color, endScale = 5, life = 0.4, sides = 48) {
  if (!scene) return;
  const mesh = new Mesh(new RingGeometry(0.85, 0.94, sides), createAdditiveBasicMaterial({ color: hdr(color, 1.25), opacity: 0.88 }));
  mesh.position.copy(position); scene.add(mesh); pulses.push({ mesh, born: now, life, endScale }); return mesh;
}

export function arc(from: Vector3, to: Vector3, color = ARC_BLUE, life = 0.26, seed = 1) {
  if (!scene) return;
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(new Array(11 * 3).fill(0), 3));
  const line = new Line(geometry, new LineBasicMaterial({ color: hdr(color, 1.65), transparent: true, opacity: 0.95 })); scene.add(line);
  lightning.push({ line, from: from.clone(), to: to.clone(), born: now, life, seed });
}

export function crossGlint(position: Vector3, scale = 1) {
  if (!scene) return;
  const group = new Group(); group.position.copy(position);
  for (const rotation of [0, Math.PI / 2]) {
    const line = new Mesh(new RingGeometry(0.06, 0.09, 4, 1, -0.1, Math.PI + 0.2), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2), opacity: 0.95 }));
    line.scale.set(2.8 * scale, 0.35 * scale, 1); line.rotation.z = rotation; group.add(line);
  }
  scene.add(group); pulses.push({ mesh: group, born: now, life: 0.18, endScale: 1.55 });
}

export function updateEffects(dt: number, elapsed: number, cameraQuaternion: import('three').Quaternion) {
  now = elapsed;
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const item = sparks[i]; const age = now - item.born;
    if (age >= item.life) { item.mesh.removeFromParent(); item.mesh.geometry.dispose(); (item.mesh.material as MeshBasicMaterial).dispose(); sparks.splice(i, 1); continue; }
    item.mesh.position.addScaledVector(item.velocity, dt); item.mesh.lookAt(item.mesh.position.clone().add(item.velocity));
    item.mesh.scale.setScalar(Math.max(0.02, 1 - age / item.life)); (item.mesh.material as MeshBasicMaterial).opacity = 1 - age / item.life;
  }
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const item = pulses[i]; const t = (now - item.born) / item.life;
    if (t >= 1) { item.mesh.removeFromParent(); disposeObject(item.mesh); pulses.splice(i, 1); continue; }
    item.mesh.quaternion.copy(cameraQuaternion); item.mesh.scale.setScalar(1 + t * item.endScale);
    item.mesh.traverse((child) => { if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) child.material.opacity = (1 - t) * 0.9; });
  }
  for (let i = lightning.length - 1; i >= 0; i -= 1) {
    const item = lightning[i]; const age = now - item.born;
    if (age >= item.life) { item.line.removeFromParent(); item.line.geometry.dispose(); (item.line.material as LineBasicMaterial).dispose(); lightning.splice(i, 1); continue; }
    const attr = item.line.geometry.getAttribute('position');
    const direction = item.to.clone().sub(item.from); const side = new Vector3(0.43, 0.81, 0.39).cross(direction).normalize();
    for (let j = 0; j <= 10; j += 1) {
      const t = j / 10; const jag = (j === 0 || j === 10) ? 0 : Math.sin((j + 1) * 19.37 + elapsed * 54 + item.seed) * 0.32;
      const p = item.from.clone().lerp(item.to, t).addScaledVector(side, jag); attr.setXYZ(j, p.x, p.y, p.z);
    }
    attr.needsUpdate = true; (item.line.material as LineBasicMaterial).opacity = 1 - age / item.life;
  }
}

export function resetEffects() {
  for (const item of sparks) { item.mesh.removeFromParent(); disposeObject(item.mesh); }
  for (const item of pulses) { item.mesh.removeFromParent(); disposeObject(item.mesh); }
  for (const item of lightning) { item.line.removeFromParent(); disposeObject(item.line); }
  sparks.length = 0; pulses.length = 0; lightning.length = 0;
}
