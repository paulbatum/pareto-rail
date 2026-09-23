import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  CircleGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Scene } from 'three';
import { mulberry32 } from '../../../engine/rng';

// Leaf: the orbital backdrop seen through the gun's open lattice. A sky shell
// that travels with the camera, holding stars, a planet, and a sun. All
// colours and placements come from the spine.

export type SpaceOptions = {
  starCount: number;
  starColors: readonly Color[];
  /** Unit direction of the galactic band's pole. */
  bandPole: Vector3;
  planetCenter: Vector3;
  planetRadius: number;
  sunDirection: Vector3;
  ocean: Color;
  landmass: Color;
  cloud: Color;
  nightLights: Color;
  atmosphere: Color;
  sun: Color;
  /** Sunrise streak colour (HDR). */
  flare: Color;
};

const SKY_RADIUS = 440;

export function createSpace(scene: Scene, options: SpaceOptions) {
  const rng = mulberry32(90210);
  const sky = new Group();
  sky.name = 'space';
  sky.renderOrder = -10;
  scene.add(sky);

  // ---- stars ----------------------------------------------------------------------
  const starGeometry = new OctahedronGeometry(1, 0);
  const starMaterial = new MeshBasicMaterial({ fog: false, depthWrite: false, toneMapped: false });
  const stars = new InstancedMesh(starGeometry, starMaterial, options.starCount);
  stars.instanceColor = new InstancedBufferAttribute(new Float32Array(options.starCount * 3), 3);
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  const matrix = new Matrix4();
  const direction = new Vector3();
  const pole = options.bandPole.clone().normalize();
  const color = new Color();
  for (let i = 0; i < options.starCount; i += 1) {
    direction.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    // A third of the stars crowd into a galactic band.
    if (i % 3 === 0) direction.addScaledVector(pole, -direction.dot(pole) * (0.82 + rng() * 0.15)).normalize();
    const size = 0.35 + rng() ** 5 * 1.7;
    matrix.compose(direction.clone().multiplyScalar(SKY_RADIUS), new Quaternion().random(), new Vector3(size, size, size));
    stars.setMatrixAt(i, matrix);
    color.copy(options.starColors[Math.floor(rng() * options.starColors.length)]).multiplyScalar(0.35 + rng() ** 2 * 2.2);
    stars.setColorAt(i, color);
  }
  sky.add(stars);

  // ---- planet -------------------------------------------------------------------------
  const planetGeometry = new SphereGeometry(options.planetRadius, 96, 64);
  const positions = planetGeometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const normal = new Vector3();
  const sun = options.sunDirection.clone().normalize();
  const toCamera = new Vector3();
  const tint = new Color();
  for (let i = 0; i < positions.count; i += 1) {
    normal.fromBufferAttribute(positions, i).normalize();
    const light = normal.dot(sun);
    const day = smooth(-0.08, 0.35, light);
    // Continents and cloud bands from layered trig noise — no textures.
    const land = smooth(0.15, 0.45, Math.sin(normal.x * 5.1 + Math.sin(normal.y * 3.3) * 2) * Math.cos(normal.z * 4.3 + normal.y * 1.7) + Math.sin(normal.y * 9.4) * 0.25);
    const clouds = smooth(0.35, 0.9, Math.sin(normal.y * 17 + Math.sin(normal.x * 6 + normal.z * 4) * 2.6) * 0.5 + 0.5) * 0.7;
    tint.copy(options.ocean).lerp(options.landmass, land).lerp(options.cloud, clouds).multiplyScalar(0.25 + day * 1.2);
    // A faint cold glow over the night-side land.
    tint.add(color.copy(options.nightLights).multiplyScalar((1 - day) * land * 0.05));
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  planetGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  // The planet writes depth so the sun can set behind it.
  const planet = new Mesh(planetGeometry, new MeshBasicMaterial({ vertexColors: true, fog: false }));
  planet.position.copy(options.planetCenter);
  planet.renderOrder = -9;
  sky.add(planet);

  // Atmosphere: a back-faced shell, brightest where it grazes the line of sight.
  const shellGeometry = new SphereGeometry(options.planetRadius * 1.035, 96, 64);
  const shellPositions = shellGeometry.getAttribute('position');
  const shellColors = new Float32Array(shellPositions.count * 3);
  for (let i = 0; i < shellPositions.count; i += 1) {
    normal.fromBufferAttribute(shellPositions, i).normalize();
    toCamera.copy(options.planetCenter).addScaledVector(normal, options.planetRadius * 1.035).negate().normalize();
    const graze = 1 - Math.abs(normal.dot(toCamera));
    const lit = smooth(-0.35, 0.4, normal.dot(sun));
    const strength = graze ** 5 * (0.15 + lit * 1.4);
    shellColors[i * 3] = options.atmosphere.r * strength;
    shellColors[i * 3 + 1] = options.atmosphere.g * strength;
    shellColors[i * 3 + 2] = options.atmosphere.b * strength;
  }
  shellGeometry.setAttribute('color', new BufferAttribute(shellColors, 3));
  const shell = new Mesh(
    shellGeometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  shell.position.copy(options.planetCenter);
  shell.renderOrder = -8;
  sky.add(shell);

  // ---- sun --------------------------------------------------------------------------------
  const sunGroup = new Group();
  sunGroup.position.copy(sun).multiplyScalar(SKY_RADIUS * 0.95);
  sunGroup.lookAt(0, 0, 0);
  const sunDisc = new Mesh(new CircleGeometry(4.5, 40), new MeshBasicMaterial({ color: options.sun, fog: false, depthWrite: false, toneMapped: false }));
  const haloMaterial = new MeshBasicMaterial({ color: options.sun.clone().multiplyScalar(0.06), fog: false, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new Mesh(new CircleGeometry(20, 40), haloMaterial);
  halo.position.z = -0.5;
  // A thin anamorphic streak through the sun, raised only for the sunrise.
  const flareMaterial = new MeshBasicMaterial({ color: options.flare.clone(), fog: false, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const flare = new Mesh(new PlaneGeometry(240, 0.9), flareMaterial);
  flare.position.z = -0.3;
  const flareGlow = new Mesh(new CircleGeometry(34, 40), flareMaterial);
  flareGlow.position.z = -0.6;
  flareGlow.scale.setScalar(0.001);
  sunGroup.add(sunDisc, halo, flare, flareGlow);
  sunGroup.renderOrder = -9;
  sky.add(sunGroup);

  return {
    root: sky,
    planet,
    shell,
    /** The sky shell rides with the camera so it reads as infinitely far away. */
    follow(position: Vector3) {
      sky.position.copy(position);
    },
    setPlanetOffset(offset: Vector3, scale: number) {
      planet.position.copy(options.planetCenter).add(offset);
      shell.position.copy(planet.position);
      planet.scale.setScalar(scale);
      shell.scale.setScalar(scale);
    },
    setStarBrightness(value: number) {
      starMaterial.color.setScalar(value);
    },
    setSunFlare(amount: number) {
      flare.scale.set(0.2 + amount * 0.8, 1 + amount, 1);
      flareGlow.scale.setScalar(Math.max(0.001, amount));
      flareMaterial.color.copy(options.flare).multiplyScalar(amount);
    },
  };
}

function smooth(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
