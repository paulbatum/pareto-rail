import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from 'three';

// Leaf: the player's instruments. The reticle is a brass washer with four
// ticks and six lock pips; the shot is a bead of citrus solvent with a hot
// core and a short tail. Colours come from the spine.

export function createReticleMesh(colors: { base: Color; active: Color; pip: Color; dot: Color }) {
  const group = new Group();
  const basic = (color: Color, additive = false) => new MeshBasicMaterial({
    color: color.clone(),
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: additive ? AdditiveBlending : undefined,
  });
  const washerMaterial = basic(colors.base);
  const washer = new Mesh(new RingGeometry(0.98, 1.16, 48), washerMaterial);
  const innerMaterial = basic(colors.base.clone().multiplyScalar(0.55));
  const inner = new Mesh(new RingGeometry(0.9, 0.94, 48), innerMaterial);
  const ticks = new Group();
  const tickMaterial = basic(colors.base);
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.34, 0.07), tickMaterial);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 1.42, Math.sin(angle) * 1.42, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }
  const pips: Mesh[] = [];
  const pipGeometry = new CircleGeometry(0.095, 12);
  for (let i = 0; i < 6; i += 1) {
    const pip = new Mesh(pipGeometry, basic(colors.pip));
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    pip.position.set(Math.cos(angle) * 1.07, Math.sin(angle) * 1.07, 0.01);
    pip.visible = false;
    group.add(pip);
    pips.push(pip);
  }
  const dot = new Mesh(new CircleGeometry(0.09, 16), basic(colors.dot));
  group.add(washer, inner, ticks, dot);
  group.userData.parts = { washerMaterial, innerMaterial, tickMaterial, ticks, pips };
  return group;
}

export function createShotMesh(colors: { core: Color; glow: Color; tail: Color }) {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(0.26, 12, 10), new MeshBasicMaterial({ color: colors.core, toneMapped: false }));
  const glow = new Mesh(
    new SphereGeometry(0.55, 12, 10),
    new MeshBasicMaterial({ color: colors.glow, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  const tail = new Mesh(
    new ConeGeometry(0.3, 2.6, 10, 1, true),
    new MeshBasicMaterial({ color: colors.tail, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
  );
  // The runner points +Z at the target; the tail trails behind.
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.45;
  group.add(glow, core, tail);
  return group;
}
