import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createThermalRail } from '../gameplay';
import { collectModed, modeMaterial, type ModedEntry } from './moded';
import {
  ATMOS,
  CREAM_DIRTY,
  hdr,
  IR_BLACK,
  IR_COLD,
  IR_WARM,
  LAMP,
  OCHRE,
  RUST,
  RUST_DARK,
  WATER,
} from './palette';

// The drowned harbor: black water below, wrecked hulls and cranes flanking the
// route, chains and pipe stacks closer in, hard sodium lamps burning through
// the murk, and a far gantry skyline. Everything registers moded materials so
// the infrared driver can swap the world to charcoal.

export type Environment = {
  root: Group;
  modedEntries: ModedEntry[];
  update(cameraU: number, dt: number): void;
  dispose(): void;
};

const environmentMaterial = (murk: Parameters<typeof modeMaterial>[1]['murk'], ir = IR_COLD, blindDim = 0.82) =>
  modeMaterial(new MeshBasicMaterial({ color: murk.clone() }), { murk: murk.clone(), ir: ir.clone(), blindDim });

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  const curve = createThermalRail();

  scene.fog = new FogExp2(ATMOS.murk.fog.getHex(), ATMOS.murk.density);
  scene.background = ATMOS.murk.background.clone();

  // Shared materials, one per family, so the mode driver touches a short list.
  const hullMaterial = environmentMaterial(RUST_DARK.clone().multiplyScalar(0.55));
  const plateMaterial = environmentMaterial(RUST.clone().multiplyScalar(0.42));
  const paintMaterial = environmentMaterial(CREAM_DIRTY.clone().multiplyScalar(0.45));
  const skylineMaterial = environmentMaterial(RUST_DARK.clone().multiplyScalar(0.3), IR_BLACK, 0.7);
  const lampPostMaterial = environmentMaterial(RUST_DARK.clone().multiplyScalar(0.45));
  const lampMaterial = modeMaterial(createAdditiveBasicMaterial({ color: hdr(LAMP, 2.1) }), {
    murk: hdr(LAMP, 2.1),
    ir: IR_WARM.clone().multiplyScalar(0.65),
    blindDim: 0.68,
  });
  const lampConeMaterial = modeMaterial(createAdditiveBasicMaterial({ color: hdr(LAMP, 0.22), opacity: 0.3, side: DoubleSide }), {
    murk: hdr(LAMP, 0.22),
    ir: IR_WARM.clone().multiplyScalar(0.1),
    murkOpacity: 0.3,
    irOpacity: 0.14,
    blindDim: 0.8,
  });
  const waterMaterial = modeMaterial(new MeshBasicMaterial({ color: WATER.clone() }), {
    murk: WATER.clone(),
    ir: IR_BLACK.clone(),
    blindDim: 0.5,
  });
  const sheenMaterial = modeMaterial(createAdditiveBasicMaterial({ color: OCHRE.clone().multiplyScalar(0.06), opacity: 0.5, side: DoubleSide }), {
    murk: OCHRE.clone().multiplyScalar(0.06),
    ir: IR_BLACK.clone(),
    murkOpacity: 0.5,
    irOpacity: 0.1,
    blindDim: 0.9,
  });
  const gritMaterial = modeMaterial(createAdditiveBasicMaterial({ color: OCHRE.clone().multiplyScalar(0.16), opacity: 0.5, side: DoubleSide }), {
    murk: OCHRE.clone().multiplyScalar(0.16),
    ir: IR_WARM.clone().multiplyScalar(0.12),
    murkOpacity: 0.5,
    irOpacity: 0.35,
    blindDim: 0.85,
  });

  // Water: two long planes riding under the whole rail.
  const water = new Mesh(new PlaneGeometry(420, 860), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -8.5, -260);
  const sheen = new Mesh(new PlaneGeometry(420, 860), sheenMaterial);
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.set(0, -8.35, -260);
  root.add(water, sheen);

  const fields: ScatterField[] = [];

  // Wrecked hulls: capsized hull sections listing in the water.
  fields.push(scatterAlongRail(curve, {
    count: 9,
    seed: 71,
    window: { behind: 40, ahead: 190 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() > 0.5 ? 1 : -1) * (22 + rng() * 26), -7 + rng() * 2, 0),
    }),
    make: (index, rng) => {
      const wreck = new Group();
      const length = 16 + rng() * 12;
      const height = 4 + rng() * 3.5;
      const hull = new Mesh(new BoxGeometry(length, height, 5 + rng() * 3), hullMaterial);
      const deck = new Mesh(new BoxGeometry(length * 0.94, 0.5, 4.6), plateMaterial);
      deck.position.y = height / 2 + 0.2;
      const house = new Mesh(new BoxGeometry(3 + rng() * 2, 2.4 + rng() * 2, 3), paintMaterial);
      house.position.set((rng() - 0.5) * length * 0.5, height / 2 + 1.6, 0);
      const stack = new Mesh(new CylinderGeometry(0.5, 0.65, 3.4, 8), hullMaterial);
      stack.position.set((rng() - 0.5) * length * 0.4, height / 2 + 2.1, 0.6);
      wreck.add(hull, deck, house, stack);
      wreck.name = 'harbor-wreck';
      wreck.rotation.z = (rng() - 0.5) * 0.5;
      wreck.rotation.y = (rng() - 0.5) * 0.9;
      return wreck;
    },
  }));

  // Harbor cranes, snapped and leaning. Kept outside the skimmer cross-lanes
  // so their tall posts never shadow a target.
  fields.push(scatterAlongRail(curve, {
    count: 6,
    seed: 37,
    window: { behind: 40, ahead: 190 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() > 0.5 ? 1 : -1) * (27 + rng() * 20), -8, 0),
    }),
    make: (index, rng) => {
      const crane = new Group();
      const post = new Mesh(new BoxGeometry(1.1, 15 + rng() * 6, 1.1), hullMaterial);
      post.position.y = 8;
      const jib = new Mesh(new BoxGeometry(10 + rng() * 5, 0.8, 0.8), plateMaterial);
      jib.position.set(3.5, 14.5 + rng() * 3, 0);
      jib.rotation.z = -0.16 - rng() * 0.3;
      const cab = new Mesh(new BoxGeometry(2, 1.6, 1.8), paintMaterial);
      cab.position.set(0.4, 12.6 + rng() * 3, 0);
      const cable = new Mesh(new BoxGeometry(0.12, 6 + rng() * 4, 0.12), hullMaterial);
      cable.position.set(7.5, 10, 0);
      crane.add(post, jib, cab, cable);
      crane.name = 'harbor-crane';
      crane.rotation.z = (rng() - 0.5) * 0.22;
      crane.rotation.y = rng() * Math.PI;
      return crane;
    },
  }));

  // Pipe stacks and chain runs nearer the route.
  fields.push(scatterAlongRail(curve, {
    count: 16,
    seed: 133,
    window: { behind: 30, ahead: 150 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() > 0.5 ? 1 : -1) * (22 + rng() * 10), -7.5 + rng() * 3, 0),
    }),
    make: (index, rng) => {
      const cluster = new Group();
      if (rng() > 0.45) {
        const pipeCount = 2 + Math.floor(rng() * 3);
        for (let pipe = 0; pipe < pipeCount; pipe += 1) {
          const radius = 0.5 + rng() * 0.5;
          const mesh = new Mesh(new CylinderGeometry(radius, radius, 8 + rng() * 8, 8), pipe % 2 ? hullMaterial : plateMaterial);
          mesh.rotation.z = Math.PI / 2;
          mesh.position.set(0, pipe * 1.3, pipe * 0.5);
          cluster.add(mesh);
        }
      } else {
        // A snapped cable draped from a post: the silhouette language of the theme.
        const post = new Mesh(new BoxGeometry(0.6, 9 + rng() * 4, 0.6), hullMaterial);
        post.position.y = 4.5;
        cluster.add(post);
        for (let link = 0; link < 3; link += 1) {
          const cable = new Mesh(new BoxGeometry(0.14, 3.6 + rng() * 2.5, 0.14), plateMaterial);
          cable.position.set((rng() - 0.5) * 1.6, 7 - link * 1.1, (rng() - 0.5) * 1.2);
          cable.rotation.z = (rng() - 0.5) * 1.1;
          cluster.add(cable);
        }
      }
      cluster.name = 'harbor-pipes';
      cluster.rotation.y = rng() * Math.PI;
      return cluster;
    },
  }));

  // Sodium lamps: the hard industrial light burning through grit.
  fields.push(scatterAlongRail(curve, {
    count: 12,
    seed: 208,
    window: { behind: 30, ahead: 150 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() > 0.5 ? 1 : -1) * (21 + rng() * 9), -8, 0),
    }),
    make: (index, rng) => {
      const lamp = new Group();
      const height = 9 + rng() * 4;
      const post = new Mesh(new BoxGeometry(0.35, height, 0.35), lampPostMaterial);
      post.position.y = height / 2;
      const arm = new Mesh(new BoxGeometry(1.8, 0.25, 0.25), lampPostMaterial);
      arm.position.set(0.8, height - 0.3, 0);
      const head = new Mesh(new SphereGeometry(0.42, 8, 6), lampMaterial);
      head.position.set(1.6, height - 0.6, 0);
      const cone = new Mesh(new CylinderGeometry(0.3, 2.6, 5, 10, 1, true), lampConeMaterial);
      cone.position.set(1.6, height - 3.1, 0);
      lamp.add(post, arm, head, cone);
      lamp.name = 'harbor-lamp';
      lamp.rotation.y = rng() * Math.PI * 2;
      lamp.rotation.z = (rng() - 0.5) * 0.12;
      return lamp;
    },
  }));

  // Far skyline: gantries and silo blocks fencing the basin.
  fields.push(scatterAlongRail(curve, {
    count: 12,
    seed: 314,
    window: { behind: 60, ahead: 260 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() > 0.5 ? 1 : -1) * (55 + rng() * 40), -8, 0),
    }),
    make: (index, rng) => {
      const block = new Group();
      const width = 14 + rng() * 22;
      const height = 12 + rng() * 20;
      const mass = new Mesh(new BoxGeometry(width, height, 10 + rng() * 8), skylineMaterial);
      mass.position.y = height / 2;
      block.add(mass);
      if (rng() > 0.5) {
        const tower = new Mesh(new BoxGeometry(3, height * 0.7, 3), skylineMaterial);
        tower.position.set(width * 0.35, height * 1.3, 0);
        block.add(tower);
      }
      return block;
    },
  }));

  // Suspended grit drifting through the lamplight, close to the route.
  fields.push(scatterAlongRail(curve, {
    count: 44,
    seed: 87,
    alignToRail: false,
    window: { behind: 8, ahead: 70 },
    place: (index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() - 0.5) * 22, (rng() - 0.5) * 14 + 1, 0),
    }),
    make: (index, rng) => {
      const speck = new Mesh(new PlaneGeometry(0.14 + rng() * 0.2, 0.14 + rng() * 0.2), gritMaterial);
      speck.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      return speck;
    },
  }));

  for (const field of fields) root.add(field.group);
  scene.add(root);

  return {
    root,
    modedEntries: collectModed(root),
    update(cameraU, dt) {
      for (const field of fields) field.update(cameraU, dt);
    },
    dispose() {
      for (const field of fields) field.dispose();
      root.removeFromParent();
    },
  };
}
