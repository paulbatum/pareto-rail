import { ConeGeometry, Group, Mesh, PointLight, Scene, SphereGeometry, Vector3 } from 'three';
import type { Node } from 'three/webgpu';
import { ESCAPEMENT_BAR, ESCAPEMENT_MARKERS, PENDULUM_PERIOD } from '../../timing';
import { gearClock } from '../gears';
import { gearDisplacementClock } from '../materials';
import { applyEnvironmentNode, createBrassMaterial, createFill, createLamp, createLampMaterial, strikeAge, strikeOrigin, strikeStrength } from '../materials';
import { barrelCorridor, barrelExit, createBarrel, type BarrelLayout } from './barrel';
import { beginStrike, createBell, hammerLiftAt, type Bell, type BellLayout } from './bell';
import { createDial, dialGateway, type DialLayout } from './dial';
import { createOrrery, type OrreryLayout } from './orrery';
import { createPendulum, type Pendulum, type PendulumLayout } from './pendulum';
import { chainWheels, createTrain, GREAT_20, GREAT_30, RIDE_HEIGHT, rimPoint, type TrainLayout, type TrainWheel } from './train';

// World layout. The run travels toward -z. After the Barrel the rail's straight
// runs lie on the line x = RAIL_X. Heights: the rail rides at y = 0 through the
// Barrel and the Train; the Pendulum bob rests at y = 20; the Free Run climbs.
//
// | Set      | Anchor                                   | Rail entry (heading)                    | Rail exit (heading)                       |
// | -------- | ---------------------------------------- | --------------------------------------- | ----------------------------------------- |
// | Barrel   | arbor (0, 0, 0), drum radius 236         | (0, 0, 130) heading +x, corridor turn   | corridor end (140, 0, 0) heading -z; drum doorway (140, 0, -190) |
// | Train A  | centre (290, -21, -260), 30 teeth, r 150 | (140, 0, -260) heading -z, angle 180deg | (175.1, 0, -356.4) heading (0.643, 0, -0.766), angle 220deg |
// | Train B  | centre (98.5, -21, -420.7), 20 teeth, r 100 | (175.1, 0, -356.4), angle 40deg      | (175.1, 0, -485.0) heading (-0.643, 0, -0.766), angle -40deg |
// | Train C  | centre (290, -21, -581.4), 30 teeth, r 150 | (175.1, 0, -485.0), angle 140deg      | (140, 0, -581.4) heading -z, angle 180deg |
// | Train D  | centre (40, -21, -581.4), 20 teeth, scenery only | -                                | -                                         |
// | Back plate doorway | (140, 0, -700), 44 wide, 56 tall | (140, 0, -700) heading -z            | open black beyond                          |
// | Orrery   | sun (360, 40, -960)                      | (140, 0, -700) heading -z               | (140, 0, -1150) heading -z                |
// | Bell     | mouth (-40, 20, -1240), hammer on +x side | (140, 0, -1150) heading -z             | (140, 0, -1330) heading -z                |
// | Pendulum | pivot (140, 320, -1420), rod 300, bob rest (140, 20, -1420) | bob frame from bar 29 | released at the bottom of a swing        |
// | Dial     | centre (140, -640, -1780), radius 980    | Free Run ray from (140, 20, -1420)      | XII gateway (140, 200, -1780), 150 x 120 |
//
// Train wheels spin about +y at the rate the rail rides them: A -0.1164 rad/s
// (40deg in 6 s), B +0.1745 rad/s (80deg in 8 s), C -0.1164 rad/s. The rail
// rides each pitch circle RIDE_HEIGHT above the wheel's top face; the parent
// frame for a Train section is a rotation about the wheel centre by
// `rate * (time - sectionStart)`. The pendulum swing is a rotation about +z
// through the pivot by `amplitude * sin(2 * PI * (time - pendulumStart) / PENDULUM_PERIOD)`;
// positive angle carries the bob toward +x.

export const RAIL_X = 140;
const RAIL_Y = 0;

export const BARREL_LAYOUT: BarrelLayout = {
  center: new Vector3(0, 0, 0),
  corridorRadius: 140,
  pitch: 40,
  bandHeight: 44,
  drumRadius: 236,
};

export const LAMP_POSITION = new Vector3(60, 112, -30);
const LAMP_INTENSITY = 240;
const WORKS_LAMP_POSITION = new Vector3(140, 760, -1300);
const WORKS_LAMP_INTENSITY = 420;

const TRAIN_ENTRY = new Vector3(RAIL_X, RAIL_Y, -260);
const WHEEL_TOP = RAIL_Y - RIDE_HEIGHT;
export const TRAIN_ARCS = [
  { spec: GREAT_30, arc: (40 * Math.PI) / 180, seconds: 6 },
  { spec: GREAT_20, arc: (-80 * Math.PI) / 180, seconds: 8 },
  { spec: GREAT_30, arc: (40 * Math.PI) / 180, seconds: 6 },
  { spec: GREAT_20, arc: (-60 * Math.PI) / 180, seconds: 6 },
];
/** Wheels the rail rides, in order; the fourth chained wheel is scenery. */
export const RIDDEN_WHEELS = 3;

export const TRAIN_LAYOUT: TrainLayout = {
  wheels: chainWheels(TRAIN_ENTRY, new Vector3(0, 0, -1), TRAIN_ARCS, WHEEL_TOP - GREAT_30.width / 2),
  wheelTop: WHEEL_TOP,
  backPlate: { z: -700, xMin: -380, xMax: 620, yMin: -330, yMax: 330, doorway: { x: RAIL_X, y: RAIL_Y, width: 44, height: 56 } },
  leftPlate: { x: -380, zMin: -700, zMax: -150, yMin: -330, yMax: 330 },
  rightPlate: { x: 620, zMin: -700, zMax: -150, yMin: -330, yMax: 330 },
  floorY: -400,
};

export const ORRERY_LAYOUT: OrreryLayout = {
  sun: new Vector3(RAIL_X + 220, 40, -960),
  sunRadius: 34,
  arms: [
    { length: 190, height: -60, period: 44, planetRadius: 14, phase: 0.4, moons: 0 },
    { length: 300, height: 85, period: 62, planetRadius: 22, phase: 2.1, moons: 1 },
    { length: 430, height: -130, period: 84, planetRadius: 30, phase: 3.9, moons: 0 },
    { length: 580, height: 150, period: 110, planetRadius: 42, phase: 1.3, moons: 2 },
    { length: 760, height: -200, period: 150, planetRadius: 55, phase: 5.2, moons: 1 },
    { length: 960, height: 230, period: 200, planetRadius: 70, phase: 2.9, moons: 3 },
    { length: 1180, height: -280, period: 260, planetRadius: 84, phase: 4.4, moons: 2 },
    { length: 1400, height: 320, period: 330, planetRadius: 96, phase: 0.9, moons: 4 },
  ],
};

export const BELL_LAYOUT: BellLayout = {
  mouth: new Vector3(-40, 20, -1240),
  radius: 52,
  height: 78,
  hammerSide: 1,
};

export const PENDULUM_LAYOUT: PendulumLayout = {
  pivot: new Vector3(RAIL_X, 320, -1420),
  length: 300,
  bobRadius: 46,
  escapeWheel: new Vector3(RAIL_X, 420, -1435),
  crownWheel: new Vector3(RAIL_X, 590, -1435),
  mount: new Vector3(RAIL_X, 500, -1420),
  plate: { z: -1482, xMin: RAIL_X - 224, xMax: RAIL_X + 224, yMin: 150, yMax: 720 },
};

export const DIAL_LAYOUT: DialLayout = {
  center: new Vector3(RAIL_X, -640, -1780),
  radius: 980,
  numeralRadius: 840,
  doorway: { width: 150, height: 120 },
  hands: { hour: 4.6, minute: 7.3 },
};

/** Where the bob rests when the pendulum hangs straight down. */
export const BOB_REST = PENDULUM_LAYOUT.pivot.clone().add(new Vector3(0, -PENDULUM_LAYOUT.length, 0));

/** Camera far plane that reaches the dial's far edge from the barrel start. */
export const SUGGESTED_FAR_PLANE = 2600;

/** Default pendulum amplitude in radians; the boss loop raises it. */
const DEFAULT_AMPLITUDE = (20 * Math.PI) / 180;
/** Free Run spin-up: the rate the wheels reach after four bars. */
const FREE_RUN_SPIN = 24;
const FREE_RUN_SPIN_BARS = 4;
/** After this many seconds a strike wave has decayed below visibility. */
const STRIKE_LIFETIME = 5;

export type EscapementLayout = {
  barrel: BarrelLayout;
  train: TrainLayout;
  orrery: OrreryLayout;
  bell: BellLayout;
  pendulum: PendulumLayout;
  dial: DialLayout;
  /** Corridor centreline through the Barrel: t in [0, 1]. */
  barrelCorridor(t: number): { position: Vector3; tangent: Vector3 };
  /** Doorway in the barrel drum. */
  barrelExit: Vector3;
  /** Rail point on a ridden wheel at polar angle `angle` about +y. */
  trainPoint(wheel: TrainWheel, angle: number): Vector3;
  /** Doorway in the back plate. */
  backPlateDoorway: Vector3;
  /** XII gateway the Free Run passes through. */
  dialGateway: Vector3;
  bobRest: Vector3;
};

export type EscapementEnvironmentOptions = {
  /** PMREM environment lighting for every metal material, when the bake is available. */
  environmentNode?: Node;
};

export type EscapementEnvironment = {
  root: Group;
  layout: EscapementLayout;
  /** Advances gears, hammer, strike wave and the default pendulum swing. `section` is a run-section name from timing. */
  update(time: number, section: string): void;
  /** Restarts the strike wave from the bell with `age` seconds already elapsed (0 for a fresh strike). */
  setStrike(age: number, strength?: number): void;
  /** Multiplies every gear's spin rate; 1 is the authored rate. */
  setSpinRate(rate: number): void;
  setPendulumAmplitude(radians: number): void;
  /** Overrides the swing for this frame; the default sine resumes when not called. */
  setPendulumAngle(radians: number): void;
  getPendulumAngle(): number;
  getPendulumPivot(): Vector3;
  /** The PointLight named `escapement-lamp`, for the god-rays stage. */
  getLampLight(): PointLight;
  /** The PointLight named `escapement-sun`, for the lens-flare stage. */
  getSunLight(): PointLight;
  /** Attach the escapement boss body here. */
  escapementMount: Group;
  pendulum: Pendulum;
  bell: Bell;
  dispose(): void;
};

/** The hanging lamp above the barrel: brass shade, warm-white bulb, the only emissive surface in the works. */
function createLampFixture(position: Vector3) {
  const group = new Group();
  const shade = new Mesh(new ConeGeometry(34, 30, 24, 1, true), createBrassMaterial({ tarnish: 0.25, brushAxis: new Vector3(0, 1, 0) }));
  shade.material.side = 2;
  shade.position.copy(position).add(new Vector3(0, 18, 0));
  group.add(shade);
  const bulb = new Mesh(new SphereGeometry(9, 24, 16), createLampMaterial(3.2));
  bulb.position.copy(position);
  bulb.name = 'escapement-lamp-body';
  group.add(bulb);
  const stem = new Mesh(new ConeGeometry(3, 220, 8), createBrassMaterial({ tarnish: 0.3 }));
  stem.position.copy(position).add(new Vector3(0, 140, 0));
  group.add(stem);
  return group;
}

export function createEscapementEnvironment(scene: Scene, options: EscapementEnvironmentOptions = {}): EscapementEnvironment {
  if (options.environmentNode) applyEnvironmentNode(options.environmentNode);
  const root = new Group();
  root.name = 'escapement-environment';

  root.add(createBarrel(BARREL_LAYOUT));
  const train = createTrain(TRAIN_LAYOUT);
  root.add(train.group);
  const orrery = createOrrery(ORRERY_LAYOUT);
  root.add(orrery.group);
  const bell = createBell(BELL_LAYOUT);
  root.add(bell.group);
  const pendulum = createPendulum(PENDULUM_LAYOUT);
  root.add(pendulum.group);
  root.add(createDial(DIAL_LAYOUT));

  const lamp = createLamp({ name: 'escapement-lamp', position: LAMP_POSITION, intensity: LAMP_INTENSITY });
  root.add(lamp);
  root.add(createLampFixture(LAMP_POSITION));
  root.add(createLamp({ name: 'escapement-works-lamp', position: WORKS_LAMP_POSITION, intensity: WORKS_LAMP_INTENSITY }));
  root.add(createFill());
  scene.add(root);

  const layout: EscapementLayout = {
    barrel: BARREL_LAYOUT,
    train: TRAIN_LAYOUT,
    orrery: ORRERY_LAYOUT,
    bell: BELL_LAYOUT,
    pendulum: PENDULUM_LAYOUT,
    dial: DIAL_LAYOUT,
    barrelCorridor: (t) => barrelCorridor(BARREL_LAYOUT, t),
    barrelExit: barrelExit(BARREL_LAYOUT),
    trainPoint: (wheel, angle) => rimPoint(wheel, angle, RAIL_Y),
    backPlateDoorway: new Vector3(RAIL_X, RAIL_Y, TRAIN_LAYOUT.backPlate.z),
    dialGateway: dialGateway(DIAL_LAYOUT),
    bobRest: BOB_REST,
  };

  let lastTime = 0;
  let spinRate = 1;
  let spinOverridden = false;
  let amplitude = DEFAULT_AMPLITUDE;
  let angleOverridden = false;
  let struck = false;
  let strikeActive = false;
  gearClock.value = 0;
  strikeAge.value = 1e4;
  strikeStrength.value = 0;

  const setStrike = (age: number, strength = 7) => {
    beginStrike(bell.origin, strength);
    strikeAge.value = age;
    strikeActive = true;
  };

  return {
    root,
    layout,
    pendulum,
    bell,
    escapementMount: pendulum.mount,
    update(time, section) {
      if (time < lastTime) {
        lastTime = time;
        gearClock.value = Math.max(0, time);
        // Both clock samples take the new value, so the jump is not reported as motion.
        gearDisplacementClock.set(gearClock.value);
        gearDisplacementClock.set(gearClock.value);
        struck = false;
      }
      const dt = Math.max(0, time - lastTime);
      lastTime = time;

      if (!spinOverridden) {
        const sinceFreeRun = time - ESCAPEMENT_MARKERS.freeRun;
        if (section === 'free-run' || sinceFreeRun >= 0) {
          const t = Math.min(1, Math.max(0, sinceFreeRun / (FREE_RUN_SPIN_BARS * ESCAPEMENT_BAR)));
          spinRate = 1 + (FREE_RUN_SPIN - 1) * t * t;
        } else {
          spinRate = 1;
        }
      }
      gearClock.value += dt * spinRate;
      gearDisplacementClock.set(gearClock.value);

      bell.setHammer(hammerLiftAt(time, ESCAPEMENT_MARKERS.strike, ESCAPEMENT_BAR));
      if (!struck && time >= ESCAPEMENT_MARKERS.strike) {
        struck = true;
        setStrike(Math.min(time - ESCAPEMENT_MARKERS.strike, 0.2));
      }
      if (strikeActive) {
        strikeAge.value += dt;
        if (strikeAge.value > STRIKE_LIFETIME) {
          strikeActive = false;
          strikeStrength.value = 0;
        }
      }

      if (!angleOverridden) {
        const phase = (2 * Math.PI * (time - ESCAPEMENT_MARKERS.pendulum)) / PENDULUM_PERIOD;
        pendulum.setAngle(amplitude * Math.sin(phase));
      }
      angleOverridden = false;
    },
    setStrike,
    setSpinRate(rate) {
      spinRate = rate;
      spinOverridden = true;
    },
    setPendulumAmplitude(radians) {
      amplitude = radians;
    },
    setPendulumAngle(radians) {
      pendulum.setAngle(radians);
      angleOverridden = true;
    },
    getPendulumAngle: () => pendulum.getAngle(),
    getPendulumPivot: () => PENDULUM_LAYOUT.pivot.clone(),
    getLampLight: () => lamp,
    getSunLight: () => orrery.sunLight,
    dispose() {
      scene.remove(root);
      root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      });
      strikeStrength.value = 0;
      strikeOrigin.value.set(0, 0, 0);
    },
  };
}

/** Snapshot factory: the whole layout from outside. */
export function previewEscapementEnvironment() {
  const scene = new Scene();
  const environment = createEscapementEnvironment(scene);
  environment.update(30, 'orrery');
  return environment.root;
}
