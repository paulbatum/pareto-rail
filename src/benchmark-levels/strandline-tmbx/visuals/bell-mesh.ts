import { Color, DoubleSide, Group, LatheGeometry, Mesh, TorusGeometry, Vector2 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { additiveMaterialParameters } from '../../../engine/visual-kit';

type FloatUniform = UniformNode<'float', number>;

// Leaf: the bell as a translucent lathe. Radial canals, the ring canal at the
// margin, and a four-lobed gonad clover glow through a green body; a violet
// stain at the centre is the colony dug in under the crown. All colours and
// levels arrive from the caller.

export type BellLook = {
  radius: number;
  height: number;
  body: Color;
  rim: Color;
  canal: Color;
  gonad: Color;
  stain: Color;
  canalCount: number;
};

export type BellUniforms = {
  clock: FloatUniform;
  pulse: FloatUniform;
  visibility: FloatUniform;
  life: FloatUniform;
  stain: FloatUniform;
};

export function createBellUniforms(): BellUniforms {
  return {
    clock: uniform(0),
    pulse: uniform(0),
    visibility: uniform(0.4),
    life: uniform(0.2),
    stain: uniform(1),
  };
}

export function createBellMesh(look: BellLook, uniforms: BellUniforms) {
  const R = look.radius;
  const H = look.height;
  // Outer exumbrella from the apex to the margin, curling under into the
  // shallow subumbrella and back to the axis.
  const profile = [
    [0.4, 1], [0.22, 0.97], [0.44, 0.87], [0.63, 0.7], [0.8, 0.48], [0.915, 0.26], [0.978, 0.1],
    [1, 0.01], [0.985, -0.04], [0.94, -0.025], [0.77, 0.07], [0.55, 0.13], [0.29, 0.168], [0.006, 0.18],
  ].map(([r, h], index) => new Vector2(index === 0 ? 0.004 * R : r * R, h * H));
  const geometry = new LatheGeometry(profile, 96);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });

  const p = positionLocal;
  const radial = length(p.xz).div(R);
  const angle = atan(p.z, p.x);
  const canals = pow(abs(cos(angle.mul(look.canalCount / 2))), float(70)).mul(smoothstep(float(0.08), float(0.3), radial));
  const ring = exp(pow(radial.sub(0.955).mul(34), float(2)).negate());
  // Four gonad loops around the apex (the moon-jelly clover).
  const lobe = (cx: number, cz: number) => {
    const d = length(p.xz.sub(vec2(cx * R, cz * R)));
    return exp(pow(d.sub(R * 0.11).mul(0.55), float(2)).negate());
  };
  const k = 0.2;
  const gonads = lobe(k, k).add(lobe(-k, k)).add(lobe(k, -k)).add(lobe(-k, -k)).mul(smoothstep(float(0.5), float(0.25), radial));

  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(float(1).sub(abs(dot(normalWorld, viewDirection))), float(1.8));
  const shimmer = sin(uniforms.clock.mul(0.9).add(radial.mul(14))).mul(0.1).add(0.9);
  const stain = uniforms.stain.mul(smoothstep(float(0.42), float(0.02), radial)).mul(sin(angle.mul(5).add(uniforms.clock.mul(0.7))).mul(0.25).add(0.75));

  const col = (c: Color) => vec3(c.r, c.g, c.b);
  const lit = float(0.45).add(uniforms.life.mul(0.55)).add(uniforms.pulse.mul(0.35));
  let color = col(look.body).mul(0.4)
    .add(col(look.rim).mul(rim))
    .add(col(look.canal).mul(canals).mul(0.9))
    .add(col(look.canal).mul(ring).mul(1.1))
    .add(col(look.gonad).mul(gonads).mul(1.3));
  color = color.mul(lit).mul(shimmer);
  color = mix(color, col(look.stain).mul(1.2), clamp(stain, 0, 0.85));
  material.colorNode = color;
  material.opacityNode = clamp(
    float(0.16).add(rim.mul(0.55)).add(canals.mul(0.4)).add(ring.mul(0.5)).add(gonads.mul(0.5)).add(stain.mul(0.4)),
    0,
    0.92,
  ).mul(uniforms.visibility);

  const bell = new Mesh(geometry, material);
  bell.userData.raildIgnoreOcclusion = true;
  bell.renderOrder = 2;

  // Marginal lappets: a beaded glow ring at the rim, additive.
  const lappetMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const beads = pow(abs(sin(atan(positionLocal.y, positionLocal.x).mul(48))), float(8));
  lappetMaterial.colorNode = col(look.canal).mul(beads.mul(0.8).add(0.25)).mul(uniforms.visibility).mul(lit);
  const lappets = new Mesh(new TorusGeometry(R * 0.995, 0.9, 6, 192), lappetMaterial);
  lappets.rotation.x = Math.PI / 2;
  lappets.position.y = -0.6;
  lappets.userData.raildIgnoreOcclusion = true;

  const group = new Group();
  group.add(bell, lappets);
  return { group, bell };
}

/** Bell contraction for a pulse envelope 0..1 (1 at the stroke). */
export function bellContraction(pulse: number) {
  const squeeze = Math.max(0, pulse);
  return { radial: 1 - squeeze * 0.06, vertical: 1 + squeeze * 0.05 };
}

