import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, time, uniform, vec3 } from 'three/tsl';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { VEIL_SPIN } from '../parent';
import { JELLY_MATRIX, PARENT_RADIUS, PARENT_Y, VEILS } from '../world';
import {
  BELL_GOLD,
  hdr,
  SICK_MAGENTA,
  SILK,
  SUN_WHITE,
  VIOLET,
  VIOLET_DARK,
  VIOLET_HOT,
  VIOLET_PALE,
} from './palette';
import { shadedMaterial } from './shading';
import { pulseU, vitalityU } from './uniforms';

// The crown: where every strand roots into the bell, and where the parent has
// dug in. From the rail it is a bullseye — two funnels of webbing converging
// on a violet body. Each brood is a knot in the net; when its brood dies its
// thread withers, and when a veil's last brood dies the whole veil dies back.

const SPOKES = 12;
const RING_FRACTIONS = [0.42, 0.72, 1];
const PER_VEIL = SPOKES + SPOKES * RING_FRACTIONS.length;
const FEEDERS = 14;

const exposeU = uniform(0); //  0 covered → 1 bare and blazing
const deathU = uniform(0);

type BroodKnot = { veil: number; slot: number; count: number; mesh: Object3D | null; health: number; targetHealth: number };
type Pulse = { spoke: number; offset: number };

export type Crown = ReturnType<typeof createCrown>;

export function createCrown(scene: Scene) {
  const root = new Group();
  root.matrixAutoUpdate = false;
  root.matrix.copy(JELLY_MATRIX);
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  // ---- the parent ---------------------------------------------------------------------
  const body = new Group();
  body.position.set(0, PARENT_Y, 0);
  // Model +Z faces the rail (jelly −Y); model +Y is screen-up (jelly +Z).
  body.rotation.x = Math.PI / 2;
  root.add(body);
  const parts = buildParent(body);

  // ---- the webbing --------------------------------------------------------------------
  const webMaterial = createAdditiveBasicMaterial({ color: 0xffffff, opacity: 0.9 });
  const cylinder = new CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  const web = new InstancedMesh(cylinder, webMaterial, PER_VEIL * VEILS.length + FEEDERS);
  web.frustumCulled = false;
  web.renderOrder = 7;
  web.count = 0;
  root.add(web);

  const pulseMesh = new InstancedMesh(
    new SphereGeometry(0.8, 6, 5),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    FEEDERS,
  );
  pulseMesh.frustumCulled = false;
  pulseMesh.renderOrder = 8;
  root.add(pulseMesh);
  const pulses: Pulse[] = Array.from({ length: FEEDERS }, (_, index) => ({ spoke: (index * 5) % SPOKES, offset: index / FEEDERS }));

  const knots: BroodKnot[][] = VEILS.map((veil) =>
    Array.from({ length: veil.broods }, (_, slot) => ({ veil: 0, slot, count: veil.broods, mesh: null, health: 1, targetHealth: 1 })));
  knots.forEach((list, veil) => list.forEach((knot) => { knot.veil = veil; }));
  const veilAlive = VEILS.map(() => 1); // 1 = fully strung, 0 = dead
  const veilTarget = VEILS.map(() => 1);
  let summonedAt = -1;
  let clock = 0;
  let grow = 0;
  let deathAge = -1;
  let state: 'idle' | 'covered' | 'exposed' | 'freed' = 'idle';
  let plateBreak = 0;
  let plateBreakTarget = 0;
  let heat = 0;

  const matrix = new Matrix4();
  const scale = new Vector3();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const direction = new Vector3();
  const color = new Color();
  const center = new Vector3(0, PARENT_Y, 0);

  function rimPoint(veilIndex: number, angle: number, target: Vector3) {
    const spec = VEILS[veilIndex];
    return target.set(Math.cos(angle) * spec.rx, spec.y, Math.sin(angle) * spec.rz);
  }

  function slotForSpoke(veilIndex: number, spoke: number) {
    const count = VEILS[veilIndex].broods;
    const step = SPOKES / count;
    return spoke % step === 0 ? spoke / step : -1;
  }

  function place(index: number, from: Vector3, to: Vector3, radius: number, shade: Color) {
    direction.copy(to).sub(from);
    const length = direction.length();
    if (length < 0.001) {
      scale.set(0.0001, 0.0001, 0.0001);
    } else {
      direction.multiplyScalar(1 / length);
      scale.set(radius, length, radius);
    }
    quaternion.setFromUnitVectors(up, direction.lengthSq() > 0 ? direction : up);
    matrix.compose(from, quaternion, scale);
    web.setMatrixAt(index, matrix);
    web.setColorAt(index, shade);
  }

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();

  function updateWeb(dt: number, elapsedSinceSummon: number) {
    let index = 0;
    for (let v = 0; v < VEILS.length; v += 1) {
      veilAlive[v] += (veilTarget[v] - veilAlive[v]) * Math.min(1, dt * 2.2);
      const orbit = elapsedSinceSummon * VEIL_SPIN[v];
      // While its wave hasn't hatched, a veil hangs dim; once broods feed it, it blazes.
      const feeding = knots[v].some((knot) => knot.mesh) ? 1 : 0.45;
      const healths: number[] = [];
      for (let s = 0; s < SPOKES; s += 1) {
        const slot = slotForSpoke(v, s);
        let health = 1;
        if (slot >= 0) {
          const knot = knots[v][slot];
          knot.health += (knot.targetHealth - knot.health) * Math.min(1, dt * 3);
          health = knot.health;
        } else {
          // Spokes between knots hold on until their neighbours die.
          const before = slotForSpoke(v, s - (s % (SPOKES / VEILS[v].broods)));
          const knot = knots[v][Math.max(0, before)];
          health = 0.35 + 0.65 * knot.health;
        }
        healths.push(health * veilAlive[v] * Math.min(1, grow * 1.4));
      }
      for (let s = 0; s < SPOKES; s += 1) {
        const angle = (s / SPOKES) * Math.PI * 2 + orbit + v * 0.4;
        rimPoint(v, angle, tmpB);
        const h = healths[s];
        tmpA.copy(center);
        tmpC.copy(center).lerp(tmpB, Math.max(0.0001, h));
        const wither = 1 - h;
        color.copy(SILK).multiplyScalar((0.32 + feeding * 0.4) * (1 - wither * 0.7)).lerp(SICK_MAGENTA, wither * 0.45);
        place(index, tmpA, tmpC, 0.36 + 0.14 * (slotForSpoke(v, s) >= 0 ? 1 : 0), color);
        index += 1;
      }
      for (let r = 0; r < RING_FRACTIONS.length; r += 1) {
        for (let s = 0; s < SPOKES; s += 1) {
          const hA = healths[s];
          const hB = healths[(s + 1) % SPOKES];
          const h = Math.min(hA, hB);
          const angleA = (s / SPOKES) * Math.PI * 2 + orbit + v * 0.4;
          const angleB = ((s + 1) / SPOKES) * Math.PI * 2 + orbit + v * 0.4;
          rimPoint(v, angleA, tmpA);
          rimPoint(v, angleB, tmpB);
          tmpA.sub(center).multiplyScalar(RING_FRACTIONS[r]).add(center);
          tmpB.sub(center).multiplyScalar(RING_FRACTIONS[r]).add(center);
          // A ring segment shortens toward its first spoke as either end weakens.
          tmpC.copy(tmpA).lerp(tmpB, Math.max(0.0001, h));
          color.copy(SILK).multiplyScalar((0.34 + feeding * 0.42) * h);
          place(index, tmpA, tmpC, 0.3, color);
          index += 1;
        }
      }
    }
    web.count = index;
    web.instanceMatrix.needsUpdate = true;
    if (web.instanceColor) web.instanceColor.needsUpdate = true;

    // Feeder pulses run from the parent out along the live spokes on the heartbeat.
    let pulseIndex = 0;
    for (const pulse of pulses) {
      const v = pulseIndex % VEILS.length;
      const spokeAngle = (pulse.spoke / SPOKES) * Math.PI * 2 + elapsedSinceSummon * VEIL_SPIN[v] + v * 0.4;
      rimPoint(v, spokeAngle, tmpB);
      const t = (clock * 0.55 + pulse.offset) % 1;
      const slot = slotForSpoke(v, pulse.spoke);
      const health = slot >= 0 ? knots[v][slot].health : 0.6;
      position.copy(center).lerp(tmpB, t * Math.max(0.05, health) * veilAlive[v]);
      scale.setScalar(Math.max(0.0001, (1 - Math.abs(t - 0.5) * 1.4) * 0.9 * veilAlive[v] * Math.min(1, grow * 1.4)));
      matrix.compose(position, quaternion.identity(), scale);
      pulseMesh.setMatrixAt(pulseIndex, matrix);
      pulseMesh.setColorAt(pulseIndex, color.copy(VIOLET_PALE).multiplyScalar(1.2 + pulseU.value));
      pulseIndex += 1;
    }
    pulseMesh.instanceMatrix.needsUpdate = true;
    if (pulseMesh.instanceColor) pulseMesh.instanceColor.needsUpdate = true;
  }

  return {
    root,
    body,
    get state() {
      return state;
    },
    /** How many veils have died back so far. */
    veilsDown() {
      return veilTarget.filter((value) => value === 0).length;
    },
    /** World position of the parent (for effects). */
    worldPosition(target = new Vector3()) {
      return target.set(0, PARENT_Y, 0).applyMatrix4(JELLY_MATRIX);
    },
    summon(runTime: number) {
      summonedAt = runTime;
      state = 'covered';
      grow = 0;
      veilTarget.fill(1);
      veilAlive.fill(1);
    },
    /** Called in hatch order; the first four are veil 0, the next six veil 1. */
    attachBrood(order: number, mesh: Object3D) {
      let remaining = order;
      for (const list of knots) {
        if (remaining < list.length) {
          list[remaining].mesh = mesh;
          list[remaining].targetHealth = 1;
          return { veil: knots.indexOf(list), slot: remaining };
        }
        remaining -= list.length;
      }
      return null;
    },
    broodDied(order: number) {
      let remaining = order;
      for (let v = 0; v < knots.length; v += 1) {
        const list = knots[v];
        if (remaining < list.length) {
          list[remaining].targetHealth = 0;
          list[remaining].mesh = null;
          // The veil dies once all its knots are cut.
          if (list.every((knot) => knot.targetHealth === 0)) veilTarget[v] = 0;
          return v;
        }
        remaining -= list.length;
      }
      return -1;
    },
    expose() {
      state = 'exposed';
      veilTarget.fill(0);
    },
    stageBreak() {
      plateBreakTarget = 1;
      heat = Math.min(1, heat + 0.5);
    },
    free() {
      state = 'freed';
      deathAge = 0;
      deathU.value = 0;
    },
    reset() {
      state = 'idle';
      summonedAt = -1;
      grow = 0;
      deathAge = -1;
      plateBreak = 0;
      plateBreakTarget = 0;
      heat = 0;
      deathU.value = 0;
      exposeU.value = 0;
      for (const list of knots) {
        for (const knot of list) {
          knot.mesh = null;
          knot.health = 1;
          knot.targetHealth = 1;
        }
      }
      veilAlive.fill(1);
      veilTarget.fill(1);
      web.count = 0;
      pulseMesh.count = 0;
      body.visible = false;
      web.visible = false;
      pulseMesh.visible = false;
      resetParts(parts);
    },
    update(dt: number, runTime: number) {
      clock += dt;
      const active = state !== 'idle';
      body.visible = active && !(state === 'freed' && deathAge > 0.5);
      web.visible = active && state !== 'freed';
      pulseMesh.visible = web.visible;
      if (!active) return;

      grow = Math.min(1, grow + dt * 0.8);
      const elapsed = Math.max(0, runTime - summonedAt);
      if (state !== 'freed') updateWeb(dt, elapsed);

      // Breath, heat, shudder.
      const exposed = state === 'exposed' ? 1 : 0;
      exposeU.value += (exposed - exposeU.value) * Math.min(1, dt * 2.5);
      heat += ((exposed ? 0.55 : 0.15) - heat) * Math.min(1, dt * 1.5);
      plateBreak += (plateBreakTarget - plateBreak) * Math.min(1, dt * 1.6);
      const breath = 1 + Math.sin(clock * (exposed ? 3.6 : 1.9)) * (exposed ? 0.045 : 0.025) + pulseU.value * 0.03;
      const appear = MathUtils.smoothstep(grow, 0, 0.5);
      body.scale.setScalar(breath * (0.6 + 0.4 * appear) * (state === 'freed' ? 1 + deathAge * 0.5 : 1));
      if (state === 'exposed') {
        body.position.set(Math.sin(clock * 23) * 0.09, PARENT_Y, Math.cos(clock * 19) * 0.08);
      } else {
        body.position.set(0, PARENT_Y, 0);
      }
      if (state === 'freed') {
        deathAge += dt;
        deathU.value = Math.min(1, deathAge * 2.2);
      }
      animateParent(parts, clock, plateBreak, exposeU.value, heat, state === 'freed' ? deathAge : 0);
    },
    dispose() {
      scene.remove(root);
      cylinder.dispose();
    },
  };
}

// ---- the body ------------------------------------------------------------------------------

type ParentParts = {
  plates: Group[];
  legs: Group[];
  core: Mesh;
  fangs: Group;
  eyes: Mesh;
  horns: Group;
};

const R = PARENT_RADIUS;

function buildParent(body: Group): ParentParts {
  // Sac: veined violet flesh under the shell; hot magenta once bare.
  const sacMaterial = new MeshBasicNodeMaterial({ fog: true });
  const p = positionLocal.mul(0.42);
  const veins = float(1).sub(mx_noise_float(p.mul(1.7).add(vec3(0, time.mul(0.1), 0))).abs().mul(2.4).clamp(0, 1)).max(0).pow(3.2);
  const flesh = vec3(VIOLET_DARK.r * 3.2, VIOLET_DARK.g * 2.4, VIOLET_DARK.b * 3);
  const vein = vec3(SICK_MAGENTA.r * 1.8, SICK_MAGENTA.g * 0.7, SICK_MAGENTA.b * 1.8);
  const gold = vec3(BELL_GOLD.r * 1.4, BELL_GOLD.g * 1.3, BELL_GOLD.b * 0.9);
  let sac = mix(flesh, vein, veins.mul(exposeU.mul(0.7).add(0.55)).mul(pulseU.mul(0.6).add(0.75)));
  sac = mix(sac, vec3(2.1, 0.55, 1.9).mul(veins.mul(0.7).add(0.3)), exposeU.mul(0.4));
  sac = mix(sac, gold, deathU);
  sacMaterial.colorNode = sac;
  const sacMesh = new Mesh(new SphereGeometry(1, 32, 22), sacMaterial);
  sacMesh.scale.set(R * 1.0, R * 0.94, R * 0.74);
  body.add(sacMesh);

  // Core: the hot heart in the throat; blazing once the plates are gone.
  const core = new Mesh(new SphereGeometry(2.7, 16, 12), createAdditiveBasicMaterial({ color: hdr(VIOLET_HOT, 1.0), opacity: 0.95 }));
  core.position.z = R * 0.38;
  body.add(core);
  // A dark pit around it so the glow has something to burn against.
  const pit = new Mesh(new SphereGeometry(4.3, 16, 10), new MeshBasicMaterial({ color: new Color(0.03, 0.005, 0.06) }));
  pit.position.z = R * 0.3;
  body.add(pit);

  // Carapace: two rings of overlapping plates, hinged around the maw.
  const shell = shadedMaterial(new Color(VIOLET_DARK).multiplyScalar(4.2), { ambient: 0.4, rim: hdr(VIOLET_PALE, 0.8), rimPower: 2.6 });
  const shellInner = shadedMaterial(new Color(VIOLET).multiplyScalar(0.62), { ambient: 0.4, rim: hdr(VIOLET_PALE, 0.9), rimPower: 2.4 });
  const plates: Group[] = [];
  const rings: Array<{ count: number; from: number; to: number; radius: number; material: MeshBasicNodeMaterial }> = [
    { count: 10, from: 0.62, to: 1.28, radius: R * 1.03, material: shell },
    { count: 6, from: 0.22, to: 0.66, radius: R * 1.1, material: shellInner },
  ];
  for (const ring of rings) {
    const geometry = new SphereGeometry(ring.radius, 10, 6, 0, (Math.PI * 2) / ring.count - 0.07, ring.from, ring.to - ring.from).rotateX(Math.PI / 2);
    for (let i = 0; i < ring.count; i += 1) {
      const holder = new Group();
      holder.rotation.z = (i / ring.count) * Math.PI * 2 + (ring.count === 6 ? Math.PI / 6 : 0);
      holder.userData.angle = holder.rotation.z + Math.PI / ring.count;
      holder.add(new Mesh(geometry, ring.material));
      body.add(holder);
      plates.push(holder);
    }
  }

  // Legs: three-jointed limbs gripping the roots, reaching out and away from the rail.
  const legs: Group[] = [];
  const legMaterial = shadedMaterial(new Color(VIOLET).multiplyScalar(0.7), { ambient: 0.35, rim: hdr(VIOLET_PALE, 0.7), rimPower: 2.4 });
  const clawMaterial = shadedMaterial(new Color(VIOLET_PALE).multiplyScalar(0.9), { ambient: 0.5, rim: hdr(SUN_WHITE, 0.5) });
  const seg1 = new CylinderGeometry(1.7, 1.1, 8, 8).translate(0, 4, 0).rotateZ(-Math.PI / 2);
  const seg2 = new CylinderGeometry(1.05, 0.6, 9, 8).translate(0, 4.5, 0).rotateZ(-Math.PI / 2);
  const joint = new SphereGeometry(1.7, 9, 7);
  const claw = new ConeGeometry(0.85, 4.2, 7).translate(0, 2.1, 0);
  for (let i = 0; i < 8; i += 1) {
    const hip = new Group();
    const angle = ((i + 0.5) / 8) * Math.PI * 2;
    hip.rotation.z = angle;
    hip.position.set(Math.cos(angle) * R * 0.78, Math.sin(angle) * R * 0.78, -1.5);
    const upper = new Mesh(seg1, legMaterial);
    const knee = new Group();
    knee.position.set(8, 0, 0);
    knee.rotation.y = 0.5; // the shin sweeps away from the rail
    knee.add(new Mesh(joint, legMaterial));
    const lower = new Mesh(seg2, legMaterial);
    knee.add(lower);
    const ankle = new Group();
    ankle.position.set(9, 0, 0);
    ankle.rotation.y = 0.55;
    ankle.add(new Mesh(joint, legMaterial));
    const tip = new Mesh(claw, clawMaterial);
    tip.rotation.z = -Math.PI / 2;
    ankle.add(tip);
    knee.add(ankle);
    hip.add(upper, knee);
    body.add(hip);
    legs.push(hip);
  }

  // Maw: a ring of fangs; and two great pale horns curving around it.
  const fangs = new Group();
  const fangGeometry = new ConeGeometry(0.62, 3.6, 6).rotateX(Math.PI / 2).translate(0, 0, 1.8);
  const fangMaterial = shadedMaterial(new Color(VIOLET_PALE).multiplyScalar(0.95), { ambient: 0.55, rim: hdr(SUN_WHITE, 0.5) });
  for (let i = 0; i < 9; i += 1) {
    const fang = new Mesh(fangGeometry, fangMaterial);
    const angle = (i / 9) * Math.PI * 2;
    fang.position.set(Math.cos(angle) * 3.8, Math.sin(angle) * 3.8, R * 0.42);
    fang.lookAt(fang.position.clone().add(new Vector3(-Math.cos(angle) * 0.42, -Math.sin(angle) * 0.42, 1)));
    fangs.add(fang);
  }
  body.add(fangs);

  const horns = new Group();
  const hornGeometry = new TorusGeometry(6.2, 0.95, 8, 22, Math.PI * 0.85);
  for (const side of [-1, 1]) {
    const horn = new Mesh(hornGeometry, fangMaterial);
    horn.rotation.z = side > 0 ? -Math.PI * 0.42 : Math.PI * 0.58;
    horn.rotation.x = 0.45;
    horn.position.set(side * 3.2, 1.2, R * 0.5);
    horns.add(horn);
  }
  body.add(horns);

  // Eyes: hot points on a brow, above the horns.
  const eyeGeometries: BufferGeometry[] = [];
  for (const [x, y, s] of [[-3.6, 6.6, 0.75], [3.6, 6.6, 0.75], [-6.1, 4.4, 0.55], [6.1, 4.4, 0.55], [0, 8, 0.5]] as const) {
    eyeGeometries.push(new SphereGeometry(s, 8, 6).translate(x, y, R * 0.5));
  }
  const eyes = new Mesh(mergeGeometries(eyeGeometries), new MeshBasicMaterial({ color: hdr(VIOLET_HOT, 2.1) }));
  body.add(eyes);
  for (const geometry of eyeGeometries) geometry.dispose();

  body.visible = false;
  return { plates, legs, core, fangs, eyes, horns };
}

function resetParts(parts: ParentParts) {
  for (const plate of parts.plates) {
    plate.position.set(0, 0, 0);
    plate.scale.setScalar(1);
    plate.visible = true;
  }
}

function animateParent(parts: ParentParts, clock: number, plateBreak: number, exposed: number, heat: number, deathAge: number) {
  parts.plates.forEach((holder, index) => {
    const angle = holder.userData.angle as number;
    // Plates lever open, tumble outward, and go.
    const open = MathUtils.smoothstep(plateBreak, 0, 1);
    holder.position.set(Math.cos(angle) * open * 9, Math.sin(angle) * open * 9, open * 3 + deathAge * 4);
    holder.rotation.x = open * 0.9;
    holder.scale.setScalar(Math.max(0.0001, 1 - MathUtils.smoothstep(plateBreak, 0.55, 1)));
    holder.visible = holder.scale.x > 0.01;
  });
  parts.legs.forEach((hip, index) => {
    const flex = Math.sin(clock * (1.1 + exposed * 3) + index * 1.3) * (0.05 + exposed * 0.08);
    hip.rotation.x = flex;
    hip.scale.setScalar(Math.max(0.0001, 1 - deathAge * 0.8));
  });
  const coreScale = 0.55 + heat * 0.85 + exposed * 0.5 + Math.sin(clock * 5) * 0.03 * (1 + exposed * 3);
  parts.core.scale.setScalar(coreScale);
  const material = parts.core.material as MeshBasicMaterial;
  material.color.copy(VIOLET_HOT).multiplyScalar(0.5 + heat * 1.6 + exposed * 0.9);
  parts.fangs.scale.setScalar(1 + Math.sin(clock * 2.3) * 0.06 + exposed * 0.12);
  void vitalityU;
}

void Float32BufferAttribute;

/** The parent's body on its own, for model snapshots. */
export function createParentModel() {
  const group = new Group();
  buildParent(group);
  group.visible = true;
  return group;
}
