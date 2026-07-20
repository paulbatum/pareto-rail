import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, DoubleSide, Float32BufferAttribute,
  FogExp2, Group, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  Points, PointsMaterial, Scene, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { createMassDriverRail, massDriverRunProgress, massDriverSpeed, MASS_DRIVER_MUZZLE_U } from '../gameplay';
import { MASS_DRIVER_BARS, MASS_DRIVER_SHOT_TIME, MASS_DRIVER_TIME } from '../timing';
import { ARC_BLUE, GUNMETAL, ION_WHITE, STEEL, VIOLET, VOID, hdr, heatColor } from './palette';

// Object3D is used as the stable transform scratch; `DummyObject` is not part
// of three's public surface in all supported versions.
const dummy = new Object3D();
const Z_AXIS = new Vector3(0, 0, 1);

export type MassDriverEnvironment = {
  root: Group;
  rings: InstancedMesh;
  ringGlow: InstancedMesh;
  baseRingColors: Color[];
  chargeDisc: Mesh;
  stars: Points;
  streaks: Group;
  muzzleU: number;
  lastBeat: number;
  fog: FogExp2;
  effectActive: boolean;
  railMaterials: MeshBasicMaterial[];
};

function createGradientRail(angle: number) {
  const rail = createMassDriverRail();
  const points: Vector3[] = [];
  for (let i = 0; i <= 180; i += 1) {
    const u = (i / 180) * MASS_DRIVER_MUZZLE_U;
    points.push(offsetFromRail(rail, u, new Vector3(Math.cos(angle) * 11.05, Math.sin(angle) * 11.05, 0)));
  }
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.25);
  const geometry = new TubeGeometry(curve, 260, 0.075, 5, false);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < positions.count; i += 1) {
    const t = MathUtils.clamp(-positions.getZ(i) / 4100 / MASS_DRIVER_MUZZLE_U, 0, 1);
    const color = heatColor(t).multiplyScalar(1.25);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
}

export function createEnvironmentInternal(scene: Scene): MassDriverEnvironment {
  const root = new Group(); root.name = 'mass-driver-environment'; root.userData.raildIgnoreOcclusion = true; scene.add(root);
  const rail = createMassDriverRail();
  const ringCount = MASS_DRIVER_BARS.shot * 4 + 1;
  const ringGeometry = new TorusGeometry(11.55, 0.16, 6, 72);
  const rings = new InstancedMesh(ringGeometry, new MeshBasicMaterial({ color: 0xffffff, vertexColors: true }), ringCount);
  const ringGlow = new InstancedMesh(new TorusGeometry(11.55, 0.035, 4, 72), createAdditiveBasicMaterial({ color: ION_WHITE, opacity: 0.86 }), ringCount);
  const baseRingColors: Color[] = [];
  for (let beat = 0; beat < ringCount; beat += 1) {
    const time = beat * MASS_DRIVER_TIME.beatSeconds;
    const u = massDriverRunProgress(time);
    const downbeat = beat % 4 === 0;
    const frame = sampleRailFrame(rail, u);
    dummy.position.copy(frame.position); dummy.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent); dummy.scale.setScalar(downbeat ? 1.055 : 1); dummy.updateMatrix();
    rings.setMatrixAt(beat, dummy.matrix); ringGlow.setMatrixAt(beat, dummy.matrix);
    const color = heatColor(Math.pow(beat / (ringCount - 1), 1.12)); baseRingColors.push(color); rings.setColorAt(beat, color);
    ringGlow.setColorAt(beat, color.clone().multiplyScalar(downbeat ? 1.8 : 1.25));
  }
  rings.instanceMatrix.needsUpdate = true; ringGlow.instanceMatrix.needsUpdate = true;
  if (rings.instanceColor) rings.instanceColor.needsUpdate = true; if (ringGlow.instanceColor) ringGlow.instanceColor.needsUpdate = true;
  root.add(rings, ringGlow);

  // Four actual conductor rails at the diagonals, uninterrupted from breech to muzzle.
  const railMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 4; i += 1) {
    const conductor = createGradientRail(Math.PI / 4 + i * Math.PI / 2); root.add(conductor); railMaterials.push(conductor.material as MeshBasicMaterial);
  }

  // Downbeat housings and the dark rib-panel shell. Geometry is instanced so
  // the barrel can feel enormous without turning into hundreds of draw calls.
  const lugCount = Math.ceil(ringCount / 4) * 4;
  const lugs = new InstancedMesh(new BoxGeometry(1.05, 0.62, 1.9), new MeshBasicMaterial({ color: STEEL }), lugCount);
  let lugIndex = 0;
  for (let beat = 0; beat < ringCount; beat += 4) {
    const u = massDriverRunProgress(beat * MASS_DRIVER_TIME.beatSeconds);
    const frame = sampleRailFrame(rail, u);
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      dummy.position.copy(offsetFromRail(rail, u, new Vector3(Math.cos(a) * 11.65, Math.sin(a) * 11.65, 0)));
      dummy.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent); dummy.rotateZ(a); dummy.scale.setScalar(1); dummy.updateMatrix(); lugs.setMatrixAt(lugIndex++, dummy.matrix);
    }
  }
  lugs.instanceMatrix.needsUpdate = true; root.add(lugs);

  const panelCount = Math.ceil(ringCount / 2) * 10;
  const panels = new InstancedMesh(new BoxGeometry(3.2, 0.34, 6.4), new MeshBasicMaterial({ color: hdr(GUNMETAL, 0.78) }), panelCount);
  let panelIndex = 0;
  for (let beat = 0; beat < ringCount; beat += 2) {
    const u = massDriverRunProgress(beat * MASS_DRIVER_TIME.beatSeconds);
    const frame = sampleRailFrame(rail, u);
    for (let i = 0; i < 10; i += 1) {
      const a = i * Math.PI * 2 / 10 + (beat % 4) * 0.08;
      dummy.position.copy(offsetFromRail(rail, u, new Vector3(Math.cos(a) * 12.75, Math.sin(a) * 12.75, 1.8)));
      dummy.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent); dummy.rotateZ(a + Math.PI / 2); dummy.scale.setScalar(1); dummy.updateMatrix(); panels.setMatrixAt(panelIndex++, dummy.matrix);
    }
  }
  panels.instanceMatrix.needsUpdate = true; root.add(panels);

  // Sparse blue service lamps break up the wall without competing with enemies.
  const lampCount = Math.ceil(ringCount / 8) * 3;
  const lamps = new InstancedMesh(new BoxGeometry(0.12, 0.42, 0.8), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.75), opacity: 0.58 }), lampCount);
  let lampIndex = 0;
  for (let beat = 0; beat < ringCount; beat += 8) for (let i = 0; i < 3; i += 1) {
    const u = massDriverRunProgress(beat * MASS_DRIVER_TIME.beatSeconds);
    const frame = sampleRailFrame(rail, u); const a = (i * 4 + beat / 8) * Math.PI / 6;
    dummy.position.copy(offsetFromRail(rail, u, new Vector3(Math.cos(a) * 12.45, Math.sin(a) * 12.45, -1)));
    dummy.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent); dummy.rotateZ(a); dummy.scale.setScalar(1); dummy.updateMatrix(); lamps.setMatrixAt(lampIndex++, dummy.matrix);
  }
  lamps.instanceMatrix.needsUpdate = true; root.add(lamps);

  const muzzleFrame = sampleRailFrame(rail, MASS_DRIVER_MUZZLE_U);
  const chargeDisc = new Mesh(new CircleGeometry(4.1, 48), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 1.35), opacity: 0, side: DoubleSide }));
  chargeDisc.position.copy(muzzleFrame.position); chargeDisc.quaternion.setFromUnitVectors(Z_AXIS, muzzleFrame.tangent); root.add(chargeDisc);

  const starPositions: number[] = [];
  const starColors: number[] = [];
  for (let i = 0; i < 650; i += 1) {
    const a = i * 2.399963; const depth = 28 + (i % 73) * 3.15; const radius = 4 + ((i * 37) % 115) * (depth / 255);
    starPositions.push(Math.cos(a) * radius * 1.65, Math.sin(a) * radius, -depth);
    const c = i % 11 === 0 ? ION_WHITE : i % 3 === 0 ? VIOLET : ARC_BLUE; starColors.push(c.r, c.g, c.b);
  }
  const starGeometry = new BufferGeometry(); starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3)); starGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  const stars = new Points(starGeometry, new PointsMaterial({ size: 1.45, vertexColors: true, transparent: true, opacity: 0.88, sizeAttenuation: false })); stars.visible = false; root.add(stars);

  const beacon = new Mesh(new CircleGeometry(1.1, 24), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 1.7), opacity: 0.9 }));
  beacon.position.copy(offsetFromRail(rail, 0.99, new Vector3(0, 0, 30))); beacon.quaternion.setFromUnitVectors(Z_AXIS, sampleRailFrame(rail, 0.99).tangent); beacon.name = 'muzzle-beacon'; root.add(beacon);

  const streaks = new Group(); streaks.name = 'speed-streaks';
  const streakMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.82), opacity: 0.4 });
  for (let i = 0; i < 110; i += 1) {
    const a = i * 2.399963; const r = 4.8 + (i % 17) * 0.32;
    const streak = new Mesh(new BoxGeometry(0.018, 0.018, 1.6 + (i % 7) * 0.44), streakMaterial.clone());
    streak.position.set(Math.cos(a) * r, Math.sin(a) * r, -4 - (i % 23) * 1.3); streak.userData.phase = (i * 0.137) % 1; streaks.add(streak);
  }
  root.add(streaks);

  const fog = new FogExp2(VOID, 0.0062); scene.fog = fog;
  return { root, rings, ringGlow, baseRingColors, chargeDisc, stars, streaks, muzzleU: MASS_DRIVER_MUZZLE_U, lastBeat: -1, fog, effectActive: false, railMaterials };
}

export function updateEnvironment(env: MassDriverEnvironment, dt: number, context: { camera: PerspectiveCamera; elapsed: number; runTime: number; running: boolean; clearSweep?: number; detonation?: number; shotSuccess?: boolean | null; beatPulse?: number }) {
  if (env.streaks.parent !== env.root) env.root.add(env.streaks);
  env.streaks.position.copy(context.camera.position); env.streaks.quaternion.copy(context.camera.quaternion);
  const shot = context.runTime >= MASS_DRIVER_SHOT_TIME && context.shotSuccess === true;
  const interlockStart = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.interlock);
  const charge = context.running ? MathUtils.clamp((context.runTime - interlockStart) / (MASS_DRIVER_SHOT_TIME - interlockStart), 0, 1) : 0;
  const beatFloat = context.running ? context.runTime / MASS_DRIVER_TIME.beatSeconds : context.elapsed * 0.65;
  const beat = MathUtils.clamp(Math.floor(beatFloat), 0, env.baseRingColors.length - 1);

  if (beat !== env.lastBeat || !context.running) {
    for (const index of [env.lastBeat - 1, env.lastBeat, env.lastBeat + 1, beat - 1, beat, beat + 1]) {
      if (index < 0 || index >= env.baseRingColors.length) continue;
      const base = env.baseRingColors[index];
      const pre = index === beat + 1 ? 1.8 : index === beat ? 2.4 : 1;
      const idle = context.running ? 1 : 1 + Math.sin(context.elapsed * 2.1 + index * 0.71) * 0.22;
      env.rings.setColorAt(index, base.clone().multiplyScalar(pre * idle));
      env.ringGlow.setColorAt(index, base.clone().multiplyScalar(pre * idle * 1.35));
    }
    if (env.rings.instanceColor) env.rings.instanceColor.needsUpdate = true;
    if (env.ringGlow.instanceColor) env.ringGlow.instanceColor.needsUpdate = true;
    env.lastBeat = beat;
  }

  const clearSweep = context.clearSweep ?? -1;
  const detonation = context.detonation ?? 0;
  if (clearSweep >= 0 || detonation > 0.01 || env.effectActive) {
    for (let index = 0; index < env.baseRingColors.length; index += 1) {
      const base = env.baseRingColors[index].clone();
      if (clearSweep >= 0) {
        const wave = 1 - MathUtils.clamp(Math.abs(index - clearSweep * (env.baseRingColors.length + 16)) / 8, 0, 1);
        base.lerp(ION_WHITE, wave * wave);
      }
      if (detonation > 0.01) {
        const overload = MathUtils.clamp(detonation * (0.55 + Math.sin(context.elapsed * 31 + index * 0.43) * 0.3), 0, 1);
        base.lerp(new Color(1, 0.025, 0.04), overload).lerp(ION_WHITE, Math.max(0, overload - 0.72) * 2.5);
      }
      env.rings.setColorAt(index, base);
      env.ringGlow.setColorAt(index, base.clone().multiplyScalar(1.45));
    }
    if (env.rings.instanceColor) env.rings.instanceColor.needsUpdate = true;
    if (env.ringGlow.instanceColor) env.ringGlow.instanceColor.needsUpdate = true;
    env.effectActive = clearSweep >= 0 || detonation > 0.01;
  }

  const discMaterial = env.chargeDisc.material as MeshBasicMaterial;
  discMaterial.opacity = shot ? 0 : MathUtils.lerp(0, 0.42, charge * charge);
  env.chargeDisc.scale.setScalar(0.85 + charge * 0.35 + Math.sin(context.elapsed * 5) * 0.025 * charge);
  if (env.stars.parent !== env.root) env.root.add(env.stars);
  env.stars.position.copy(context.camera.position); env.stars.quaternion.copy(context.camera.quaternion);
  env.stars.visible = shot;
  env.root.getObjectByName('muzzle-beacon')!.visible = shot;
  env.fog.density = shot ? MathUtils.lerp(env.fog.density, 0.000025, 1 - Math.exp(-dt * 16)) : MathUtils.lerp(env.fog.density, 0.0062 - charge * 0.0018, 1 - Math.exp(-dt * 3));
  const atmosphere = VIOLET.clone().multiplyScalar(0.1 + charge * 0.08);
  env.fog.color.copy(shot ? VOID : VOID.clone().lerp(atmosphere, charge * 0.82));
  const railEnergy = 1 + Math.max(0, context.beatPulse ?? 0) * 0.55 + charge * 0.18;
  for (const material of env.railMaterials) material.color.setScalar(railEnergy);

  const speed = context.running ? massDriverSpeed.speedAt(context.runTime) : 0.22;
  env.streaks.visible = true;
  const streakColor = shot ? ION_WHITE.clone() : heatColor(Math.min(0.94, context.runTime / MASS_DRIVER_SHOT_TIME));
  streakColor.multiplyScalar(shot ? 0.75 : 0.82);
  env.streaks.children.forEach((child, index) => {
    child.position.z += dt * (10 + speed * 24);
    if (child.position.z > -1) child.position.z = -34 - (index % 19) * 1.2;
    const mesh = child as Mesh;
    mesh.scale.z = shot ? 4.5 : 0.7 + speed * 0.45;
    const streakMaterial = mesh.material as MeshBasicMaterial;
    streakMaterial.opacity = MathUtils.clamp(0.12 + speed * 0.13 + charge * 0.13, 0.12, 0.72);
    streakMaterial.color.copy(streakColor);
  });
}

export function disposeEnvironment(env: MassDriverEnvironment) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<MeshBasicMaterial | PointsMaterial>();
  env.root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Points) {
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) if (material instanceof MeshBasicMaterial || material instanceof PointsMaterial) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  if (env.root.parent instanceof Scene) env.root.parent.fog = null;
  env.root.removeFromParent();
}
