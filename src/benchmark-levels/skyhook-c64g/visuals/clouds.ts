import {
  BufferAttribute,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { mulberry32 } from '../../../engine/rng';
import { CLIMB_LENGTH } from '../space';
import type { SkyState } from './sky';

// World-fixed cloud geometry: a dark storm layer the car climbs through, then a
// dense deck it punches out of. Puffs carry a baked top-light gradient, so the
// same cloud reads dark from underneath and sunlit from above. Cumulus
// (additive) streak past in the clear air; a dark sea lies under the storm.

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchColor = new Color();
const UP = new Vector3(0, 1, 0);

function puffGeometry(detail = 1) {
  const geometry = new IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const light = 0.62 + 0.38 * (0.5 + y * 0.5);
    colors[i * 3] = light * 0.94;
    colors[i * 3 + 1] = light * 0.97;
    colors[i * 3 + 2] = light;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

export type Clouds = {
  group: Group;
  update(state: SkyState, time: number, cameraAltitude: number): void;
};

export function createClouds(curve: CatmullRomCurve3): Clouds {
  const group = new Group();
  const rng = mulberry32(0xc10ed5);
  const point = new Vector3();

  const railAt = (s: number) => curve.getPointAt(MathUtils.clamp(s / CLIMB_LENGTH, 0, 1), point);

  // storm layer: clusters of puffs off the path, above and below it --------------------
  // Clusters keep clear of the rail itself (no slab ever fills the frame); the
  // car passes between them.
  const stormClusters = 64;
  const stormPer = 5;
  const stormMaterial = new MeshBasicMaterial({ vertexColors: true });
  const storm = new InstancedMesh(puffGeometry(2), stormMaterial, stormClusters * stormPer);
  let index = 0;
  for (let c = 0; c < stormClusters; c += 1) {
    const s = -60 + rng() * 820;
    railAt(s);
    const lateral = (rng() < 0.5 ? -1 : 1) * (70 + Math.pow(rng(), 0.8) * 300);
    const vertical = (rng() < 0.5 ? -1 : 1) * (60 + rng() * 150);
    const center = new Vector3(point.x + lateral, point.y + vertical, point.z + (rng() - 0.5) * 220);
    const spread = 34 + rng() * 40;
    for (let k = 0; k < stormPer; k += 1) {
      const r = spread * (0.4 + rng() * 0.6);
      scratchPos.set(center.x + (rng() - 0.5) * spread * 2, center.y + (rng() - 0.5) * spread * 0.7, center.z + (rng() - 0.5) * spread * 2);
      scratchQuat.setFromAxisAngle(UP, rng() * Math.PI * 2);
      scratchScale.set(r * (1.15 + rng() * 0.5), r * (0.5 + rng() * 0.3), r * (1 + rng() * 0.4));
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      storm.setMatrixAt(index, scratchMatrix);
      const shade = 0.75 + rng() * 0.3;
      storm.setColorAt(index, scratchColor.setRGB(shade, shade, shade));
      index += 1;
    }
  }
  storm.frustumCulled = false;
  storm.userData.raildIgnoreOcclusion = true;
  group.add(storm);

  // cloud deck: the slab the car punches out of ----------------------------------------------
  const deckClusters = 72;
  const deckPer = 6;
  const deckMaterial = new MeshBasicMaterial({ vertexColors: true });
  const deck = new InstancedMesh(puffGeometry(1), deckMaterial, deckClusters * deckPer);
  index = 0;
  for (let c = 0; c < deckClusters; c += 1) {
    const s = 320 + rng() * 1100;
    railAt(s);
    const spread = 60 + rng() * 70;
    const center = new Vector3(point.x + (rng() - 0.5) * 900, 400 + Math.pow(rng(), 1.3) * 150, point.z + (rng() - 0.5) * 420);
    for (let k = 0; k < deckPer; k += 1) {
      const r = spread * (0.45 + rng() * 0.55);
      scratchPos.set(center.x + (rng() - 0.5) * spread * 2, center.y + (rng() - 0.3) * spread * 0.5, center.z + (rng() - 0.5) * spread * 2);
      scratchQuat.setFromAxisAngle(UP, rng() * Math.PI * 2);
      scratchScale.set(r * (1.3 + rng() * 0.6), r * (0.5 + rng() * 0.25), r * (1.1 + rng() * 0.5));
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      deck.setMatrixAt(index, scratchMatrix);
      const shade = 0.82 + rng() * 0.2;
      deck.setColorAt(index, scratchColor.setRGB(shade, shade, shade * 1.02));
      index += 1;
    }
  }
  deck.frustumCulled = false;
  deck.userData.raildIgnoreOcclusion = true;
  group.add(deck);

  // cumulus around the rail in the sunlit act: they whip past, both sides ---------------------
  const cumulusClusters = 44;
  const cumulusPer = 5;
  const cumulus = new InstancedMesh(puffGeometry(1), deckMaterial, cumulusClusters * cumulusPer);
  index = 0;
  for (let c = 0; c < cumulusClusters; c += 1) {
    const s = 860 + rng() * 950;
    railAt(s);
    const lateral = (rng() < 0.5 ? -1 : 1) * (90 + Math.pow(rng(), 0.8) * 320);
    const vertical = (rng() - 0.5) * 420;
    const spread = 26 + rng() * 34;
    for (let k = 0; k < cumulusPer; k += 1) {
      const r = spread * (0.45 + rng() * 0.55);
      scratchPos.set(point.x + lateral + (rng() - 0.5) * spread * 2, point.y + vertical + (rng() - 0.5) * spread * 0.8, point.z + (rng() - 0.5) * 120 + (rng() - 0.5) * spread * 2);
      scratchQuat.setFromAxisAngle(UP, rng() * Math.PI * 2);
      scratchScale.set(r * (1.2 + rng() * 0.5), r * (0.55 + rng() * 0.3), r * (1 + rng() * 0.4));
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      cumulus.setMatrixAt(index, scratchMatrix);
      const shade = 0.86 + rng() * 0.16;
      cumulus.setColorAt(index, scratchColor.setRGB(shade, shade, shade * 1.02));
      index += 1;
    }
  }
  cumulus.frustumCulled = false;
  cumulus.userData.raildIgnoreOcclusion = true;
  group.add(cumulus);

  // the sea under the storm -------------------------------------------------------------------
  const seaMaterial = new MeshBasicMaterial({ color: new Color(0.03, 0.038, 0.048) });
  const sea = new Mesh(new PlaneGeometry(5200, 5200), seaMaterial);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -24, -500);
  sea.userData.raildIgnoreOcclusion = true;
  group.add(sea);

  return {
    group,
    update(state, time, cameraAltitude) {
      stormMaterial.color.copy(state.cloud);
      deckMaterial.color.copy(state.cloud);
      sea.visible = cameraAltitude < 420;
      seaMaterial.color.copy(state.fog).multiplyScalar(0.42);
      storm.visible = time < 17;
      // Cumulus belong to the sunlit act: gone by the time the air thins.
      cumulus.visible = time > 15 && time < 34;
      deck.visible = time < 40;
    },
  };
}
