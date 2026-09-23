import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Scene } from 'three';

// Leaf: the pale void. A soft vertical gradient shell, orrery rings that
// give the orbit something to parallax against, a slow drift of pale cubes,
// and lighting that follows the camera so whichever face is in view is lit
// the same soft way. All colors and counts come from the caller.

export type VoidLook = {
  top: Color;
  bottom: Color;
  fog: Color;
  fogNear: number;
  fogFar: number;
  ring: Color;
  dust: Color;
  hemiSky: Color;
  hemiGround: Color;
  rings: ReadonlyArray<{ radius: number; tube: number; tilt: [number, number, number]; speed: number; beads: number }>;
  dustCount: number;
};

export function createVoid(scene: Scene, look: VoidLook) {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  scene.background = look.fog.clone();
  scene.fog = new Fog(look.fog, look.fogNear, look.fogFar);

  // Gradient shell.
  const shellGeometry = new SphereGeometry(420, 32, 20);
  const position = shellGeometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) / 420) * 0.5 + 0.5;
    color.copy(look.bottom).lerp(look.top, Math.pow(t, 0.8));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  shellGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  const shell = new Mesh(shellGeometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  shell.renderOrder = -10;
  root.add(shell);

  // Lighting: hemisphere fill plus a key that rides with the camera.
  const hemi = new HemisphereLight(look.hemiSky, look.hemiGround, 1.35);
  root.add(hemi);
  const key = new DirectionalLight(0xffffff, 2.1);
  const keyTarget = new Object3D();
  key.target = keyTarget;
  root.add(key, keyTarget);
  const rim = new DirectionalLight(0xdfe8ff, 0.55);
  rim.position.set(-30, -40, -20);
  root.add(rim);

  // Orrery rings with beads riding them.
  const ringMaterial = new MeshStandardMaterial({ color: look.ring, roughness: 0.6 });
  const beadGeometry = new BoxGeometry(1, 1, 1);
  const orrery = look.rings.map((spec) => {
    const pivot = new Group();
    pivot.rotation.set(...spec.tilt);
    const spinner = new Group();
    spinner.add(new Mesh(new TorusGeometry(spec.radius, spec.tube, 6, 160), ringMaterial));
    for (let i = 0; i < spec.beads; i += 1) {
      const angle = (i / spec.beads) * Math.PI * 2;
      const bead = new Mesh(beadGeometry, ringMaterial);
      const size = spec.tube * 9;
      bead.scale.setScalar(size);
      bead.position.set(Math.cos(angle) * spec.radius, Math.sin(angle) * spec.radius, 0);
      bead.rotation.z = angle;
      spinner.add(bead);
    }
    pivot.add(spinner);
    root.add(pivot);
    return { spinner, speed: spec.speed };
  });

  // Drifting dust cubes in a thick shell around the arena.
  const dust = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: look.dust, roughness: 0.8 }), look.dustCount);
  const dustState = Array.from({ length: look.dustCount }, (_, index) => {
    const direction = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    return {
      position: direction.multiplyScalar(48 + Math.random() * 110),
      axis: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      angle: Math.random() * Math.PI * 2,
      spin: 0.1 + Math.random() * 0.4,
      size: 0.35 + Math.random() * 1.1 * (index % 7 === 0 ? 2.2 : 1),
    };
  });
  root.add(dust);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const offset = new Vector3();

  function update(dt: number, camera: Camera, energy: number) {
    // Key light sits up and to the left of the view, whichever way it faces.
    offset.set(-0.55, 0.75, 0.6).applyQuaternion(camera.quaternion).multiplyScalar(60);
    key.position.copy(camera.position).add(offset);
    keyTarget.position.set(0, 0, 0);
    for (const ring of orrery) ring.spinner.rotation.z += dt * ring.speed * (1 + energy * 0.6);
    dustState.forEach((item, index) => {
      item.angle += item.spin * dt;
      quaternion.setFromAxisAngle(item.axis, item.angle);
      scale.setScalar(item.size);
      matrix.compose(item.position, quaternion, scale);
      dust.setMatrixAt(index, matrix);
    });
    dust.instanceMatrix.needsUpdate = true;
  }

  return { root, update, hemi, key };
}
