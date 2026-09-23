import {
  Color,
  Euler,
  Group,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Family } from '../gameplay';
import { PIECE_RADIUS, type PieceType } from './pieces';
import type { Recipe } from './recipes';

// Leaf: glue-monster rigs. A rig is a target root (the black glue core the
// runner positions) plus a list of supply parts whose local transforms are
// animated here and drawn by the shared piece instancer. Recipes and colours
// come in from the spine; this file only assembles and moves them.

export type RigRole =
  | 'shell'
  | 'body'
  | 'head'
  | 'hat'
  | 'leg'
  | 'antenna'
  | 'wing'
  | 'beak'
  | 'tail'
  | 'layer';

export type RigPart = {
  type: PieceType;
  tint: Color;
  role: RigRole;
  index: number;
  side: number;
  scale: Vector3;
  bind: Matrix4;
  local: Matrix4;
  slot: number;
  layer: number;
  /** World start point for the assembly hop. */
  from: Vector3;
  delay: number;
  extra: number;
};

export type Rig = {
  root: Group;
  core: Mesh;
  drips: Mesh[];
  family: Family | 'core' | 'heart';
  scale: number;
  parts: RigPart[];
  legAxis?: Vector3;
  legThickness: number;
};

const sphere = new SphereGeometry(1, 20, 14);
const dripGeometry = new SphereGeometry(1, 10, 8);

const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

function compose(target: Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: Vector3) {
  return target.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), scale);
}

function pick<T>(list: T[], seed: number) {
  return list[Math.abs(Math.floor(seed)) % list.length];
}

function makePart(type: PieceType, tint: Color, role: RigRole, scale: Vector3, index = 0, side = 0, layer = 0): RigPart {
  return {
    type,
    tint: tint.clone(),
    role,
    index,
    side,
    scale,
    bind: new Matrix4(),
    local: new Matrix4(),
    slot: -1,
    layer,
    from: new Vector3(),
    delay: 0,
    extra: 0,
  };
}

export function createRig(options: {
  family: Family;
  recipe: Recipe;
  scale: number;
  seed: number;
  coreMaterial: Material;
  dripMaterial: Material;
}): Rig {
  const { family, recipe, scale: S, seed } = options;
  const root = new Group();
  const core = new Mesh(sphere, options.coreMaterial);
  core.scale.setScalar(recipe.coreRadius * S);
  root.add(core);
  const drips: Mesh[] = [];
  const dripCount = family === 'snapper' ? 1 : 2;
  for (let i = 0; i < dripCount; i += 1) {
    const drip = new Mesh(dripGeometry, options.dripMaterial);
    drip.scale.set(0.16 * S, 0.3 * S, 0.16 * S);
    drip.position.set((i - (dripCount - 1) / 2) * 0.28 * S, -recipe.coreRadius * S * 0.9, 0.05 * S);
    drip.userData.baseY = drip.position.y;
    root.add(drip);
    drips.push(drip);
  }
  const parts: RigPart[] = [];
  const sv = (x: number, y = x, z = x) => new Vector3(x, y, z).multiplyScalar(S);

  if (family === 'beetle') {
    const shell = recipe.shell!;
    const shellTint = pick(shell.tints, seed * 7);
    for (const side of [-1, 1]) {
      const p = makePart(shell.type, shellTint, 'shell', sv(shell.scale), 0, side);
      parts.push(p);
    }
    if (recipe.body) {
      const b = recipe.body;
      parts.push(makePart(b.type, pick(b.tints, seed * 3), 'body', b.scale.clone().multiplyScalar(S)));
    }
    const head = recipe.head!;
    parts.push(makePart(head.type, pick(head.tints, seed * 5), 'head', sv(head.scale)));
    const legs = recipe.legs!;
    const legTint = pick(legs.tints, seed * 11);
    for (let i = 0; i < 6; i += 1) {
      const side = i < 3 ? -1 : 1;
      const legScale = legScaleFor(legs.type, legs.axis, legs.length, legs.thickness, S);
      parts.push(makePart(legs.type, legTint, 'leg', legScale, i % 3, side));
    }
    if (recipe.antennae) {
      const a = recipe.antennae;
      for (const side of [-1, 1]) parts.push(makePart(a.type, pick(a.tints, seed * 13), 'antenna', sv(a.scale), 0, side));
    }
  } else if (family === 'strider') {
    const hat = recipe.hat!;
    parts.push(makePart(hat.type, pick(hat.tints, seed * 7), 'hat', sv(hat.scale)));
    const body = recipe.body!;
    parts.push(makePart(body.type, pick(body.tints, seed * 3), 'body', body.scale.clone().multiplyScalar(S)));
    const legs = recipe.legs!;
    for (let i = 0; i < 4; i += 1) {
      parts.push(makePart(legs.type, pick(legs.tints, seed * 5 + i), 'leg', sv(1), i, i % 2 === 0 ? -1 : 1));
    }
  } else {
    const body = recipe.body!;
    parts.push(makePart(body.type, pick(body.tints, seed * 3), 'body', body.scale.clone().multiplyScalar(S)));
    const wings = recipe.wings!;
    const wingTint = pick(wings.tints, seed * 7);
    for (const side of [-1, 1]) parts.push(makePart(wings.type, wingTint, 'wing', wings.scale.clone().multiplyScalar(S), 0, side));
    const beak = recipe.beak!;
    const beakTint = pick(beak.tints, seed * 5);
    for (const side of [-1, 1]) parts.push(makePart(beak.type, beakTint, 'beak', sv(beak.scale), 0, side));
    const tail = recipe.tail!;
    parts.push(makePart(tail.type, pick(tail.tints, seed * 9), 'tail', sv(tail.scale)));
  }

  const rig: Rig = {
    root,
    core,
    drips,
    family,
    scale: S,
    parts,
    legAxis: recipe.legs?.axis,
    legThickness: recipe.legs?.thickness ?? 1,
  };
  poseRig(rig, recipe, { time: 0, dash: 0, gait: 0, flap: 0, height: 6 * S, snap: 0, heading: 0 });
  return rig;
}

function legScaleFor(type: PieceType, axis: Vector3, length: number, thickness: number, S: number) {
  const nominal = PIECE_RADIUS[type] * 2;
  const along = (length * S) / nominal;
  const t = thickness * S * 0.5;
  if (Math.abs(axis.x) > 0.5) return new Vector3(along, t, t);
  return new Vector3(t, along, t);
}

export type PoseInput = {
  time: number;
  /** 1 at the start of a beetle dash, decaying to 0. */
  dash: number;
  /** Continuous beat count for striders. */
  gait: number;
  /** Continuous beat count for snappers. */
  flap: number;
  /** Root height above the table. */
  height: number;
  /** 1 on the snap, decaying. */
  snap: number;
  heading: number;
};

/** Animate a rig's parts into their local poses. */
export function poseRig(rig: Rig, recipe: Recipe, input: PoseInput) {
  const S = rig.scale;
  const r = recipe.coreRadius * S;
  for (const part of rig.parts) {
    switch (part.role) {
      case 'shell': {
        // Wing-cases hang either side of the glue core — the core rides on
        // top where it can be seen and shot — flicking up on each dash.
        const open = 0.5 + input.dash * 0.5;
        compose(part.local, part.side * (r + 0.3 * S), -r * 0.25 + input.dash * 0.1 * S, -0.1 * S, 0.1, part.side * 0.12, -part.side * open, part.scale);
        break;
      }
      case 'body': {
        if (rig.family === 'beetle') {
          compose(part.local, 0, -0.32 * S, -0.55 * S, Math.PI / 2, 0, 0, part.scale);
        } else if (rig.family === 'strider') {
          compose(part.local, 0, -r * 1.35, 0, 0, input.time * 0.8, 0, part.scale);
        } else {
          compose(part.local, 0, -0.04 * S, -r * 1.35, 0, 0, 0, part.scale);
        }
        break;
      }
      case 'head':
        compose(part.local, 0, 0.02 * S + Math.sin(input.time * 9) * 0.03 * S, r + 0.42 * S, 0, input.dash * 0.2, 0, part.scale);
        break;
      case 'antenna': {
        const wave = Math.sin(input.time * 7 + part.side) * 0.15;
        compose(part.local, part.side * 0.16 * S, 0.3 * S, r + 0.72 * S, -0.9 + wave, 0, -part.side * 0.35, part.scale);
        break;
      }
      case 'hat':
        compose(part.local, 0, r * 1.05, 0, 0.1 * Math.sin(input.gait * Math.PI), input.time * 0.5, 0.1 * Math.cos(input.gait * Math.PI), part.scale);
        break;
      case 'leg':
        if (rig.family === 'beetle') poseBeetleLeg(rig, part, input, r);
        else poseStriderLeg(rig, part, input, r);
        break;
      case 'wing': {
        // Hinged at the core: flap on the beat, a fast downstroke.
        const beat = input.flap % 1;
        const stroke = Math.sin(Math.PI * 2 * (beat * 2)) * 0.75;
        const hinge = part.side * r * 0.8;
        _q2.setFromAxisAngle(Z, part.side * (0.15 + stroke));
        _v2.set(part.side * part.scale.x * 0.52, 0, 0).applyQuaternion(_q2);
        part.local.compose(_v.set(hinge + _v2.x, _v2.y + 0.05 * S, -0.1 * S), _q2, part.scale);
        break;
      }
      case 'beak': {
        // Clothespin jaws, hinged behind the core front, snapping on the beat.
        const open = 0.08 + (1 - input.snap) * 0.42;
        const jawLength = part.scale.x * 0.75;
        _q2.setFromEuler(_e.set(0, -Math.PI / 2, 0));
        _q.setFromAxisAngle(_v2.set(1, 0, 0), -part.side * open);
        _q.multiply(_q2);
        _v2.set(jawLength, 0, 0).applyQuaternion(_q);
        part.local.compose(_v.set(0, part.side * 0.05 * S + _v2.y, r * 0.55 + _v2.z), _q, part.scale);
        break;
      }
      case 'tail': {
        const sway = Math.sin(input.time * 5) * 0.25;
        compose(part.local, 0, 0.06 * S, -r * 1.35 - 0.95 * S, 0.25, Math.PI / 4 + sway, 0, part.scale);
        break;
      }
      case 'layer':
        break;
    }
  }
  for (const drip of rig.drips) {
    const base = drip.userData.baseY as number;
    const stretch = 1 + Math.sin(input.time * 3.1 + drip.position.x * 3) * 0.25;
    drip.scale.y = 0.3 * S * stretch;
    drip.position.y = base - (stretch - 1) * 0.15 * S;
  }
}

function poseBeetleLeg(rig: Rig, part: RigPart, input: PoseInput, r: number) {
  const S = rig.scale;
  const axis = rig.legAxis ?? Y;
  // Tripod gait: legs 0/2 on one side swing with leg 1 on the other.
  const z = (part.index - 1) * 0.42 * S;
  const phase = (part.index + (part.side > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1;
  const swing = Math.sin(input.time * 26) * 0.45 * input.dash * phase;
  _v2.set(part.side * 0.85, -0.62, (part.index - 1) * 0.35).normalize();
  _v2.applyAxisAngle(Y, swing);
  const length = partLength(part, axis);
  _q.setFromUnitVectors(axis, _v2);
  _v.set(part.side * r * 0.7, -r * 0.2, z).addScaledVector(_v2, length * 0.5);
  part.local.compose(_v, _q, part.scale);
}

function poseStriderLeg(rig: Rig, part: RigPart, input: PoseInput, r: number) {
  const S = rig.scale;
  const axis = rig.legAxis ?? Y;
  const H = Math.max(1.5 * S, input.height);
  // Diagonal pairs step on alternate beats; each foot slides back while
  // planted and swings forward in the air.
  const corner = [[-1, 1], [1, 1], [-1, -1], [1, -1]][part.index];
  const pair = part.index === 0 || part.index === 3 ? 0 : 1;
  const beat = input.gait + pair * 0.5;
  const f = beat - Math.floor(beat);
  const stride = 0.22 * H;
  const swingPhase = f < 0.45 ? f / 0.45 : 1;
  const along = f < 0.45 ? -stride + swingPhase * 2 * stride : stride - ((f - 0.45) / 0.55) * 2 * stride;
  const lift = f < 0.45 ? Math.sin(Math.PI * swingPhase) * 0.12 * H : 0;
  const spread = 0.42 * H;
  const hip = _v.set(corner[0] * r * 0.6, -r * 0.4, corner[1] * r * 0.6);
  const foot = _v2.set(corner[0] * spread * 0.8, -H + lift, corner[1] * spread * 0.65 + along);
  const dir = foot.sub(hip);
  const length = dir.length();
  dir.divideScalar(length);
  _q.setFromUnitVectors(axis, dir);
  // Stretch the stilt to reach the table.
  const nominal = PIECE_RADIUS[part.type] * 2;
  const along2 = length / nominal;
  const t = rig.legThickness * S * 0.5;
  if (Math.abs(axis.x) > 0.5) part.scale.set(along2, t, t);
  else part.scale.set(t, along2, t);
  const center = hip.clone().addScaledVector(dir, length * 0.5);
  part.local.compose(center, _q, part.scale);
}

function partLength(part: RigPart, axis: Vector3) {
  const nominal = PIECE_RADIUS[part.type] * 2;
  return nominal * (Math.abs(axis.x) > 0.5 ? part.scale.x : part.scale.y);
}

/** Spill cores: a big glue core wrapped in recycled layers of supplies. */
export function createSpillRig(options: {
  kind: 'core' | 'heart';
  coreRadius: number;
  layers: Array<Array<{ type: PieceType; scale: number; count: number }>>;
  tints: Color[];
  seed: number;
  coreMaterial: Material;
  dripMaterial: Material;
}): Rig {
  const root = new Group();
  const core = new Mesh(sphere, options.coreMaterial);
  core.scale.setScalar(options.coreRadius);
  root.add(core);
  const drips: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const drip = new Mesh(dripGeometry, options.dripMaterial);
    const angle = (i / 4) * Math.PI * 2 + options.seed;
    drip.scale.set(0.35, 0.8, 0.35).multiplyScalar(options.coreRadius / 2.4);
    drip.position.set(Math.cos(angle) * options.coreRadius * 0.55, -options.coreRadius * 0.85, Math.sin(angle) * options.coreRadius * 0.55);
    drip.userData.baseY = drip.position.y;
    root.add(drip);
    drips.push(drip);
  }
  const parts: RigPart[] = [];
  options.layers.forEach((layer, layerIndex) => {
    const shellRadius = options.coreRadius * (layerIndex === 0 ? 1.75 : 1.4);
    let n = 0;
    const total = layer.reduce((sum, entry) => sum + entry.count, 0);
    for (const entry of layer) {
      for (let i = 0; i < entry.count; i += 1) {
        const tint = options.tints[(n * 7 + layerIndex * 3 + Math.floor(options.seed * 10)) % options.tints.length];
        const part = makePart(entry.type, tint, 'layer', new Vector3(entry.scale, entry.scale, entry.scale), n, 0, layerIndex);
        // Spread over a sphere (Fibonacci), each piece leaning outward.
        const k = (n + 0.5) / total;
        const polar = Math.acos(1 - 2 * k);
        const azimuth = n * 2.39996 + options.seed + layerIndex;
        const normal = new Vector3(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth));
        const position = normal.clone().multiplyScalar(shellRadius);
        const rotation = new Quaternion().setFromUnitVectors(Y, normal);
        rotation.multiply(new Quaternion().setFromAxisAngle(Y, azimuth * 1.7));
        part.bind.compose(position, rotation, part.scale);
        part.local.copy(part.bind);
        parts.push(part);
        n += 1;
      }
    }
  });
  return { root, core, drips, family: options.kind, scale: 1, parts, legThickness: 1 };
}

/** Spill layers breathe and turn; bare cores tremble. */
export function poseSpillRig(rig: Rig, time: number) {
  _m.makeRotationY(time * 0.4);
  for (const part of rig.parts) {
    const breathe = 1 + Math.sin(time * 2.2 + part.index) * 0.035;
    _s.setScalar(breathe);
    part.local.copy(_m).multiply(part.bind).scale(_s);
  }
  for (const drip of rig.drips) {
    const base = drip.userData.baseY as number;
    const stretch = 1 + Math.sin(time * 2.4 + drip.position.x) * 0.3;
    drip.position.y = base - stretch * 0.4;
  }
}
