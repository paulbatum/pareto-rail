import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { dot, float, mix, mx_noise_float, normalize, positionLocal, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { mulberry32, NEBULA_DEEP, NEBULA_GOLD, NEBULA_MAGENTA, NEBULA_VIOLET, WHITE_HOT } from './palette';

// The whole battle is backlit by one enormous magenta-and-gold nebula. It is a
// camera-following dome (nothing about it parallaxes), lit brightest around a
// golden core ahead and above the fleet so silhouettes read against it.

export const skyBeatUniform = uniform(0);
/** 0 during the fight, up to 1 in the victory bloom. */
export const skyVictoryUniform = uniform(0);
/** Brief white/gold flare used for the flagship's death. */
export const skyFlareUniform = uniform(0);

const SKY_RADIUS = 5200;
export const NEBULA_AXIS = new Vector3(0.16, 0.2, -1).normalize();

function createNebulaMaterial() {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.depthWrite = false;
  material.fog = false;
  const direction = normalize(positionLocal);
  const axis = vec3(NEBULA_AXIS.x, NEBULA_AXIS.y, NEBULA_AXIS.z);
  const facing = dot(direction, axis);
  const broad = smoothstep(float(-0.35), float(0.95), facing);

  const p = direction.mul(1.55);
  const low = mx_noise_float(p.mul(1.25).add(vec3(3.1, 1.7, 0.4))).mul(0.5).add(0.5);
  const mid = mx_noise_float(p.mul(3.1).add(vec3(0.7, 4.2, 1.9))).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(8.4).add(vec3(9.1, 2.2, 5.5))).mul(0.5).add(0.5);
  const dust = mx_noise_float(p.mul(4.6).add(vec3(2.4, 8.8, 3.3))).mul(0.5).add(0.5);

  const density = low.mul(0.5).add(mid.mul(0.3)).add(fine.mul(0.1)).add(broad.mul(0.3));
  const cloud = smoothstep(float(0.48), float(1.0), density);
  // Ridged filaments: thin bright veins where the noise crosses zero.
  const vein = float(1).sub(mx_noise_float(p.mul(2.6).add(vec3(5.3, 1.1, 7.7))).abs()).pow(6).mul(smoothstep(float(0.3), float(0.7), low));

  const deep = vec3(NEBULA_DEEP.r, NEBULA_DEEP.g, NEBULA_DEEP.b).mul(0.5);
  const violet = vec3(NEBULA_VIOLET.r, NEBULA_VIOLET.g, NEBULA_VIOLET.b);
  const magenta = vec3(NEBULA_MAGENTA.r, NEBULA_MAGENTA.g, NEBULA_MAGENTA.b);
  const gold = vec3(NEBULA_GOLD.r, NEBULA_GOLD.g, NEBULA_GOLD.b);
  const hot = vec3(WHITE_HOT.r, WHITE_HOT.g, WHITE_HOT.b);

  let color = mix(deep, violet.mul(0.5), smoothstep(float(0.0), float(0.5), cloud));
  color = mix(color, magenta.mul(0.6), smoothstep(float(0.25), float(0.85), cloud).mul(broad.mul(0.6).add(0.4)));
  color = mix(color, gold.mul(0.85), smoothstep(float(0.7), float(1.0), cloud.mul(broad).mul(broad)));
  color = color.add(magenta.mul(vein).mul(0.22).mul(broad.add(0.35))).add(gold.mul(vein).mul(0.16).mul(broad));
  // The core: a hot golden heart ahead of the fleet.
  const core = pow(dot(direction, axis).max(0), float(120));
  const halo = pow(dot(direction, axis).max(0), float(10));
  color = color.add(gold.mul(halo).mul(0.13)).add(hot.mul(core).mul(1.7));
  // Dust lanes eat into the glow so the cloud has structure instead of a flat wash.
  color = color.mul(float(1).sub(smoothstep(float(0.5), float(0.78), dust).mul(0.7)));
  color = color.mul(skyBeatUniform.mul(0.03).add(0.3));
  // Victory swells the nebula itself (structure preserved) instead of washing it with a flat tint.
  color = color.mul(skyVictoryUniform.mul(1.6).add(1)).add(gold.mul(skyVictoryUniform).mul(halo).mul(0.35));
  color = color.add(hot.mul(skyFlareUniform).mul(0.07));
  material.colorNode = color;
  return material;
}

export function createSky() {
  const group = new Group();
  const dome = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 32), createNebulaMaterial());
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.raildIgnoreOcclusion = true;
  group.add(dome);

  // Stars: tiny octahedra on a shell, dense toward the nebula so it reads as a stellar nursery.
  const rng = mulberry32(90210);
  const count = 1800;
  const stars = new InstancedMesh(
    new OctahedronGeometry(1, 0),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }),
    count,
  );
  stars.frustumCulled = false;
  stars.userData.raildIgnoreOcclusion = true;
  stars.renderOrder = -9;
  const matrix = new Matrix4();
  const color = new Color();
  const direction = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    direction.set(s * Math.cos(phi), u, s * Math.sin(phi));
    const bias = Math.max(0, direction.dot(NEBULA_AXIS));
    const size = 5 + rng() ** 3 * 16 + bias * 4;
    matrix.compose(direction.clone().multiplyScalar(SKY_RADIUS * 0.96), new Quaternion(), new Vector3(size, size, size));
    stars.setMatrixAt(i, matrix);
    const tone = rng();
    color.setRGB(0.55 + tone * 0.45, 0.55 + (1 - Math.abs(tone - 0.5) * 2) * 0.3, 0.7 + (1 - tone) * 0.3).multiplyScalar(0.55 + rng() * 0.75);
    stars.setColorAt(i, color);
  }
  group.add(stars);

  return {
    group,
    update(cameraPosition: Vector3) {
      group.position.copy(cameraPosition);
    },
    dispose() {
      dome.geometry.dispose();
      (dome.material as MeshBasicNodeMaterial).dispose();
      stars.geometry.dispose();
      (stars.material as MeshBasicMaterial).dispose();
      stars.dispose();
      group.removeFromParent();
    },
  };
}
