import { AdditiveBlending, BackSide, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Line, Matrix4, Mesh, MeshBasicMaterial, Points, PointsMaterial, Scene, SphereGeometry, Vector3 } from 'three';
import type { Material, PerspectiveCamera } from 'three';
import { type BattleState } from '../gameplay';
import { box, boxGeometry, createCapitalShip, solid, type Palette } from './models';

function noise(x: number, y: number, z: number) { return Math.sin(x * 1.7 + Math.sin(z * 1.4)) * Math.cos(y * 1.5 + Math.cos(x * 1.2)) * 0.5 + 0.5; }
function random(seed: number) { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
export type FleetPlacement = [friendly: boolean, x: number, y: number, z: number, scale: number, yaw: number];
export type EnvironmentLayout = { scale: number; fleet: FleetPlacement[]; sockets: Array<{ position: Vector3; power: boolean }>; broadsideWindow: [number, number] };
export function buildEnvironment(scene: Scene, p: Palette, state: BattleState, layout: EnvironmentLayout) {
  const root = new Group(); root.scale.setScalar(layout.scale); scene.add(root);
  const sky = new Group(); root.add(sky);
  const geo = new SphereGeometry(19000, 112, 72);
  const positions = geo.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / 19000, y = positions.getY(i) / 19000, z = positions.getZ(i) / 19000;
    const cloud = noise(x * 5, y * 5, z * 5) * 0.55 + noise(x * 13, y * 13, z * 13) * 0.3 + noise(x * 31, y * 31, z * 31) * 0.15;
    const band = Math.exp(-Math.pow((y + x * 0.35 - Math.sin(z * 4) * 0.15) * 2.5, 2));
    const gold = Math.max(0, cloud - 0.53) * 1.5;
    const c = new Color(p.nebulaBase).lerp(new Color(p.nebulaPink), cloud * band * 0.85).lerp(new Color(p.nebulaGold), gold * band * 0.6);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  sky.add(new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
  const starPositions: number[] = [];
  for (let i = 0; i < 1900; i++) { const a = random(i + 17) * Math.PI * 2, y = random(i + 32) * 2 - 1; const r = Math.sqrt(1 - y * y); starPositions.push(Math.cos(a) * r * 17000, y * 17000, Math.sin(a) * r * 17000); }
  const stars = new BufferGeometry(); stars.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  sky.add(new Points(stars, new PointsMaterial({ color: p.stars, size: 9, sizeAttenuation: true, depthWrite: false, fog: false })));
  const fleet: Array<{ ship: Group; origin: Vector3; enemy: boolean; spin: number }> = [];
  for (const [friendly, x, y, z, scale, yaw] of layout.fleet) {
    const ship = createCapitalShip(friendly, false, p); ship.position.set(x, y, z); ship.scale.setScalar(scale); ship.rotation.set(yaw * 0.25, yaw, yaw * 0.3); root.add(ship);
    fleet.push({ ship, origin: ship.position.clone(), enemy: !friendly, spin: yaw });
  }
  const fleetFires: Mesh[] = [];
  const flameGeometry = new SphereGeometry(1, 7, 5);
  const flameMaterial = solid(p.orange, 1.3);
  for (const f of fleet.filter((f) => f.enemy)) {
    for (let i = 0; i < 3; i++) {
      const flame = new Mesh(flameGeometry, flameMaterial); flame.position.set(i % 2 ? 45 : -45, 65, -240 + i * 220); flame.scale.set(25, 48, 25); flame.visible = false; f.ship.add(flame); fleetFires.push(flame);
    }
  }
  const flagship = createCapitalShip(false, true, p); flagship.position.set(0, 0, -4900); root.add(flagship);
  // Fixed armored sockets physically seat each gameplay generator and reactor.
  for (const e of layout.sockets) {
    const socket = new Group(); socket.position.copy(e.position).multiplyScalar(1 / layout.scale);
    box(socket, [13, 13, 3], [0, 0, -5], solid(p.socket));
    for (const s of [-1, 1]) box(socket, [15, 0.6, 1], [0, s * 7, -3], solid(p.orange, 0.5));
    // Sockets are background pedestals, recessed behind the playable target center.
    if (e.power) socket.rotation.y = Math.PI;
    root.add(socket);
  }
  const shield = new Mesh(new SphereGeometry(1, 40, 20), new MeshBasicMaterial({ color: p.magenta, transparent: true, opacity: 0.065, wireframe: true, depthWrite: false, blending: AdditiveBlending }));
  shield.position.copy(flagship.position); shield.scale.set(167, 128, 850); root.add(shield);
  shield.userData.raildIgnoreOcclusion = true;
  // Hull seams and deck fittings use instancing to keep the ship-scale detail affordable.
  const debris = new InstancedMesh(boxGeometry, solid(p.debris), 260);
  const matrix = new Matrix4();
  for (let i = 0; i < 260; i++) { const z = -random(i + 80) * 5400; matrix.makeScale(1 + random(i + 10) * 4, 0.7 + random(i + 45) * 2, 2 + random(i + 25) * 12); matrix.setPosition((random(i + 130) - 0.5) * 1500, (random(i + 90) - 0.5) * 850, z); debris.setMatrixAt(i, matrix); }
  root.add(debris);
  const shots: Array<{ mesh: Mesh; start: Vector3; direction: Vector3; speed: number; phase: number; friendly: boolean }> = [];
  for (let i = 0; i < 70; i++) {
    const friendly = i % 2 === 0;
    const mesh = new Mesh(boxGeometry, solid(friendly ? p.cyan : p.crimson, 2)); mesh.scale.set(0.75, 0.75, 55);
    const start = new Vector3(friendly ? -300 - random(i + 14) * 800 : 380 + random(i + 17) * 700, (random(i + 52) - 0.5) * 660, -600 - random(i + 120) * 4600);
    const direction = new Vector3(friendly ? 1 : -1, (random(i + 26) - 0.5) * 0.5, (random(i + 49) - 0.5) * 0.8).normalize();
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), direction); root.add(mesh);
    shots.push({ mesh, start, direction, speed: 650 + random(i + 42) * 500, phase: random(i + 92) * 5, friendly });
  }
  // The featured broadside fires from the nearest cruiser's flank, above the pilot.
  for (let i = 0; i < 12; i++) {
    const mesh = new Mesh(boxGeometry, solid(p.cyan, 2.2)); mesh.scale.set(85, 1.5, 1.5); root.add(mesh);
    shots.push({ mesh, start: new Vector3(-65, 95, -1550 - i * 92), direction: new Vector3(1, 0.16, -0.08).normalize(), speed: 900, phase: i * 0.12, friendly: true });
  }
  const fires: Mesh[] = [];
  for (let i = 0; i < 22; i++) {
    const mesh = new Mesh(new SphereGeometry(1, 7, 5), solid(i % 2 ? p.orange : p.gold, 1.3));
    mesh.position.set((random(i + 76) - 0.5) * 210, random(i + 190) * 85, -5500 + random(i + 240) * 1400); mesh.scale.set(8, 8, 8); mesh.visible = false; root.add(mesh); fires.push(mesh);
  }
  return {
    update(t: number, camera: PerspectiveCamera, elapsed: number) {
      sky.position.copy(camera.position).multiplyScalar(1 / layout.scale);
      shield.visible = state.shields < 4 && !state.victory;
      shield.rotation.z = Math.sin(elapsed * 0.2) * 0.015;
      for (const shot of shots) {
        const featured = shot.start.x === -65;
        const phase = ((elapsed + shot.phase) % (featured ? 1.4 : 3.7));
        shot.mesh.visible = !(state.victory && !shot.friendly) && phase < (featured ? 0.55 : 1.9) && (!featured || t > layout.broadsideWindow[0] && t < layout.broadsideWindow[1]);
        shot.mesh.position.copy(shot.start).addScaledVector(shot.direction, phase * shot.speed);
      }
      for (const f of fleet) {
        f.ship.position.copy(f.origin).add(new Vector3(Math.sin(elapsed * 0.025 + f.spin) * 4, 0, -elapsed * 0.6));
        if (state.victory && f.enemy) { f.ship.position.x += (f.origin.x > 0 ? 1 : -1) * Math.max(0, t - state.victoryAt) * 40; f.ship.rotation.z = f.spin * 0.3 + Math.max(0, t - state.victoryAt) * 0.028; }
      }
      if (state.victory) { flagship.rotation.z = Math.max(0, t - state.victoryAt) * 0.015; flagship.position.y = -Math.max(0, t - state.victoryAt) * 5; }
      else { flagship.rotation.z = 0; flagship.position.y = 0; }
      fleetFires.forEach((fire, i) => { fire.visible = state.victory; const s = 18 + (Math.sin(elapsed * 7 + i) + 1) * 10; fire.scale.set(s, s * 1.8, s); });
      fires.forEach((fire, i) => { fire.visible = state.victory; const s = 7 + (Math.sin(elapsed * 10 + i) + 1) * 8 + Math.max(0, t - state.victoryAt) * 2; fire.scale.set(s, s * 1.6, s); });
    },
    dispose() { scene.remove(root); const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); root.traverse((o) => { if (o instanceof Mesh || o instanceof Points || o instanceof Line) { geometries.add(o.geometry); if (!Array.isArray(o.material)) materials.add(o.material as MeshBasicMaterial); } }); geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); },
  };
}
