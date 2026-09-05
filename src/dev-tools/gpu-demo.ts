/* Dev-only demos for `npm run snapshot`, framing the engine's GPU particle system
   and baked environment lighting in isolation:

   npm run snapshot -- --module src/dev-tools/gpu-demo.ts --export createParticleBurstDemo --bloom 0
   npm run snapshot -- --module src/dev-tools/gpu-demo.ts --export createEnvironmentLitDemo --bloom 0

   Each export returns a function of the snapshot context, so the harness hands it
   the initialized renderer before framing the returned group. */
import {
  AgXToneMapping,
  GridHelper,
  Group,
  IcosahedronGeometry,
  Mesh,
  SphereGeometry,
  TorusKnotGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { bakeEnvironment, createGradientSky } from '../engine/environment-light';
import { createGpuParticles } from '../engine/gpu-particles';
import type { SnapshotContext } from './snapshot';

const BURST_CAPACITY = 120_000;
const BURST_STEPS = 40;
const STEP_DT = 1 / 60;

export function createParticleBurstDemo() {
  return ({ renderer }: SnapshotContext) => {
    const group = new Group();
    group.add(new GridHelper(12, 12, 0x223044, 0x141c28));

    const emitter = new Mesh(new SphereGeometry(0.2, 16, 12), new MeshBasicNodeMaterial({ color: 0xffd28a }));
    emitter.position.set(0, 0.6, 0);
    group.add(emitter);

    const particles = createGpuParticles(renderer, {
      capacity: BURST_CAPACITY,
      forces: {
        gravity: new Vector3(0, -3, 0),
        drag: 0.6,
        turbulence: { strength: 12, scale: 0.9, drift: 0.4 },
      },
    });
    group.add(particles.object);

    const origin = new Vector3(0, 0.6, 0);
    particles.emit(origin, 40_000, { speed: 7, spread: 1, life: 1.8, size: 0.09, color: 0xff7a2a });
    particles.emit(origin, 30_000, { direction: new Vector3(0, 1, 0), speed: 9, spread: 0.35, life: 1.6, size: 0.07, color: 0x6ad4ff });
    particles.emit(origin, 20_000, { direction: new Vector3(1, 0.3, 0), speed: 5, spread: 0.2, life: 2, size: 0.12, color: 0xfff1c0 });
    for (let i = 0; i < BURST_STEPS; i += 1) {
      if (i === 25) particles.emit(new Vector3(-2.5, 1.5, 1), 12_000, { speed: 4, life: 1.2, size: 0.1, color: 0xc86bff });
      particles.update(STEP_DT);
    }
    console.log(`[gpu-demo] particles ${JSON.stringify(particles.status())}`);
    return group;
  };
}

export function createEnvironmentLitDemo() {
  return ({ renderer, scene }: SnapshotContext) => {
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1;

    const sky = createGradientSky({
      zenith: 0x3a6fc0,
      horizon: 0xd8e3f0,
      ground: 0x6b5a4a,
      skyIntensity: 1.6,
      sunDirection: new Vector3(0.5, 0.55, -0.4),
      sunIntensity: 400,
    });
    const environment = bakeEnvironment(renderer, () => sky.scene, { sigma: 0.02 });
    environment.attach(scene);

    const group = new Group();
    const matte = new Mesh(new IcosahedronGeometry(0.55, 4), new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    matte.position.set(2.2, 0.55, -1.5);
    group.add(matte);

    const chrome = new MeshPhysicalNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 });
    const gold = new MeshPhysicalNodeMaterial({ color: 0xffb54a, metalness: 1, roughness: 0.35 });
    const lacquer = new MeshPhysicalNodeMaterial({ color: 0x8a1030, metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 });
    const glass = new MeshPhysicalNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 1, thickness: 0.8, ior: 1.5 });
    const iridescent = new MeshPhysicalNodeMaterial({ color: 0x223344, metalness: 0.6, roughness: 0.25, iridescence: 1, iridescenceIOR: 1.3 });

    const knot = new Mesh(new TorusKnotGeometry(0.7, 0.24, 160, 24), chrome);
    knot.position.set(0, 1.1, 0);
    group.add(knot);
    const balls = [gold, lacquer, glass, iridescent];
    balls.forEach((material, i) => {
      const ball = new Mesh(new IcosahedronGeometry(0.55, 4), material);
      ball.position.set(-2.4 + i * 1.6, 0.55, 2);
      group.add(ball);
    });
    return group;
  };
}
