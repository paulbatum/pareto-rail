import { AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, RingGeometry, Scene, TorusGeometry, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import type { Fight } from '../gameplay';
import { BEAT, CORE_START, FACES, SOLVE_ORDER, tilePosition } from '../timing';
import { brackets, createCube, createTarget, frame, type Palette } from './models';

// Candy belongs to the puzzle and its satellites; the arena and aiming optics stay neutral.
export const PALETTE: Palette = { colors: [0xf34c68, 0xff9238, 0xffd947, 0x22cda5, 0x2488ee, 0xa873f2], ink: 0x24313c, white: 0xf9faf7, metal: 0x81939c, casing: 0x454e55, void: 0xdce6ec };
export const FACE_NAMES = ['ROSE', 'TANGERINE', 'LEMON', 'MINT', 'AZURE', 'LILAC'];
const PARTICLES = 1000, RIPPLES = 24;
const zero = new Vector3();

export function createVisuals(scene: Scene, camera: PerspectiveCamera, bus: EventBus, fight: Fight, canvas: HTMLCanvasElement) {
  const root = new Group(); root.name = 'Speedsolve arena'; scene.add(root);
  const previousBackground = scene.background, previousFog = scene.fog;
  scene.background = new Color(PALETTE.void); scene.fog = new Fog(PALETTE.void, 95, 220);
  const cube = createCube(PALETTE); root.add(cube.root);
  root.add(new HemisphereLight(0xffffff, 0xb4c2c9, 0.9), new AmbientLight(0xffffff, 0.05));
  const key = new DirectionalLight(0xfffaf2, 1.4); key.position.set(22, 36, 28); root.add(key);
  const fill = new DirectionalLight(0xe4f2ff, 0.5); fill.position.set(-26, 8, -24); root.add(fill);
  const floor = new Mesh(new PlaneGeometry(1800, 1800), new MeshBasicMaterial({ color: 0xdbe3e8 }));
  floor.name = 'Arena floor';
  floor.rotation.x = -Math.PI / 2; floor.position.y = -25; root.add(floor);
  // Nested translucent discs make a soft contact shadow without any texture.
  for (let i = 0; i < 12; i++) {
    const shadow = new Mesh(new CircleGeometry(8 + i * 0.85, 48), new MeshBasicMaterial({ color: 0x879ba7, transparent: true, opacity: 0.014, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -24.97 + i * 0.006; root.add(shadow);
  }
  const arenaRings: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const ring = new Mesh(new TorusGeometry(37 + i * 7, 0.035, 4, 128), new MeshBasicMaterial({ color: 0xb8c8d0 }));
    ring.rotation.set(Math.PI / 2 + i * 0.17, i * 0.35, i * 0.4); ring.position.y = -17 + i * 3; root.add(ring); arenaRings.push(ring);
  }
  const dial = new Group(); dial.position.y = -24.8; root.add(dial);
  const tickGeometry = new BoxGeometry(0.11, 0.06, 1.2), tickMat = new MeshBasicMaterial({ color: 0xa9bbc4 });
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, tick = new Mesh(tickGeometry, tickMat);
    tick.position.set(Math.sin(a) * 27, 0, Math.cos(a) * 27); tick.rotation.y = a;
    if (i % 6 === 0) tick.scale.z = 2; dial.add(tick);
  }

  const particleMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), PARTICLES);
  particleMesh.name = 'Confetti';
  particleMesh.frustumCulled = false; root.add(particleMesh);
  const particles = Array.from({ length: PARTICLES }, () => ({ p: new Vector3(), v: new Vector3(), age: 10, life: 0, size: 0, spin: 0 }));
  let particleIndex = 0, effectTime = 0, burstDone = false, lastVolley = -1;
  const helper = new Object3D(), turnRotation = new Quaternion();
  const paletteColors = PALETTE.colors.map(c => new Color(c));
  const ripples = Array.from({ length: RIPPLES }, () => {
    const mesh = new Mesh(new RingGeometry(0.93, 1.0, 4), new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide, transparent: true, opacity: 0, depthWrite: false }));
    mesh.visible = false; root.add(mesh); return { mesh, age: 10, life: 0.45, size: 1 };
  });
  let rippleIndex = 0;
  const queue: Group[] = [], records = new Map<number, Group>(), owned = new Set<Object3D>();
  const lastFallen = Array(6).fill(false);
  let lastTurns = 0, runEnded = false;

  function burst(at: Vector3, color: number, amount: number, speed: number, life: number, scale = 0.2) {
    for (let i = 0; i < amount; i++) {
      const index = particleIndex++ % PARTICLES, p = particles[index];
      p.p.copy(at); p.v.set(Math.random() - 0.5, Math.random() - 0.25, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      p.age = 0; p.life = life * (0.6 + Math.random() * 0.4); p.size = scale * (0.6 + Math.random() * 0.8); p.spin = (Math.random() - 0.5) * 7;
      particleMesh.setColorAt(index, color < 0 ? paletteColors[i % 6] : paletteColors[color % 6]);
    }
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  }
  function ripple(at: Vector3, size: number, color = PALETTE.ink) {
    const r = ripples[rippleIndex++ % RIPPLES]; r.mesh.position.copy(at); r.mesh.quaternion.copy(camera.quaternion); r.mesh.rotateZ(Math.PI / 4);
    r.mesh.material.color.setHex(color); r.mesh.visible = true; r.age = 0; r.size = size;
  }
  function objectColor(id: number) { return Number(records.get(id)?.userData.colorIndex ?? 0); }

  const off = [
    bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
      const mesh = queue.shift(); if (mesh) { records.set(enemyId, mesh); mesh.userData.born = effectTime; }
      if (kind !== 'letter' && mesh?.visible) ripple(worldPosition, kind === 'square' ? 2.2 : 1.3, PALETTE.white);
    }),
    bus.on('lock', ({ enemyId, worldPosition }) => { ripple(worldPosition, records.get(enemyId)?.userData.kind === 'square' ? 1.9 : 1.2); }),
    bus.on('unlock', ({ worldPosition }) => { ripple(worldPosition, 0.7, PALETTE.metal); }),
    bus.on('fire', ({ worldPosition, targetPosition, volleyId, volleySize }) => {
      burst(worldPosition.clone().lerp(targetPosition, 0.12), -1, 3, 1.2, 0.24, 0.07);
      if (volleySize === 6 && volleyId !== lastVolley) { lastVolley = volleyId ?? -1; ripple(targetPosition, 3.2); }
    }),
    bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
      ripple(worldPosition, lethal ? 1.8 : 1.1, PALETTE.white); burst(worldPosition, objectColor(enemyId), lethal ? 8 : 14, 5, 0.5);
    }),
    bus.on('kill', ({ enemyId, worldPosition, letter }) => {
      const mesh = records.get(enemyId), kind = mesh?.userData.kind;
      if (kind !== 'square' && kind !== 'core') burst(worldPosition, letter ? -1 : objectColor(enemyId), kind === 'spindle' ? 52 : 22, kind === 'spindle' ? 9 : 6, 1.1);
      records.delete(enemyId);
    }),
    bus.on('miss', ({ enemyId, worldPosition }) => { if (fight.running && records.get(enemyId)?.visible) ripple(worldPosition, 1.4, PALETTE.metal); records.delete(enemyId); }),
    bus.on('reject', () => {
      for (const mesh of records.values()) if (mesh.userData.deniedUntil > effectTime) ripple(mesh.position, 2.2);
      ui.notice.textContent = fight.running ? 'LOCK A LIT SQUARE · RELEASE TO TURN' : 'SWEEP EVERY LETTER BEFORE RELEASING';
    }),
    bus.on('runstart', () => {
      for (const p of particles) p.life = 0;
      for (const r of ripples) r.mesh.visible = false;
      records.clear(); queue.length = 0; burstDone = false; lastFallen.fill(false); lastTurns = 0; runEnded = false;
      ui.notice.textContent = ''; ui.root.classList.remove('speedsolve-attract');
    }),
    bus.on('runend', () => { runEnded = true; ui.notice.textContent = ''; }),
  ];

  const ui = installInterface(canvas);
  function updateCube(time: number) {
    const turn = fight.turn;
    const p = turn ? MathUtils.clamp((time - turn.start - BEAT * 0.53) / (BEAT * 0.47), 0, 1) : 0;
    const angle = (1 - (1 - p) ** 3) * Math.PI / 2 * (turn && turn.step % 2 ? -1 : 1);
    if (turn) turnRotation.setFromAxisAngle(FACES[turn.face].normal, angle);
    for (let face = 0; face < 6; face++) {
      const age = time - fight.fallenAt[face];
      const solved = Math.floor(1 + fight.turns[face] * 8 / 6);
      for (let cell = 0; cell < 9; cell++) {
        const index = face * 9 + cell;
        const position = tilePosition(face, cell);
        const rotation = FACES[face].quaternion.clone();
        let scale = 1;
        if (age >= 0) {
          if (age > 2.8) scale = 0;
          else {
            position.addScaledVector(FACES[face].normal, age * (8 + cell % 3));
            position.addScaledVector(FACES[face].right, (cell % 3 - 1) * age * 1.7);
            position.addScaledVector(FACES[face].up, (1 - Math.floor(cell / 3)) * age * 1.3);
            position.addScaledVector(FACES[face].up, -age * 18);
            if (cell === 4) {
              position.addScaledVector(FACES[face].right, age * 20);
              position.addScaledVector(FACES[face].up, age * 8);
            }
            position.y -= age * age * 4.8;
            rotation.multiply(new Quaternion().setFromAxisAngle(FACES[face].right, age * (cell % 2 ? 2.6 : -2.1)));
            scale = Math.min(1, (2.8 - age) * 1.7);
          }
        } else if (turn && position.dot(FACES[turn.face].normal) > 4) {
          position.applyQuaternion(turnRotation); rotation.premultiply(turnRotation);
        }
        helper.position.copy(position); helper.quaternion.copy(rotation); helper.scale.setScalar(scale); helper.updateMatrix(); cube.cases.setMatrixAt(index, helper.matrix);
        helper.position.addScaledVector(new Vector3(0, 0, 1).applyQuaternion(rotation), 0.74); helper.updateMatrix(); cube.tiles.setMatrixAt(index, helper.matrix);
        const color = SOLVE_ORDER.indexOf(cell) < solved ? face : (face + 1 + (cell * 3 + Math.floor(cell / 3)) % 5) % 6;
        cube.tiles.setColorAt(index, paletteColors[color]);
      }
      if (age >= 0 && !lastFallen[face]) {
        lastFallen[face] = true;
        for (let cell = 0; cell < 9; cell++) burst(tilePosition(face, cell), face, 9, 6, 1.8, 0.28);
        ripple(tilePosition(face, 4), 8, PALETTE.white);
      }
      cube.gears[face].rotation.z = time * (0.08 + fight.turns[face] * 0.022) * (face % 2 ? -1 : 1);
      cube.sockets[face].visible = fight.cleared <= face;
    }
    cube.cases.instanceMatrix.needsUpdate = true; cube.tiles.instanceMatrix.needsUpdate = true;
    if (cube.tiles.instanceColor) cube.tiles.instanceColor.needsUpdate = true;
    const spins = fight.cleared === 6 ? 1.0 + fight.coreHits * 0.13 : 0.25;
    cube.heart.rotation.set(time * spins * 0.55, time * spins * 0.8, time * spins * 0.35);
    cube.hoops.forEach((hoop, i) => { hoop.rotation.x = time * spins * (i + 1) * 0.25; hoop.rotation.y = time * 0.3 * (i + 1); });
    cube.center.visible = !fight.coreOpen;
    // The gimbals open into a clear sightline for the target at the center.
    cube.heart.visible = !fight.coreOpen;
    cube.machine.visible = time < fight.burstAt;
    cube.chassis.visible = fight.cleared < 6;
    if (time >= fight.burstAt && !burstDone) {
      burstDone = true; burst(zero, -1, 800, 30, 4.4, 0.34); ripple(zero, 13, PALETTE.white); ripple(zero, 9, PALETTE.ink);
    }
    if (burstDone) cube.root.visible = false; else cube.root.visible = true;
    const turns = fight.turns.reduce((a, b) => a + b, 0);
    if (turns > lastTurns) { lastTurns = turns; ripple(tilePosition(fight.face, 4), 7.5, PALETTE.white); }
  }
  function update(dt: number, elapsed: number) {
    effectTime += dt;
    const time = fight.running || runEnded ? fight.time : elapsed;
    updateCube(time);
    for (let i = 0; i < PARTICLES; i++) {
      const p = particles[i]; p.age += dt;
      if (p.age >= p.life) helper.scale.setScalar(0);
      else {
        p.v.y -= dt * 2.4; p.p.addScaledVector(p.v, dt); helper.position.copy(p.p);
        helper.rotation.set(p.age * p.spin, p.age * p.spin * 0.7, p.age * p.spin * 1.2);
        helper.scale.setScalar(p.size * Math.min(1, (p.life - p.age) * 2));
      }
      helper.updateMatrix(); particleMesh.setMatrixAt(i, helper.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    for (const r of ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt; const p = r.age / r.life;
      if (p >= 1) r.mesh.visible = false;
      else { r.mesh.scale.setScalar(r.size * (0.6 + p * 0.9)); r.mesh.material.opacity = (1 - p) * 0.7; }
    }
    for (const mesh of records.values()) {
      if (mesh.visible && mesh.userData.buildKind) {
        const model = createTarget(mesh.userData.buildKind, PALETTE);
        mesh.add(...model.children.slice());
        Object.assign(mesh.userData, model.userData);
        delete mesh.userData.buildKind;
      }
      const mat = mesh.userData.paint as MeshStandardMaterial | undefined;
      if (mat) { mat.color.copy(paletteColors[Number(mesh.userData.colorIndex ?? 0) % 6]); mat.emissive.copy(mat.color).multiplyScalar(mesh.userData.locked ? 0.35 : 0.14); }
      const pulse = mesh.userData.pulse as Group | undefined;
      if (pulse) pulse.scale.setScalar(1 + Math.sin(time * Math.PI * 2 / BEAT) * 0.028);
      const locked = mesh.userData.lockFrame as Group | undefined;
      if (locked) {
        locked.visible = Boolean(mesh.userData.locked) || (mesh.userData.deniedUntil ?? 0) > effectTime;
        locked.scale.setScalar(mesh.userData.charging ? 0.8 + Math.sin(time * 14) * 0.09 : 1);
      }
      const confirm = mesh.userData.confirm as Group | undefined;
      if (confirm) confirm.visible = Boolean(mesh.userData.locked);
    }
    for (const object of owned) {
      if (!object.parent && effectTime - Number(object.userData.createdAt ?? 0) > dt * 2) {
        releaseResources(object); owned.delete(object);
      }
    }
    const state = burstDone ? 'SOLVED' : fight.cleared === 6 ? (time < CORE_START ? 'CORE SPIN-UP' : 'FINAL BARRAGE') : time >= fight.fallenAt[fight.face] ? 'BREAK THE SPINDLE' : `SOLVE ${FACE_NAMES[fight.face]}`;
    ui.phase.textContent = state;
    ui.counter.textContent = `${String(fight.cleared).padStart(2, '0')} / 06`;
    ui.timer.textContent = fight.running || runEnded ? Math.max(0, 60 - fight.time).toFixed(2) : '60.00';
    ui.progress.style.width = `${Math.min(100, (fight.turns[fight.face] / 6) * 100)}%`;
    ui.progress.style.backgroundColor = '#' + PALETTE.colors[fight.face].toString(16).padStart(6, '0');
    ui.pips.forEach((pip, i) => { pip.style.opacity = i < fight.cleared ? '1' : '.18'; pip.style.transform = i === fight.face && fight.cleared < 6 ? 'translateY(-3px)' : ''; });
  }
  function track(object: Object3D) { object.userData.createdAt = effectTime; owned.add(object); return object; }
  const factories = {
    createEnemyMesh(kind: string, letter?: string) {
      const lazy = ['square', 'spindle', 'core'].includes(kind);
      const mesh = lazy ? new Group() : createTarget(kind, PALETTE, letter);
      if (lazy) mesh.userData.buildKind = kind;
      mesh.userData.kind = kind; queue.push(mesh); track(mesh); return mesh;
    },
    setEnemyLocked(mesh: Object3D, locked: boolean) {
      mesh.userData.locked = locked;
      const f = mesh.userData.lockFrame as Group | undefined; if (f) f.visible = locked;
    },
    setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = effectTime + 0.48; ripple(mesh.position, 2.6); },
    createProjectileMesh() {
      const group = new Group();
      group.add(new Mesh(new BoxGeometry(0.10, 0.10, 0.9), new MeshBasicMaterial({ color: PALETTE.ink })));
      const bright = new Mesh(new BoxGeometry(0.055, 0.055, 1.15), new MeshBasicMaterial({ color: PALETTE.white })); bright.position.z = 0.1; group.add(bright);
      return track(group);
    },
    createReticle() {
      const reticle = new Group(), black = frame(0.67, 0.065, PALETTE.ink), white = frame(0.56, 0.027, PALETTE.white);
      white.position.z = 0.03; reticle.add(black, white);
      const pipGeo = new BoxGeometry(0.085, 0.085, 0.035);
      for (let i = 0; i < 6; i++) {
        const pip = new Mesh(pipGeo, new MeshBasicMaterial({ color: PALETTE.ink })); pip.position.set((i - 2.5) * 0.12, -0.52, 0); reticle.add(pip);
      }
      return track(reticle);
    },
    setReticleActive(reticle: Object3D, active: boolean, count: number) {
      reticle.visible = true; reticle.scale.setScalar(active ? 0.94 : 1);
      for (let i = 0; i < 6; i++) {
        const pip = reticle.children[i + 2] as Mesh<BoxGeometry, MeshBasicMaterial>;
        pip.material.color.setHex(i < count ? PALETTE.colors[i] : PALETTE.ink); pip.scale.setScalar(i < count ? 1.15 : 0.6);
      }
    },
  };
  function dispose() {
    off.forEach(fn => fn()); ui.dispose(); scene.remove(root); scene.background = previousBackground; scene.fog = previousFog;
    for (const object of [root, ...owned]) releaseResources(object);
    owned.clear(); records.clear();
  }
  updateCube(0);
  return { factories, update, dispose, targets: records };
}

function releaseResources(object: Object3D) {
  const geometries = new Set<{ dispose(): void }>(), materials = new Set<{ dispose(): void }>();
  object.traverse(child => {
    if ('geometry' in child) geometries.add((child as Mesh).geometry);
    if ('material' in child) { const mat = (child as Mesh).material; (Array.isArray(mat) ? mat : [mat]).forEach(m => materials.add(m)); }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}

function installInterface(canvas: HTMLCanvasElement) {
  const style = document.createElement('style');
  style.textContent = `
  body.speedsolve-level #hud { background: linear-gradient(#e6edf0bb, #e6edf000); }
  body.speedsolve-level .hud-label { color:#647783; }
  body.speedsolve-level .hud-value, body.speedsolve-level .hull-pip.filled { color:#263945; text-shadow:none; }
  body.speedsolve-level .callout { bottom:18%; background:#f9faf7ed; color:#263945; border-color:#9bacb5; text-shadow:none; font-size:12px; }
  body.speedsolve-level .tip { color:#263945; background:#f9faf7ee; border-color:#aabcc5; text-shadow:none; font-size:11px; line-height:1.8; }
  body.speedsolve-level .scanlines { display:none; }
  .speedsolve-ui { position:absolute; inset:0; pointer-events:none; color:#263945; font-family:ui-monospace,monospace; user-select:none; z-index:2; }
  .speedsolve-title { position:absolute; top:24px; left:50%; transform:translateX(-50%); text-align:center; }
  .speedsolve-title strong { display:block; font:700 clamp(18px,2.2vw,28px)/1.2 ui-monospace,monospace; letter-spacing:.3em; padding-left:.3em; }
  .speedsolve-title span { display:block; font-size:8px; letter-spacing:.22em; margin-top:9px; color:#748892; }
  .speedsolve-stats { position:absolute; left:30px; bottom:38px; }
  .speedsolve-stats small, .speedsolve-clock small { display:block; font-size:9px; letter-spacing:.2em; color:#657b86; margin-bottom:7px; }
  .speedsolve-count { font-size:24px; letter-spacing:.15em; }
  .speedsolve-pips { display:flex; gap:5px; margin-top:12px; }
  .speedsolve-pips i { width:16px; height:5px; transition:opacity .2s, transform .2s; }
  .speedsolve-clock { position:absolute; right:30px; bottom:38px; text-align:right; }
  .speedsolve-clock b { font-size:27px; font-weight:400; letter-spacing:.1em; }
  .speedsolve-status { position:absolute; left:50%; bottom:42px; transform:translateX(-50%); width:240px; text-align:center; }
  .speedsolve-status b { display:block; font-size:11px; letter-spacing:.18em; font-weight:500; }
  .speedsolve-track { margin-top:11px; height:3px; background:#c9d4da; }
  .speedsolve-progress { height:100%; transition:width .16s; }
  .speedsolve-notice { position:absolute; left:50%; bottom:110px; transform:translateX(-50%); width:80%; text-align:center; font-size:10px; letter-spacing:.08em; }
  .speedsolve-attract .speedsolve-status { display:none; }
  @media(max-width:650px) { .speedsolve-title {top:78px} .speedsolve-status{bottom:24px;width:170px} .speedsolve-stats{left:16px;bottom:20px} .speedsolve-clock{right:16px;bottom:20px} .speedsolve-clock b,.speedsolve-count{font-size:18px} }
  `;
  document.head.appendChild(style); document.body.classList.add('speedsolve-level');
  const root = document.createElement('div'); root.className = 'speedsolve-ui speedsolve-attract';
  root.innerHTML = '<div class="speedsolve-title"><strong>SPEEDSOLVE</strong><span>CHROMATIC ENGINE &nbsp; / &nbsp; 128 BPM</span></div><div class="speedsolve-stats"><small>FACES CONQUERED</small><div class="speedsolve-count">00 / 06</div><div class="speedsolve-pips"></div></div><div class="speedsolve-clock"><small>TIME TO SOLVE</small><b>60.00</b></div><div class="speedsolve-status"><b>SOLVE ROSE</b><div class="speedsolve-track"><div class="speedsolve-progress"></div></div></div><div class="speedsolve-notice"></div>';
  (canvas.parentElement ?? document.body).appendChild(root);
  const pips = PALETTE.colors.map(color => { const pip = document.createElement('i'); pip.style.backgroundColor = '#' + color.toString(16).padStart(6, '0'); root.querySelector('.speedsolve-pips')!.appendChild(pip); return pip; });
  return { root, pips, phase: root.querySelector<HTMLElement>('.speedsolve-status b')!, counter: root.querySelector<HTMLElement>('.speedsolve-count')!, timer: root.querySelector<HTMLElement>('.speedsolve-clock b')!, progress: root.querySelector<HTMLElement>('.speedsolve-progress')!, notice: root.querySelector<HTMLElement>('.speedsolve-notice')!, dispose() { root.remove(); style.remove(); document.body.classList.remove('speedsolve-level'); } };
}
