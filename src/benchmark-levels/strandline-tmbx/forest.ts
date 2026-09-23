import { Vector3 } from 'three';
import { mulberry32 } from '../../engine/rng';
import { HOST_STRANDS } from './gameplay';
import { STRANDLINE_DURATION, bar } from './timing';
import {
  BELL_MARGIN_Y,
  BELL_RADIUS,
  cameraFrameAt,
  hostRootFor,
  strandClearance,
  strandPointAt,
  strandRootY,
  strandTipY,
  type StrandSpec,
} from './world';

// Which strands exist. The forest is composed once, deterministically, from
// the rail and the parasites' host strands; the visuals grow it and the
// score listens to it (the rail threads close past strands, and each close
// pass is a soft whoosh panned to its side).

const RAIL_CLEARANCE = 4.2;
const ARM_CLEARANCE = 11;

// ---- which strands exist --------------------------------------------------------------

function randomSpec(rng: () => number, root: { rootRadius: number; rootAngle: number }, anchorY: number, kind: 'tentacle' | 'arm' = 'tentacle'): StrandSpec {
  const spec: StrandSpec = {
    kind,
    rootRadius: root.rootRadius,
    rootAngle: root.rootAngle,
    length: 0,
    anchorY,
    wobbleA: (kind === 'arm' ? 5 : 1.5) + rng() * (kind === 'arm' ? 5 : 3.5),
    wobbleB: (kind === 'arm' ? 4 : 1.2) + rng() * (kind === 'arm' ? 4 : 3),
    wobbleK: (kind === 'arm' ? 0.03 : 0.015) + rng() * 0.025,
    curlA: (kind === 'arm' ? 1.5 : 0.4) + rng() * (kind === 'arm' ? 1.5 : 1.1),
    curlK: 0.1 + rng() * 0.14,
    thickness: kind === 'arm' ? 1.7 + rng() * 0.5 : 0.24 + rng() ** 2 * 0.5,
    seed: rng(),
    infections: [],
  };
  const rootY = strandRootY(spec);
  spec.length = kind === 'arm' ? 150 + rng() * 60 : rootY - (-130 - rng() * 90);
  if (kind === 'tentacle' && rng() < 0.22) spec.length *= 0.45 + rng() * 0.35;
  return spec;
}

function composeForest() {
  const rng = mulberry32(0x5eed1e);
  const specs: StrandSpec[] = [];
  const hosts: boolean[] = [];

  // Hosts first: their indices must match gameplay's HOST_STRANDS.
  for (const host of HOST_STRANDS) {
    specs.push(host);
    hosts.push(true);
  }

  const accept = (spec: StrandSpec, gap = RAIL_CLEARANCE) => {
    if (strandClearance(spec) < gap + spec.thickness) return false;
    specs.push(spec);
    hosts.push(false);
    return true;
  };

  // The forest the rail threads: strands placed around the authored camera
  // frame, close enough to pass within arm's reach, far enough to never touch.
  for (let t = 0.2; t < STRANDLINE_DURATION - 21; t += 0.3) {
    const frame = cameraFrameAt(t);
    const tries = 2;
    for (let n = 0; n < tries; n += 1) {
      const side = rng() < 0.5 ? -1 : 1;
      const point = frame.position.clone()
        .addScaledVector(frame.forward, 10 + rng() * 42)
        .addScaledVector(frame.right, side * (5.5 + rng() ** 1.4 * 30))
        .addScaledVector(frame.up, -6 + rng() * 16);
      const root = hostRootFor(point);
      if (!root) continue;
      accept(randomSpec(rng, root, point.y));
    }
  }

  // Deep fill across the whole animal.
  for (let i = 0; i < 70; i += 1) {
    const rootRadius = BELL_RADIUS * Math.sqrt(0.04 + rng() * 0.96);
    accept(randomSpec(rng, { rootRadius, rootAngle: rng() * Math.PI * 2 }, BELL_MARGIN_Y - rng() * 200));
  }

  // The marginal curtain: fine tentacles all the way round the rim — what
  // you see hanging under the bell when the rail swings out.
  for (let i = 0; i < 84; i += 1) {
    const rootAngle = (i / 84) * Math.PI * 2 + rng() * 0.05;
    const spec = randomSpec(rng, { rootRadius: BELL_RADIUS * (0.95 + rng() * 0.05), rootAngle }, BELL_MARGIN_Y - rng() * 150);
    spec.thickness *= 0.8;
    accept(spec);
  }

  // Four frilled oral arms from the centre.
  for (let i = 0; i < 4; i += 1) {
    const rootAngle = (i / 4) * Math.PI * 2 + 0.6;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (accept(randomSpec(rng, { rootRadius: 7 + rng() * 5, rootAngle: rootAngle + attempt * 0.2 }, BELL_MARGIN_Y - 40, 'arm'), ARM_CLEARANCE)) break;
    }
  }

  return { specs, hosts };
}

let forest: { specs: StrandSpec[]; hosts: boolean[] } | null = null;

export function strandForest() {
  forest ??= composeForest();
  return forest;
}

export type StrandPass = { time: number; pan: number; closeness: number };

let passes: StrandPass[] | null = null;

/**
 * Moments the authored camera threads past a strand within arm's reach,
 * through the forest sections, with the side it passes on.
 */
export function strandPasses() {
  if (passes) return passes;
  const { specs } = strandForest();
  const found: StrandPass[] = [];
  const reach = 7.5;
  const step = 0.05;
  const point = new Vector3();
  const last = new Map<number, { distance: number; falling: boolean }>();
  for (let t = 0; t < bar(14.5); t += step) {
    const frame = cameraFrameAt(t);
    const eye = frame.position;
    specs.forEach((spec, index) => {
      if (eye.y > strandRootY(spec) || eye.y < strandTipY(spec)) return;
      strandPointAt(spec, eye.y, point);
      const distance = Math.hypot(point.x - eye.x, point.z - eye.z);
      const previous = last.get(index);
      if (previous && previous.falling && distance > previous.distance && previous.distance < reach) {
        const side = point.sub(eye).dot(frame.right);
        found.push({ time: t - step, pan: Math.max(-0.85, Math.min(0.85, side / 5)), closeness: 1 - previous.distance / reach });
      }
      last.set(index, { distance, falling: !previous || distance < previous.distance });
    });
  }
  found.sort((a, b) => a.time - b.time);
  // Thin to a breath at a time: a pass every so often, not a hiss.
  passes = [];
  for (const pass of found) {
    const prior = passes[passes.length - 1];
    if (prior && pass.time - prior.time < 0.32) {
      if (pass.closeness > prior.closeness) passes[passes.length - 1] = pass;
      continue;
    }
    passes.push(pass);
  }
  return passes;
}
