import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
  type Camera,
  type CatmullRomCurve3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { spawnGlint } from './effects';
import { BACKGROUND, CRIMSON, CYAN_GLOW, hdr, NEBULA_DEEP, NEBULA_GOLD, NEBULA_MAGENTA } from './palette';
import { createEnemyFlagship, createEnemyWarship, createFriendlyCruiser, type CapitalShip } from './ships';

export type BroadsideEnvironment = {
  root: Group;
  update(dt: number, elapsed: number, runProgress: number, camera: Camera, battle: number): void;
  flagshipTrenchPulse(value: number): void;
  flagshipBreaking(): void;
};

type Beam = {
  mesh: Mesh;
  age: number;
  life: number;
};

const BEAM_COUNT = 30;

export function createBroadsideEnvironment(scene: Scene, curve: CatmullRomCurve3): BroadsideEnvironment {
  scene.background = BACKGROUND.clone();
  const root = new Group();
  const rng = mulberry32(0xb80451de);

  // --- Nebula dome: a vast sphere with baked magenta/gold/deep-violet
  // vertex gradients, so every hull reads as a backlit silhouette. Sized to
  // sit inside the camera far plane from anywhere on the rail.
  {
    const DOME_RADIUS = 420;
    const DOME_CENTER = new Vector3(0, 0, -250);
    const geo = new SphereGeometry(DOME_RADIUS, 24, 18);
    const positions = geo.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const magenta = NEBULA_MAGENTA;
    const gold = NEBULA_GOLD;
    const deep = NEBULA_DEEP;
    const tmp = new Color();
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i) / DOME_RADIUS;
      const y = positions.getY(i) / DOME_RADIUS;
      const z = positions.getZ(i) / DOME_RADIUS;
      // Gold core confined to a blob up-ahead; magenta lobes to the
      // sides; deep violet everywhere else so open space stays dark.
      const coreDx = x + 0.2;
      const coreDy = y - 0.3;
      const coreFalloff = Math.max(0, 1 - (coreDx * coreDx + coreDy * coreDy) * 2.4);
      const goldness = Math.max(0, -z) ** 2 * coreFalloff * coreFalloff;
      const magentaness = Math.max(0, Math.abs(x) - 0.1) * (0.7 + 0.5 * y);
      tmp.copy(deep).lerp(magenta, Math.min(1, magentaness * 1.4)).lerp(gold, Math.min(1, goldness * 1.1));
      const band = 0.75 + 0.25 * Math.sin((x * 5 + y * 9 + z * 4) * Math.PI);
      // Backdrop stays dim: vivid after sRGB encoding, never washing.
      const dim = 0.45;
      colors[i * 3] = tmp.r * band * dim;
      colors[i * 3 + 1] = tmp.g * band * dim;
      colors[i * 3 + 2] = tmp.b * band * dim;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const dome = new Mesh(
      geo,
      new MeshBasicMaterial({ side: BackSide, vertexColors: true, depthWrite: false, fog: false }),
    );
    dome.position.copy(DOME_CENTER);
    dome.frustumCulled = false;
    dome.userData.raildIgnoreOcclusion = true;
    root.add(dome);
  }

  // --- Nebula glow planes: soft additive hearts for the gold core and
  // magenta lobes. They ride with the camera at fixed offsets so the
  // backlight stays in frame from launch to pull-out. Planes are
  // billboarded each frame (Sprite raycast breaks headless tooling).
  const glowPlanes: Mesh[] = [];
  const glowBaseOpacity: number[] = [];
  const glowOffsets: Vector3[] = [];
  {
    const defs: Array<{ color: Color; scale: number; opacity: number; offset: Vector3 }> = [
      { color: hdr(NEBULA_GOLD, 0.32), scale: 700, opacity: 0.1, offset: new Vector3(-60, 70, -380) },
      { color: hdr(NEBULA_MAGENTA, 0.3), scale: 850, opacity: 0.12, offset: new Vector3(-330, 120, -300) },
      { color: hdr(NEBULA_MAGENTA, 0.28), scale: 650, opacity: 0.1, offset: new Vector3(300, -60, -330) },
    ];
    for (const def of defs) {
      const material = new MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: def.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: DoubleSide,
      });
      const plane = new Mesh(new PlaneGeometry(1, 1), material);
      plane.scale.setScalar(def.scale);
      plane.userData.raildIgnoreOcclusion = true;
      plane.frustumCulled = false;
      root.add(plane);
      glowPlanes.push(plane);
      glowBaseOpacity.push(def.opacity);
      glowOffsets.push(def.offset);
    }
  }

  // --- Starfield: dim ice points scattered in a shell around the rail,
  // sized to stay inside the camera far plane.
  {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tmp = new Color();
    for (let i = 0; i < count; i += 1) {
      const u = rng();
      const frame = sampleRailFrame(curve, u);
      const angle = rng() * Math.PI * 2;
      const radius = 60 + rng() * 320;
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius)
        .addScaledVector(frame.tangent, (rng() - 0.5) * 130);
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      const roll = rng();
      if (roll < 0.12) tmp.copy(NEBULA_GOLD);
      else if (roll < 0.3) tmp.copy(NEBULA_MAGENTA);
      else tmp.setRGB(0.75, 0.85, 1.0);
      const intensity = rng() < 0.05 ? 1.6 : 0.15 + rng() * 0.4;
      colors[i * 3] = tmp.r * intensity;
      colors[i * 3 + 1] = tmp.g * intensity;
      colors[i * 3 + 2] = tmp.b * intensity;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const points = new Points(
      geo,
      new PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, depthWrite: false, fog: false }),
    );
    points.frustumCulled = false;
    root.add(points);
  }

  // --- The fleets. Kilometer-long cruisers slugging it out in no neat
  // formation; the rail threads the gaps between them.
  const friendlies: CapitalShip[] = [];
  const hostiles: CapitalShip[] = [];
  const placeShip = (
    ship: CapitalShip,
    u: number,
    offset: Vector3,
    yawJitter: number,
    roll: number,
    list: CapitalShip[],
  ) => {
    const frame = sampleRailFrame(curve, u);
    ship.group.position.copy(
      frame.position.clone().addScaledVector(frame.right, offset.x).addScaledVector(frame.up, offset.y),
    );
    // Hull long axis follows the rail tangent with a tactical yaw.
    const lookTarget = ship.group.position.clone().addScaledVector(frame.tangent, 60);
    ship.group.lookAt(lookTarget);
    ship.group.rotateY(Math.PI + yawJitter);
    ship.group.rotateZ(roll);
    ship.group.updateMatrixWorld(true);
    // Resolve gun ports into world space for the broadside battery.
    ship.gunPorts = ship.gunPorts.map((port) => ship.group.localToWorld(port.clone()));
    root.add(ship.group);
    list.push(ship);
  };

  // Launch deck: the player's own flagship hull below the rail start.
  {
    const deckGeo = new BoxGeometry(26, 3, 90);
    const deck = new Mesh(deckGeo, new MeshBasicMaterial({ color: new Color(0.08, 0.1, 0.13) }));
    const frame = sampleRailFrame(curve, 0.015);
    deck.position.copy(frame.position).add(new Vector3(0, -9, 6));
    root.add(deck);
    const strip = new Mesh(
      new BoxGeometry(0.4, 0.3, 80),
      createAdditiveBasicMaterial({ color: hdr(CYAN_GLOW, 1.1) }),
    );
    strip.position.set(-8, -7.2, 0);
    deck.add(strip);
  }

  // Friendly cruisers: the long flank run with the broadside lighting off
  // overhead. Held well off the rail so the camera threads open space.
  placeShip(createFriendlyCruiser(150, 1), 0.1, new Vector3(70, -8, 0), 0.22, 0.06, friendlies);
  placeShip(createFriendlyCruiser(120, 2), 0.24, new Vector3(85, 18, 0), -0.3, -0.08, friendlies);
  placeShip(createFriendlyCruiser(110, 3), 0.42, new Vector3(-80, -20, 0), 0.4, 0.1, friendlies);

  // Enemy warships: the belly run passes under the second hull.
  placeShip(createEnemyWarship(170, 4), 0.36, new Vector3(-85, 10, 0), -0.25, 0.05, hostiles);
  placeShip(createEnemyWarship(190, 5), 0.46, new Vector3(0, 24, 0), 0.08, -0.02, hostiles);
  placeShip(createEnemyWarship(150, 6), 0.62, new Vector3(-95, -12, 0), 0.5, 0.12, hostiles);

  // Enemy flagship: looming port-above the rail so the approach stays open;
  // the rail threads past its trenchworks, never through its hull.
  const flagship = createEnemyFlagship();
  placeShip(flagship, 0.9, new Vector3(-45, 22, 0), 0.06, 0.0, hostiles);

  // --- Broadside battery: a pool of beam slugs exchanged between the
  // lines. Spawn rate follows the arrangement's battle intensity.
  const beams: Beam[] = [];
  const beamGeo = new BoxGeometry(0.22, 0.22, 1);
  for (let i = 0; i < BEAM_COUNT; i += 1) {
    const mesh = new Mesh(beamGeo, createAdditiveBasicMaterial({ color: 0x000000 }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);
    beams.push({ mesh, age: 0, life: -1 });
  }

  const scratchA = new Vector3();
  const scratchB = new Vector3();

  function fireBeam(friendly: boolean) {
    const beam = beams.find((b) => b.life < 0);
    if (!beam) return;
    const fromList = friendly ? friendlies : hostiles;
    const toList = friendly ? hostiles : friendlies;
    if (fromList.length === 0 || toList.length === 0) return;
    const from = fromList[Math.floor(rng() * fromList.length)];
    const to = toList[Math.floor(rng() * toList.length)];
    if (from.gunPorts.length === 0 || to.gunPorts.length === 0) return;
    scratchA.copy(from.gunPorts[Math.floor(rng() * from.gunPorts.length)]);
    scratchB.copy(to.gunPorts[Math.floor(rng() * to.gunPorts.length)]);
    // Scatter the far end so beams rake whole hulls, not single points.
    scratchB.x += (rng() - 0.5) * 30;
    scratchB.y += (rng() - 0.5) * 14;
    scratchB.z += (rng() - 0.5) * 60;
    const mid = scratchA.clone().add(scratchB).multiplyScalar(0.5);
    beam.mesh.position.copy(mid);
    beam.mesh.lookAt(scratchB);
    // BoxGeometry's long axis is z; lookAt aims +z at the target — the beam
    // spans from muzzle toward the far hull.
    const length = scratchA.distanceTo(scratchB);
    beam.mesh.scale.set(1, 1, length);
    const color = friendly ? hdr(CYAN_GLOW, 1.5) : hdr(CRIMSON, 1.6);
    (beam.mesh.material as MeshBasicMaterial).color.copy(color);
    beam.mesh.visible = true;
    beam.age = 0;
    beam.life = 0.1 + rng() * 0.22;
    // Muzzle flash at the firing port.
    spawnGlint(scratchA, friendly ? hdr(CYAN_GLOW, 1.6) : hdr(CRIMSON, 1.8), 1.4 + rng(), 0.14);
  }

  let beamDebt = 0;
  let trenchPulse = 0;
  let breaking = false;
  let breakAge = 0;
  const flagshipFires: Array<{ position: Vector3; velocity: Vector3; age: number }> = [];

  scene.add(root);

  return {
    root,
    flagshipTrenchPulse(value) {
      trenchPulse = value;
    },
    flagshipBreaking() {
      breaking = true;
      breakAge = 0;
    },
    update(dt, elapsed, _runProgress, camera, battle) {
      // Engine flicker on every capital ship.
      const flicker = (ships: CapitalShip[], amount: number) => {
        for (const ship of ships) {
          for (let i = 0; i < ship.engines.length; i += 1) {
            const material = ship.engines[i].material as MeshBasicMaterial;
            const base = ship.engineBase[i];
            const wave = 0.82 + 0.18 * Math.sin(elapsed * 23 + i * 2.4 + ship.hullLength);
            material.color.copy(base).multiplyScalar(wave * (1 + amount * 0.2));
          }
        }
      };
      flicker(friendlies, 0.1);
      flicker(hostiles, 0.15);

      // Broadside spawn rate follows the battle intensity (arrangement).
      beamDebt += dt * (1.5 + battle * 26);
      while (beamDebt >= 1) {
        beamDebt -= 1;
        fireBeam(rng() < 0.45);
      }

      for (const beam of beams) {
        if (beam.life < 0) continue;
        beam.age += dt;
        if (beam.age >= beam.life) {
          beam.life = -1;
          beam.mesh.visible = false;
          continue;
        }
        const fade = 1 - beam.age / beam.life;
        const material = beam.mesh.material as MeshBasicMaterial;
        material.color.multiplyScalar(1 - dt * 6 * (1 - fade * 0.5));
      }

      // Flagship trench conduit breathes with the fight; on the break it
      // blooms white-hot, then gutters out as the line scatters.
      trenchPulse = Math.max(0, trenchPulse - dt * 0.7);
      const conduit = flagship.group.userData.conduit as Mesh | undefined;
      if (conduit) {
        const material = conduit.material as MeshBasicMaterial;
        if (breaking) {
          breakAge += dt;
          const bloom = Math.max(0, 1 - breakAge / 4);
          material.color.copy(hdr(CRIMSON, 0.6 + 3.2 * bloom * bloom));
        } else {
          const breathe = 0.75 + 0.25 * Math.sin(elapsed * 2.2) + trenchPulse * 1.2;
          material.color.copy(hdr(CRIMSON, 0.4).lerp(hdr(new Color(1, 0.45, 0.1), 1.7), 0.5).multiplyScalar(breathe));
        }
      }

      // Breaking flagship sheds drifting fires the camera pulls past.
      if (breaking && flagshipFires.length < 240 && Math.random() < 0.5) {
        const port = flagship.gunPorts[Math.floor(Math.random() * flagship.gunPorts.length)];
        flagshipFires.push({
          position: port.clone().add(new Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 120)),
          velocity: new Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3),
          age: 0,
        });
        spawnGlint(port, hdr(NEBULA_GOLD, 2.0), 2 + Math.random() * 2, 0.4);
      }
      for (const fire of flagshipFires) {
        fire.age += dt;
        fire.position.addScaledVector(fire.velocity, dt);
        if (Math.random() < dt * 8) {
          spawnGlint(fire.position, hdr(NEBULA_GOLD, 1.4), 1 + Math.random(), 0.3);
        }
      }

      // Nebula glow planes ride ahead of the camera and breathe almost
      // imperceptibly — the battle is backlit, never static.
      for (let i = 0; i < glowPlanes.length; i += 1) {
        glowPlanes[i].position.copy(camera.position).add(glowOffsets[i]);
        glowPlanes[i].quaternion.copy(camera.quaternion);
        (glowPlanes[i].material as MeshBasicMaterial).opacity =
          glowBaseOpacity[i] * (1 + 0.1 * Math.sin(elapsed * 0.4 + i * 2.1));
      }
    },
  };
}
