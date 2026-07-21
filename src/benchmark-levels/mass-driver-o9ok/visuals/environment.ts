import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BORE_RADIUS, createMassDriverRail, ringU } from '../gameplay';
import { MD_MUZZLE_BEAT } from '../timing';
import { createCoilField, type CoilField } from './rings';
import { ARC_BLUE, BARREL_HAZE, GUN_STEEL, GUN_STEEL_LIT, hdr, VIOLET, VOID, WHITE_ARC } from './palette';

// Construction only. The barrel is three layers of parallax around the coil
// field: conductor rails that streak past closest, wall plating on the bore
// surface, and heavy bracing hoops every few metres as depth landmarks. Past
// the muzzle there is nothing but a star slab travelling the wrong way fast.

export type Environment = {
  root: Group;
  coils: CoilField;
  conductors: ScatterField;
  plating: ScatterField;
  bracing: ScatterField;
  muzzle: Group;
  muzzleRings: Mesh[];
  muzzleCore: Mesh;
  muzzlePosition: Vector3;
  stars: InstancedMesh;
  starMaterial: MeshBasicMaterial;
};

const CONDUCTOR_LANES = 6;
const CONDUCTOR_COUNT = 52;
const PLATING_COUNT = 70;
const BRACING_COUNT = 16;
const STAR_COUNT = 620;

export function createEnvironmentInternal(scene: Scene): Environment {
  const curve = createMassDriverRail();
  const root = new Group();

  scene.background = VOID.clone();
  scene.fog = new Fog(BARREL_HAZE.clone(), 55, 330);

  // ---- the coils: one per beat, seated by the shared rail easing ------------
  const coils = createCoilField({
    curve,
    count: MD_MUZZLE_BEAT,
    ringU,
    boreRadius: BORE_RADIUS,
    segments: 6,
    segmentFill: 0.72,
    struts: 6,
    strutLength: 3.4,
  });
  root.add(coils.group);

  // ---- conductor rails: the fastest-moving thing in frame -------------------
  const conductorGeometry = new BoxGeometry(0.34, 0.34, 26);
  const conductorMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.35), opacity: 0.85 });
  conductorMaterial.toneMapped = false;
  const conductors = scatterAlongRail(curve, {
    count: CONDUCTOR_COUNT,
    seed: 0x5a17,
    window: { behind: 70, ahead: 340 },
    place: (index, rng) => {
      const lane = index % CONDUCTOR_LANES;
      const angle = (lane / CONDUCTOR_LANES) * Math.PI * 2 + Math.PI / CONDUCTOR_LANES;
      const radius = BORE_RADIUS * 1.2;
      return {
        u: rng(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      };
    },
    make: () => new Mesh(conductorGeometry, conductorMaterial),
  });
  root.add(conductors.group);

  // ---- bore plating: dark structure that catches the coil flash -------------
  const platingGeometry = new BoxGeometry(3.6, 0.5, 5.2);
  const platingMaterial = new MeshBasicMaterial({ color: GUN_STEEL, side: DoubleSide, toneMapped: false });
  const plating = scatterAlongRail(curve, {
    count: PLATING_COUNT,
    seed: 0x2c99,
    window: { behind: 60, ahead: 320 },
    place: (_index, rng) => {
      const angle = rng() * Math.PI * 2;
      const radius = BORE_RADIUS * (1.1 + rng() * 0.1);
      return { u: rng(), offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0) };
    },
    make: () => new Mesh(platingGeometry, platingMaterial),
    onUpdate: (item) => {
      // Lie flat on the bore wall: roll the plate to face the axis.
      item.object.rotateZ(Math.atan2(item.offset.y, item.offset.x));
    },
  });
  root.add(plating.group);

  // ---- bracing hoops: heavy rings that read as distance markers -------------
  const bracingGeometry = new TorusGeometry(BORE_RADIUS * 1.34, 0.85, 4, 14);
  const bracingMaterial = new MeshBasicMaterial({ color: GUN_STEEL_LIT, toneMapped: false });
  const bracing = scatterAlongRail(curve, {
    count: BRACING_COUNT,
    seed: 0x71ab,
    window: { behind: 60, ahead: 340 },
    place: (_index, rng) => ({ u: rng(), offset: new Vector3(0, 0, 0) }),
    make: () => new Mesh(bracingGeometry, bracingMaterial),
  });
  root.add(bracing.group);

  // ---- the muzzle ----------------------------------------------------------
  const muzzleFrame = sampleRailFrame(curve, ringU(MD_MUZZLE_BEAT));
  const muzzle = new Group();
  muzzle.position.copy(muzzleFrame.position);
  const muzzleBasis = new Matrix4().makeBasis(muzzleFrame.right, muzzleFrame.up, muzzleFrame.tangent);
  muzzle.quaternion.setFromRotationMatrix(muzzleBasis);

  const muzzleRings: Mesh[] = [];
  for (let index = 0; index < 5; index += 1) {
    const radius = BORE_RADIUS * (1.0 + index * 0.16);
    const material = createAdditiveBasicMaterial({ color: hdr(VIOLET, 0.6), side: DoubleSide });
    material.toneMapped = false;
    const ring = new Mesh(new RingGeometry(radius, radius + 0.55, 48), material);
    ring.position.z = -index * 2.2;
    muzzle.add(ring);
    muzzleRings.push(ring);
  }

  // The aperture itself: a disc that is almost black until the gun fires.
  const muzzleCoreMaterial = createAdditiveBasicMaterial({ color: WHITE_ARC.clone().multiplyScalar(0.06), side: DoubleSide });
  muzzleCoreMaterial.toneMapped = false;
  const muzzleCore = new Mesh(new CircleGeometry(BORE_RADIUS * 0.95, 48), muzzleCoreMaterial);
  muzzleCore.position.z = -0.4;
  muzzle.add(muzzleCore);
  root.add(muzzle);

  // ---- open space past the muzzle ------------------------------------------
  const starGeometry = new OctahedronGeometry(0.55, 0);
  const starMaterial = createAdditiveBasicMaterial({ color: new Color(0.55, 0.62, 0.8) });
  starMaterial.toneMapped = false;
  const stars = new InstancedMesh(starGeometry, starMaterial, STAR_COUNT);
  stars.frustumCulled = false;
  const railEnd = curve.getPointAt(1);
  const muzzleZ = muzzleFrame.position.z;
  const rng = mulberry32(0x9e37);
  const matrix = new Matrix4();
  const identity = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  for (let index = 0; index < STAR_COUNT; index += 1) {
    // A slab spanning the whole post-muzzle stretch and well past the rail end,
    // so exiting the barrel whips a starfield past instead of ending in fog.
    const t = rng();
    position.set(
      (rng() - 0.5) * 900,
      (rng() - 0.5) * 900,
      muzzleZ + 60 - t * (Math.abs(railEnd.z - muzzleZ) + 1400),
    );
    const size = 0.4 + rng() * rng() * 2.6;
    scale.set(size, size, size * (2 + rng() * 6));
    matrix.compose(position, identity, scale);
    stars.setMatrixAt(index, matrix);
  }
  stars.instanceMatrix.needsUpdate = true;
  root.add(stars);

  scene.add(root);

  return {
    root,
    coils,
    conductors,
    plating,
    bracing,
    muzzle,
    muzzleRings,
    muzzleCore,
    muzzlePosition: muzzleFrame.position.clone(),
    stars,
    starMaterial,
  };
}
