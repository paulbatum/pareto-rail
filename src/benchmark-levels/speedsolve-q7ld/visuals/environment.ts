import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../engine/rng';
import { VOID_FLOOR, VOID_PALE } from './palette';

// The void: pale, softly lit, and almost empty — a photography cyclorama for
// the cube. A gradient sky sphere carries the soft lighting story, a faint
// shadow disc far below grounds the composition, and a sparse drift of grey
// micro-cubes gives the camera's orbit parallax without ever competing with
// the six solve colors.

const DUST_COUNT = 140;

export type Environment = {
  root: Group;
  update(dt: number, elapsed: number): void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);

  scene.fog = new Fog(VOID_PALE.clone(), 90, 320);

  // Gradient sphere: slightly warm below, slightly cool above — soft light
  // with no visible source.
  {
    const geometry = new SphereGeometry(360, 24, 18);
    const position = geometry.getAttribute('position') as BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const top = new Color(0.845, 0.86, 0.885);
    const mid = VOID_PALE.clone();
    const low = new Color(0.87, 0.845, 0.815);
    const scratch = new Color();
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i) / 360;
      if (y >= 0) scratch.copy(mid).lerp(top, Math.min(1, y * 1.4));
      else scratch.copy(mid).lerp(low, Math.min(1, -y * 1.2));
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const sky = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }));
    sky.name = 'void-sky';
    root.add(sky);
  }

  // Soft shadow suggestion far below the cube.
  {
    const disc = new Mesh(
      new CircleGeometry(46, 40),
      new MeshBasicMaterial({ color: VOID_FLOOR.clone(), transparent: true, opacity: 0.55 }),
    );
    disc.name = 'void-floor';
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -70;
    root.add(disc);
  }

  // Drifting micro-cube dust in a shell around the arena.
  const rng = mulberry32(20260724);
  const dust = new InstancedMesh(
    new BoxGeometry(0.5, 0.5, 0.5),
    new MeshBasicMaterial({ color: new Color(0.78, 0.775, 0.765) }),
    DUST_COUNT,
  );
  dust.frustumCulled = false;
  dust.userData.raildIgnoreOcclusion = true;
  const dustSeeds: Array<{ position: Vector3; axis: Vector3; phase: number; scale: number }> = [];
  const matrix = new Matrix4();
  const quat = new Quaternion();
  const scale = new Vector3();
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const radius = 62 + rng() * 110;
    const theta = rng() * Math.PI * 2;
    const y = (rng() - 0.5) * 130;
    dustSeeds.push({
      position: new Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius),
      axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      phase: rng() * Math.PI * 2,
      scale: 0.5 + rng() * 1.4,
    });
  }
  root.add(dust);

  function updateDust(elapsed: number) {
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const seed = dustSeeds[i];
      quat.setFromAxisAngle(seed.axis, elapsed * 0.3 + seed.phase);
      scale.setScalar(seed.scale);
      matrix.compose(
        new Vector3(
          seed.position.x,
          seed.position.y + Math.sin(elapsed * 0.22 + seed.phase) * 2.2,
          seed.position.z,
        ),
        quat,
        scale,
      );
      dust.setMatrixAt(i, matrix);
    }
    dust.instanceMatrix.needsUpdate = true;
  }
  updateDust(0);

  return {
    root,
    update(_dt: number, elapsed: number) {
      updateDust(elapsed);
    },
  };
}
