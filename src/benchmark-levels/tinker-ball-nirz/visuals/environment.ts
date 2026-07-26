import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MultiplyBlending,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3, Scene } from 'three';
import { createAtmosphereRamp, scatterAlongRail } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { configureAdditiveMaterial } from '../../../engine/visual-kit';
import {
  BEAD,
  BUTTON,
  CARD,
  ERASER,
  LAMP,
  LAMP_HOT,
  PAINT,
  PAPER,
  PENCIL,
  STEEL,
  TABLE,
  TABLE_DARK,
  TABLE_LIGHT,
  WOOD,
  matte,
  glow,
} from './palette';
import {
  bead,
  createBlock,
  createButton,
  createCard,
  createClip,
  createEraser,
  createJar,
  createPaintPot,
  createPencil,
  createPin,
  createRuler,
  createSpool,
  shadowBlob,
  tiltRandomly,
} from './props';

// Leaf module: one wooden table, one lamp, and the clutter left on it. The
// three clutter tiers are modelled as three variants of the same scattered
// item; which one is showing depends on how far along the rail it sits, so the
// table's contents grow with the ball without any of it being rebuilt.

export const TABLE_Y = 0;

const TABLE_WIDTH = 460;
const TABLE_LENGTH = 760;
const TABLE_CENTER_Z = -300;
const CLUTTER_COUNT = 30;
const SHADOW_BAND_COUNT = 6;

export type TinkerEnvironment = {
  root: Group;
  update(cameraU: number, dt: number, cameraPosition: Vector3, beatEnergy: number): void;
  applyAtmosphere(progress: number): void;
  dispose(): void;
};

/** Wood grain painted into vertex colours: long streaks along the table, knots where they crowd. */
function createTableTop() {
  const geometry = new PlaneGeometry(TABLE_WIDTH, TABLE_LENGTH, 44, 96);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const tint = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    // Fine, low-contrast grain: at this camera height a coarse streak reads as
    // a lane in the road rather than as wood.
    const grain = Math.sin(x * 0.62 + Math.sin(z * 0.02) * 1.6) * 0.5 + 0.5;
    const coarse = Math.sin(x * 0.11 + 1.7) * 0.5 + 0.5;
    const knot = Math.max(0, 1 - Math.hypot((x - 46) * 0.02, (z + 180) * 0.008)) ** 2;
    tint.copy(TABLE)
      .lerp(TABLE_LIGHT, grain * 0.16 + coarse * 0.1)
      .lerp(TABLE_DARK, knot * 0.7 + grain * grain * 0.08);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const mesh = new Mesh(geometry, new MeshLambertMaterial({
    vertexColors: true,
    emissive: new Color(0x0d0904),
  }));
  mesh.position.set(0, TABLE_Y, TABLE_CENTER_Z);
  return mesh;
}

/** The scratch the ball follows, drawn as a lit groove one hair above the wood. */
function createScratchRoad(curve: CatmullRomCurve3, width: number, lateral: number, brightness: number) {
  const samples = 220;
  const vertices = new Float32Array(samples * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const frame = sampleRailFrame(curve, i / (samples - 1));
    const center = frame.position.clone().addScaledVector(frame.right, lateral);
    const wobble = 1 + Math.sin(i * 0.37) * 0.35 + Math.sin(i * 0.11) * 0.2;
    for (const side of [-1, 1]) {
      const offset = (i * 2 + (side > 0 ? 1 : 0)) * 3;
      vertices[offset] = center.x + frame.right.x * side * width * wobble;
      vertices[offset + 1] = TABLE_Y + 0.035;
      vertices[offset + 2] = center.z + frame.right.z * side * width * wobble;
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const material = configureAdditiveMaterial(new MeshBasicMaterial({ color: LAMP.clone().multiplyScalar(0.5) }), {
    opacity: brightness,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}

type ClutterTier = 'small' | 'medium' | 'large';

function createClutterVariant(tier: ClutterTier, index: number, rng: () => number): Group {
  const group = new Group();
  const pick = Math.floor(rng() * 4);
  if (tier === 'small') {
    // The marble stretch is the one the player sees closest to the wood, so
    // the small tier is deliberately the busiest: spilled beads and pins
    // everywhere rather than one tidy object per patch.
    if (pick === 0) {
      group.add(createButton(0.8, index % 2 === 0 ? BUTTON : BEAD));
      for (let i = 0; i < 3; i += 1) {
        const spill = bead(0.22, i % 2 === 0 ? PENCIL : PAPER);
        spill.position.set(Math.cos(i * 2.1) * 1.6, 0.22, Math.sin(i * 2.1) * 1.6);
        group.add(spill);
      }
    } else if (pick === 1) {
      const pin = createPin(2.6, STEEL, BUTTON);
      pin.rotation.z = Math.PI / 2 - 0.1;
      group.add(pin);
      const second = createPin(2.1, STEEL, BEAD);
      second.rotation.set(0, 0.9, Math.PI / 2 + 0.25);
      second.position.set(0.4, 0, 1.1);
      group.add(second);
    } else if (pick === 2) {
      for (let i = 0; i < 2; i += 1) {
        const clip = createClip(1.5 - i * 0.4, STEEL);
        clip.rotation.set(Math.PI / 2, i * 0.8, 0);
        clip.position.set(i * 1.3, 0.1, i * -0.9);
        group.add(clip);
      }
      group.add(bead(0.24, BUTTON));
    } else {
      for (let i = 0; i < 5; i += 1) {
        const item = createButton(0.42, i % 2 === 0 ? PENCIL : PAPER);
        item.position.set((i % 3 - 1) * 0.9, 0.1, (i < 3 ? 0 : 1) * 0.85);
        group.add(item);
      }
    }
    group.add(shadowBlob(1.6, 0.32));
  } else if (tier === 'medium') {
    if (pick === 0) {
      const spool = createSpool(1.6, 4.2, WOOD, BEAD);
      spool.position.y = 2.1;
      group.add(spool);
    } else if (pick === 1) {
      const eraser = createEraser(2.1, ERASER, PAPER);
      eraser.position.y = 0.7;
      group.add(eraser);
    } else if (pick === 2) {
      const pot = createPaintPot(1.5, 2.4, PAINT, PAPER);
      pot.position.y = 1.2;
      group.add(pot);
    } else {
      const block = createBlock(1.8, WOOD);
      block.position.y = 0.9;
      group.add(tiltRandomly(block, index * 0.7));
    }
    group.add(shadowBlob(3.2, 0.42));
  } else {
    if (pick === 0) {
      // A pencil cup: the tallest thing on the table, and the one that breaks
      // the horizon so the dark room above the wood is not empty.
      const cup = createPaintPot(2.6, 6.5, PAINT, WOOD);
      cup.position.y = 3.2;
      group.add(cup);
      for (let i = 0; i < 2; i += 1) {
        const pencil = createPencil(9, i === 0 ? PENCIL : ERASER, WOOD);
        pencil.position.set((i - 0.5) * 1.2, 5.4, i * 0.7);
        pencil.rotation.z = (i - 0.5) * 0.4;
        group.add(pencil);
      }
    } else if (pick === 1) {
      const jar = createJar(3.2, 9.5, PAPER, PAINT);
      jar.position.y = 4.75;
      group.add(jar);
    } else if (pick === 2) {
      const sheet = createCard(12, 8.5, CARD);
      sheet.rotation.x = -Math.PI / 2;
      sheet.rotation.z = rng() * 0.5;
      sheet.position.y = 0.35;
      group.add(sheet);
    } else {
      for (let i = 0; i < 2; i += 1) {
        const pencil = createPencil(11, i % 2 === 0 ? PENCIL : PAINT, WOOD);
        pencil.rotation.z = Math.PI / 2 - 0.06 * i;
        pencil.position.set(0, 0.3 + i * 0.5, i * 0.9 - 1.4);
        group.add(pencil);
      }
    }
    group.add(shadowBlob(8, 0.5));
  }
  return group;
}

function smoothstep(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Long soft bands of lamp shadow lying across the wood. */
function createShadowBand(rng: () => number) {
  const width = 24 + rng() * 60;
  const length = 60 + rng() * 140;
  const geometry = new PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);
  // Multiply blending ignores opacity and stacks multiplicatively, so bands
  // are kept few and pale: several overlapping darker ones would black the
  // table out entirely.
  const material = new MeshBasicMaterial({
    color: new Color().setScalar(0.93 - rng() * 0.06),
    transparent: true,
    opacity: 1,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = TABLE_Y + 0.012;
  mesh.rotation.y = rng() * 0.6 - 0.3;
  mesh.renderOrder = -3;
  return mesh;
}

export function createTinkerEnvironment(scene: Scene, curve: CatmullRomCurve3): TinkerEnvironment {
  const root = new Group();
  root.name = 'tinker-environment';
  scene.add(root);

  scene.background = new Color(0x0d0906);
  scene.fog = new FogExp2(0x140d07, 0.0142);

  // One warm key from the lamp, a cool bounce from the dark room, and just
  // enough ambient that black glue still separates from black background.
  root.add(new AmbientLight(0x241d2c, 0.4));
  root.add(new HemisphereLight(0x3a2a1a, 0x090604, 0.5));
  const key = new DirectionalLight(0xffd6a0, 1.55);
  key.position.set(70, 130, 55);
  root.add(key);
  const fill = new DirectionalLight(0x5d6c99, 0.2);
  fill.position.set(-90, 45, -70);
  root.add(fill);

  root.add(createTableTop());

  const roads = new Group();
  roads.add(createScratchRoad(curve, 0.85, 0, 0.2));
  roads.add(createScratchRoad(curve, 0.28, 2.2, 0.11));
  roads.add(createScratchRoad(curve, 0.2, -2.9, 0.1));
  root.add(roads);

  // The lamp is never in frame; what you see is its pool on the wood. Three
  // additive discs lying on the table, riding with the ball, so the run always
  // happens inside a warm circle with the rest of the desk falling off to dark.
  const lampPool = new Group();
  const poolWide = new Mesh(new CircleGeometry(96, 40), glow(LAMP, 0.03));
  const poolMid = new Mesh(new CircleGeometry(52, 32), glow(LAMP, 0.028));
  const poolHot = new Mesh(new CircleGeometry(22, 26), glow(LAMP_HOT, 0.026));
  for (const disc of [poolWide, poolMid, poolHot]) {
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = -1;
    lampPool.add(disc);
  }
  lampPool.position.y = TABLE_Y + 0.05;
  root.add(lampPool);

  // Rail-relative placement is measured from the rail, and the rail climbs away
  // from the wood as the ball grows — so anything that belongs on the table has
  // to cancel the rail's height explicitly.
  const tableDrop = (u: number) => TABLE_Y - curve.getPointAt(MathUtils.clamp(u, 0, 1)).y;

  const shadowRng = mulberry32(0x5eed);
  const shadowBands = scatterAlongRail(curve, {
    count: SHADOW_BAND_COUNT,
    seed: 0x51a0,
    alignToRail: false,
    place: (_index, rng) => {
      const u = rng();
      return { u, offset: new Vector3((rng() - 0.5) * 150, tableDrop(u), 0) };
    },
    make: () => createShadowBand(shadowRng),
    window: { behind: 60, ahead: 240 },
  });
  root.add(shadowBands.group);

  const clutter = scatterAlongRail(curve, {
    count: CLUTTER_COUNT,
    seed: 0xb17e,
    alignToRail: false,
    place: (_index, rng) => {
      const side = rng() < 0.5 ? -1 : 1;
      const u = rng();
      return {
        u,
        // Close enough to the route to crowd the frame at marble scale, far
        // enough out that it never sits between the camera and a lockable
        // target — `check:occlusion` is the gate on that second half.
        offset: new Vector3(side * (10 + rng() * 84), tableDrop(u), 0),
      };
    },
    make: (index, rng) => {
      const item = new Group();
      const small = createClutterVariant('small', index, rng);
      const medium = createClutterVariant('medium', index, rng);
      const large = createClutterVariant('large', index, rng);
      item.add(small, medium, large);
      item.userData.tiers = [small, medium, large];
      return item;
    },
    window: { behind: 38, ahead: 116 },
    onUpdate: (item) => {
      const tiers = item.object.userData.tiers as Group[];
      const tier = item.u < 0.3 ? 0 : item.u < 0.62 ? 1 : 2;
      for (let i = 0; i < tiers.length; i += 1) tiers[i].visible = i === tier;
    },
  });
  root.add(clutter.group);

  // Fixed landmarks: the rest of the desk, too big to ever be picked up.
  const landmarks = new Group();
  const landmarkPlan: Array<[number, number, ClutterTier]> = [
    [0.14, -140, 'large'], [0.38, 175, 'large'], [0.64, -195, 'large'], [0.88, 160, 'large'],
  ];
  const landmarkRng = mulberry32(0x1a11);
  for (const [u, lateral, tier] of landmarkPlan) {
    const frame = sampleRailFrame(curve, u);
    const item = createClutterVariant(tier, Math.floor(landmarkRng() * 7), landmarkRng);
    item.scale.setScalar(2.4 + landmarkRng() * 1.8);
    item.position.copy(frame.position).addScaledVector(frame.right, lateral);
    item.position.y = TABLE_Y;
    landmarks.add(item);
  }
  root.add(landmarks);

  const applyAtmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: 0x0d0906, fog: 0x140d07, density: 0.0142 },
    { progress: 0.36, background: 0x100b07, fog: 0x191008, density: 0.0122 },
    { progress: 0.66, background: 0x140d07, fog: 0x1f1409, density: 0.0104 },
    { progress: 1, background: 0x181008, fog: 0x28180a, density: 0.0086 },
  ]);

  let lampPulse = 0;

  return {
    root,
    update(cameraU, dt, cameraPosition, beatEnergy) {
      clutter.update(cameraU, dt);
      shadowBands.update(cameraU, dt);
      lampPulse += (beatEnergy - lampPulse) * Math.min(1, dt * 6);
      // The pool sits a little ahead of the ball: the route always runs into
      // the light rather than out of it.
      lampPool.position.x = cameraPosition.x;
      lampPool.position.z = cameraPosition.z - 62;
      // Over the last stretch the pool opens out: the ball coasts off the
      // cluttered part of the desk onto clean, fully lit wood.
      const clean = smoothstep((cameraU - 0.9) / 0.1);
      poolHot.scale.setScalar(1 + lampPulse * 0.1 + clean * 1.9);
      poolMid.scale.setScalar(1 + lampPulse * 0.05 + clean * 0.75);
      poolWide.scale.setScalar(1 + clean * 0.3);
    },
    applyAtmosphere,
    dispose() {
      clutter.dispose();
      shadowBands.dispose();
      root.removeFromParent();
    },
  };
}
