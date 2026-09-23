import { BufferAttribute, CircleGeometry, Color, Group, Mesh, SphereGeometry, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_noise_float, positionWorld, time, vec3 } from 'three/tsl';

// Leaf: the glue spill — a black, glossy lake with a heaped mound in the
// middle. It grows in, and at the end it shrinks away to nothing. The spine
// drives both through `setGrowth` and `setClean`.

export function createSpillView(center: Vector3, options: { glue: Color; sheen: Color; sheenAlt: Color; radius: number }) {
  const group = new Group();
  group.name = 'spill';
  group.position.set(center.x, 0, center.z);
  const material = new MeshStandardNodeMaterial({ roughness: 0.07, metalness: 0.3 });
  const swirl = mx_noise_float(positionWorld.xz.mul(0.07).add(vec3(time.mul(0.05), time.mul(0.03), 0).xy)).mul(0.5).add(0.5);
  const sheen = mix(vec3(options.sheen.r, options.sheen.g, options.sheen.b), vec3(options.sheenAlt.r, options.sheenAlt.g, options.sheenAlt.b), swirl);
  material.colorNode = vec3(options.glue.r, options.glue.g, options.glue.b).add(sheen.mul(swirl.mul(swirl).mul(0.09)));
  material.roughnessNode = float(0.05).add(swirl.mul(0.06));

  const lakeGeometry = new CircleGeometry(1, 96);
  const positions = lakeGeometry.getAttribute('position') as BufferAttribute;
  for (let i = 1; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const angle = Math.atan2(y, x);
    const r = 1 + 0.1 * Math.sin(angle * 5 + 0.7) + 0.06 * Math.sin(angle * 11 + 2.1) + 0.04 * Math.sin(angle * 23);
    positions.setXY(i, Math.cos(angle) * r, Math.sin(angle) * r);
  }
  lakeGeometry.rotateX(-Math.PI / 2);
  lakeGeometry.computeVertexNormals();
  const lake = new Mesh(lakeGeometry, material);
  lake.position.y = 0.06;
  group.add(lake);

  const moundGeometry = new SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const mp = moundGeometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < mp.count; i += 1) {
    const v = new Vector3(mp.getX(i), mp.getY(i), mp.getZ(i));
    const bump = 1 + 0.12 * Math.sin(v.x * 7 + v.z * 3) + 0.08 * Math.sin(v.z * 11 - v.y * 5);
    v.multiplyScalar(bump);
    mp.setXYZ(i, v.x, v.y, v.z);
  }
  moundGeometry.computeVertexNormals();
  const mound = new Mesh(moundGeometry, material);
  group.add(mound);

  let growth = 0;
  let clean = 0;

  function apply() {
    const g = Math.max(0, growth * (1 - clean));
    group.visible = g > 0.002;
    lake.scale.set(options.radius * g, 1, options.radius * g);
    const moundRadius = options.radius * 0.5 * g;
    mound.scale.set(moundRadius, moundRadius * 0.9 * (1 - clean * 0.5), moundRadius);
  }
  apply();

  return {
    group,
    lake,
    mound,
    setGrowth(value: number) {
      growth = value;
      apply();
    },
    setClean(value: number) {
      clean = value;
      apply();
    },
    get radius() {
      return options.radius * growth * (1 - clean);
    },
  };
}
