import {
  BoxGeometry,
  CatmullRomCurve3,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';

// Construction only. Every colour, count, radius and timing decision arrives as
// a parameter — the coil field does not know what a beat is.

export type CoilFieldOptions = {
  curve: CatmullRomCurve3;
  /** Number of coils. One per beat, but this leaf is told the count, not the reason. */
  count: number;
  /** Rail parameter for coil `index`. */
  ringU(index: number): number;
  boreRadius: number;
  /** Electromagnet segments around each coil. */
  segments: number;
  /** Fraction of each segment's angular slot that is filled; the rest is the gap. */
  segmentFill: number;
  /** Radial buttress struts anchoring each coil to the barrel wall. */
  struts: number;
  strutLength: number;
};

export type CoilField = {
  readonly group: Group;
  readonly count: number;
  /** World position of a coil's centre — for effects that want to sit on a coil. */
  centre(index: number, target: Vector3): Vector3;
  /** Rail parameter of a coil, cached at build time. */
  u(index: number): number;
  /** Linear RGB for coil `index`; values above 1 are what bloom picks up. */
  setColor(index: number, r: number, g: number, b: number): void;
  /** Upload whatever setColor changed this frame. */
  commit(): void;
  dispose(): void;
};

const matrix = new Matrix4();
const quaternion = new Quaternion();
const scale = new Vector3(1, 1, 1);
const position = new Vector3();
const basis = new Matrix4();

export function createCoilField(options: CoilFieldOptions): CoilField {
  const { curve, count, boreRadius, segments, segmentFill, struts, strutLength } = options;
  const group = new Group();

  const slot = (Math.PI * 2) / segments;
  const arcGeometry = new TorusGeometry(boreRadius, boreRadius * 0.055, 4, 5, slot * segmentFill);
  // Bake the segment's own rotation out of the instance transform: the geometry
  // starts at angle 0, so each instance only carries a roll about the bore axis.
  const coreGeometry = new TorusGeometry(boreRadius * 0.9, boreRadius * 0.012, 3, 28);
  const strutGeometry = new BoxGeometry(strutLength, boreRadius * 0.045, boreRadius * 0.045);
  strutGeometry.translate(strutLength / 2, 0, 0);

  const arcMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const coreMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const strutMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  const arcs = new InstancedMesh(arcGeometry, arcMaterial, count * segments);
  const cores = new InstancedMesh(coreGeometry, coreMaterial, count);
  const strutMesh = new InstancedMesh(strutGeometry, strutMaterial, count * struts);
  for (const mesh of [arcs, cores, strutMesh]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
  }

  const arcColors = new InstancedBufferAttribute(new Float32Array(count * segments * 3), 3);
  const coreColors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const strutColors = new InstancedBufferAttribute(new Float32Array(count * struts * 3), 3);
  arcs.instanceColor = arcColors;
  cores.instanceColor = coreColors;
  strutMesh.instanceColor = strutColors;

  const centres = new Float32Array(count * 3);
  const us = new Float64Array(count);

  // Coils never move, so every instance matrix is written once at build time and
  // never touched again. Only colour is live.
  for (let index = 0; index < count; index += 1) {
    const u = options.ringU(index);
    us[index] = u;
    const frame = sampleRailFrame(curve, u);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    quaternion.setFromRotationMatrix(basis);
    centres[index * 3] = frame.position.x;
    centres[index * 3 + 1] = frame.position.y;
    centres[index * 3 + 2] = frame.position.z;

    matrix.compose(frame.position, quaternion, scale);
    cores.setMatrixAt(index, matrix);

    for (let segment = 0; segment < segments; segment += 1) {
      // Alternate coils are clocked half a slot round, so the gaps never line up
      // down the barrel and the bore reads as a woven tube rather than a pipe.
      const roll = segment * slot + (index % 2) * slot * 0.5;
      matrix.compose(frame.position, quaternion, scale);
      matrix.multiply(rollMatrix(roll));
      arcs.setMatrixAt(index * segments + segment, matrix);
    }

    for (let strut = 0; strut < struts; strut += 1) {
      const angle = (strut / struts) * Math.PI * 2 + (index % 2) * (Math.PI / struts);
      position.copy(frame.position)
        .addScaledVector(frame.right, Math.cos(angle) * boreRadius)
        .addScaledVector(frame.up, Math.sin(angle) * boreRadius);
      matrix.compose(position, quaternion, scale);
      matrix.multiply(rollMatrix(angle));
      strutMesh.setMatrixAt(index * struts + strut, matrix);
    }
  }

  group.add(arcs, cores, strutMesh);

  let dirty = false;

  return {
    group,
    count,
    centre(index, target) {
      return target.set(centres[index * 3], centres[index * 3 + 1], centres[index * 3 + 2]);
    },
    u(index) {
      return us[index];
    },
    setColor(index, r, g, b) {
      dirty = true;
      coreColors.setXYZ(index, r, g, b);
      // Segments sit outside the bore line and read a touch cooler; struts are
      // structure and only catch a fifth of the current.
      for (let segment = 0; segment < segments; segment += 1) {
        arcColors.setXYZ(index * segments + segment, r * 0.62, g * 0.62, b * 0.62);
      }
      for (let strut = 0; strut < struts; strut += 1) {
        strutColors.setXYZ(index * struts + strut, r * 0.2 + 0.05, g * 0.2 + 0.06, b * 0.2 + 0.09);
      }
    },
    commit() {
      if (!dirty) return;
      dirty = false;
      arcColors.needsUpdate = true;
      coreColors.needsUpdate = true;
      strutColors.needsUpdate = true;
    },
    dispose() {
      group.removeFromParent();
      arcGeometry.dispose();
      coreGeometry.dispose();
      strutGeometry.dispose();
      arcMaterial.dispose();
      coreMaterial.dispose();
      strutMaterial.dispose();
      arcs.dispose();
      cores.dispose();
      strutMesh.dispose();
    },
  };
}

const roll = new Matrix4();
function rollMatrix(angle: number) {
  return roll.makeRotationZ(angle);
}
