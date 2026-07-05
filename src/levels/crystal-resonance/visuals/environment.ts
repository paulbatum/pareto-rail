import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineSegments,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, positionView, positionWorld, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { createCrystalRail } from '../gameplay';
import { AMBER, BACKGROUND, CYAN, MAGENTA, mulberry32 } from './palette';

const RING_COUNT = 220;
const RING_SIDES = 8;
const TUNNEL_RADIUS = 11;

// Shared beat energy, written by the beat handler, read by tunnel shaders.
export const beatUniform = uniform(0);

export type Environment = {
  root: Group;
  debris: Array<{ lines: LineSegments; spin: Vector3 }>;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = BACKGROUND;
  const root = new Group();
  const rng = mulberry32(20260703);
  const curve = createCrystalRail();

  // --- Wireframe tunnel: octagonal ribs along the rail + longitudinal rails,
  // one merged LineSegments. Vertex colors carry the palette; the node
  // material adds traveling energy pulses, beat glow, and distance falloff.
  const positions: number[] = [];
  const colors: number[] = [];
  const ringVertices: Vector3[][] = [];

  for (let i = 0; i < RING_COUNT; i += 1) {
    const u = i / (RING_COUNT - 1);
    const frame = sampleRailFrame(curve, u);
    const twist = u * 2.2;
    const radius = TUNNEL_RADIUS * (0.92 + 0.16 * Math.sin(u * 21));
    const ring: Vector3[] = [];
    for (let s = 0; s < RING_SIDES; s += 1) {
      const angle = (s / RING_SIDES) * Math.PI * 2 + twist;
      ring.push(
        frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(angle) * radius)
          .addScaledVector(frame.up, Math.sin(angle) * radius),
      );
    }
    ringVertices.push(ring);
  }

  const pushSegment = (a: Vector3, b: Vector3, color: Color, intensity: number) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let k = 0; k < 2; k += 1) {
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    }
  };

  for (let i = 0; i < RING_COUNT; i += 1) {
    const ring = ringVertices[i];
    // Every ring is drawn, but only some are "hot"; occasional magenta/amber
    // ribs break the cyan monotony the way the concept art does.
    const roll = rng();
    const ringColor = roll < 0.72 ? CYAN : roll < 0.9 ? MAGENTA : AMBER;
    const hot = i % 5 === 0;
    for (let s = 0; s < RING_SIDES; s += 1) {
      pushSegment(ring[s], ring[(s + 1) % RING_SIDES], ringColor, hot ? 0.85 : 0.3);
    }
    if (i > 0) {
      const previous = ringVertices[i - 1];
      for (let s = 0; s < RING_SIDES; s += 2) {
        pushSegment(previous[s], ring[s], CYAN, 0.28);
      }
    }
  }

  const tunnelGeometry = new BufferGeometry();
  tunnelGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  tunnelGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const tunnelMaterial = new LineBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const viewDistance = positionView.z.negate();
  const travelingPulse = positionWorld.z
    .mul(0.075)
    .add(time.mul(-5.2))
    .sin()
    .mul(0.5)
    .add(0.5)
    .pow(6)
    .mul(1.6);
  tunnelMaterial.colorNode = attribute<'vec3'>('color', 'vec3')
    .mul(travelingPulse.add(0.55).add(beatUniform.mul(0.85)))
    .mul(viewDistance.mul(-0.011).exp())
    .mul(smoothstep(float(1.5), float(8), viewDistance));

  const tunnel = new LineSegments(tunnelGeometry, tunnelMaterial);
  tunnel.frustumCulled = false;
  root.add(tunnel);

  // --- Starfield: a wide shell of dim points with a few HDR accents that
  // bloom into twinkles.
  root.add(makeStars(rng, 1400, 45, 190, 0.55));
  // --- Dust inside the tunnel: close, small, sells camera speed.
  root.add(makeStars(rng, 500, 3, 9.5, 0.16));

  // --- Drifting wireframe debris outside the tunnel for parallax depth.
  const debris: Array<{ lines: LineSegments; spin: Vector3 }> = [];
  for (let i = 0; i < 20; i += 1) {
    const u = (i + 0.5) / 20;
    const frame = sampleRailFrame(curve, u);
    const geometry = new EdgesGeometry(new IcosahedronGeometry(2.2 + rng() * 4, 0));
    const roll = rng();
    const color = (roll < 0.55 ? CYAN : roll < 0.85 ? MAGENTA : AMBER).clone().multiplyScalar(0.34);
    const lines = new LineSegments(
      geometry,
      new LineBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    (lines.material as LineBasicNodeMaterial).colorNode = vec3(color.r, color.g, color.b)
      .mul(positionView.z.negate().mul(-0.014).exp())
      .mul(beatUniform.mul(0.6).add(1));
    const angle = rng() * Math.PI * 2;
    const distance = TUNNEL_RADIUS * (2.2 + rng() * 3.5);
    lines.position
      .copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * distance)
      .addScaledVector(frame.up, Math.sin(angle) * distance);
    const spin = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.35);
    debris.push({ lines, spin });
    root.add(lines);
  }

  scene.add(root);
  return { root, debris };
}

function makeStars(rng: () => number, count: number, minRadius: number, maxRadius: number, size: number): Points {
  const curve = createCrystalRail();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = minRadius + rng() * (maxRadius - minRadius);
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 30);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;

    const roll = rng();
    const base = roll < 0.7 ? CYAN : roll < 0.92 ? MAGENTA : AMBER;
    const intensity = rng() < 0.06 ? 1.9 : 0.14 + rng() * 0.3;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
