import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';

// Leaf: construction of the gun itself. The spine decides where each ring
// sits, how hot it glows, when pulses fire, and where the muzzle appears.

export type BarrelOptions = {
  curve: CatmullRomCurve3;
  ringCount: number;
  /** Bore radius in barrel units; everything is authored in barrel units. */
  boreRadius: number;
  /** World units per barrel unit. */
  unit: number;
  railAngles: readonly number[];
  /** Rail parameter where the conductor rails end (the muzzle). */
  railEndU: number;
  coil: Color;
  winding: Color;
  railMetal: Color;
  /** Colour of the rail glow strip at a given rail parameter (baked into vertex colours). */
  railGlowAt: (u: number) => Color;
};

const basis = new Matrix4();
const matrix = new Matrix4();
const quaternion = new Quaternion();
const scale = new Vector3();
const hiddenScale = new Vector3(0.0001, 0.0001, 0.0001);

function paintVertexColors(geometry: BufferGeometry, paint: (position: Vector3, normal: Vector3) => Color) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    p.fromBufferAttribute(positions, i);
    if (normals) n.fromBufferAttribute(normals, i);
    else n.set(0, 0, 1);
    const color = paint(p, n);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function stripToPositionNormal(geometry: BufferGeometry) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(nonIndexed.attributes)) {
    if (name !== 'position' && name !== 'normal') nonIndexed.deleteAttribute(name);
  }
  return nonIndexed;
}

/** One accelerator coil: a heavy torus wrapped in windings, with rail clamps. */
function buildCoilGeometry(bore: number, railAngles: readonly number[], coil: Color, winding: Color) {
  const ringRadius = bore + 1.35;
  const parts: BufferGeometry[] = [];
  const housing = new TorusGeometry(ringRadius, 0.95, 7, 72);
  parts.push(stripToPositionNormal(housing));
  const windingCount = 28;
  for (let i = 0; i < windingCount; i += 1) {
    const angle = (i / windingCount) * Math.PI * 2;
    const wrap = new TorusGeometry(1.12, 0.2, 4, 10);
    // Wrap around the housing tube: the band's axis runs along the ring.
    wrap.rotateX(Math.PI / 2);
    wrap.rotateZ(angle);
    wrap.translate(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0);
    parts.push(stripToPositionNormal(wrap));
  }
  for (const angle of railAngles) {
    const clamp = new BoxGeometry(1.8, 1.8, 3.2);
    clamp.rotateZ(angle);
    clamp.translate(Math.cos(angle) * (ringRadius + 0.4), Math.sin(angle) * (ringRadius + 0.4), 0);
    parts.push(stripToPositionNormal(clamp));
  }
  const merged = mergeGeometries(parts);
  const radial = new Vector3();
  const tint = new Color();
  // Inner faces catch the bore's light; outer faces fall into shadow.
  return paintVertexColors(merged, (position, normal) => {
    radial.set(position.x, position.y, 0).normalize();
    const inward = Math.max(0, -normal.dot(radial));
    const sideways = Math.abs(normal.z);
    const isWinding = Math.hypot(position.x, position.y) > ringRadius + 0.95 || Math.abs(position.z) > 0.96;
    tint.copy(isWinding ? winding : coil).multiplyScalar(0.3 + inward * 1.25 + sideways * 0.2);
    return tint.clone();
  });
}

/** The glowing inner lip of a coil plus its field-emitter nodes. */
function buildGlowGeometry(bore: number) {
  const parts: BufferGeometry[] = [stripToPositionNormal(new TorusGeometry(bore + 0.28, 0.13, 5, 120))];
  for (let i = 0; i < 12; i += 1) {
    const angle = ((i + 0.5) / 12) * Math.PI * 2;
    const node = new OctahedronGeometry(0.26, 0);
    node.scale(0.7, 0.7, 1.6);
    node.translate(Math.cos(angle) * (bore + 0.4), Math.sin(angle) * (bore + 0.4), 0);
    parts.push(stripToPositionNormal(node));
  }
  return mergeGeometries(parts);
}

export function createBarrel(scene: Scene, options: BarrelOptions) {
  const { curve, ringCount, boreRadius, railAngles, unit } = options;
  const root = new Group();
  root.name = 'barrel';
  scene.add(root);

  // ---- rings ----------------------------------------------------------------------
  const coilMesh = new InstancedMesh(
    buildCoilGeometry(boreRadius, railAngles, options.coil, options.winding),
    new MeshBasicMaterial({ vertexColors: true }),
    ringCount,
  );
  const glowMesh = new InstancedMesh(buildGlowGeometry(boreRadius), new MeshBasicMaterial({ toneMapped: false }), ringCount);
  coilMesh.name = 'coils';
  glowMesh.name = 'coil-glow';
  for (const mesh of [coilMesh, glowMesh]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(ringCount * 3).fill(1), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  function placeRing(index: number, u: number, visible: boolean) {
    if (!visible) {
      matrix.compose(new Vector3(0, -9999, 0), quaternion.identity(), hiddenScale);
    } else {
      const frame = sampleRailFrame(curve, u);
      basis.makeBasis(frame.right, frame.up, frame.tangent);
      quaternion.setFromRotationMatrix(basis);
      matrix.compose(frame.position, quaternion, scale.set(unit, unit, unit));
    }
    coilMesh.setMatrixAt(index, matrix);
    glowMesh.setMatrixAt(index, matrix);
  }

  function setRingColors(index: number, body: Color, glow: Color) {
    coilMesh.setColorAt(index, body);
    glowMesh.setColorAt(index, glow);
  }

  function commitRings(matrices: boolean) {
    if (matrices) {
      coilMesh.instanceMatrix.needsUpdate = true;
      glowMesh.instanceMatrix.needsUpdate = true;
    }
    if (coilMesh.instanceColor) coilMesh.instanceColor.needsUpdate = true;
    if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  }

  // ---- conductor rails ----------------------------------------------------------------
  const railLength = curve.getLength() * options.railEndU;
  const railSegments = Math.ceil(railLength / (3 * unit));
  const railMetal = new MeshBasicMaterial({ color: options.railMetal });
  const railGlow = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  for (const angle of railAngles) {
    const points: Vector3[] = [];
    const glowPoints: Vector3[] = [];
    const samples = Math.ceil(railLength / (14 * unit));
    const metalRadius = (boreRadius + 0.75) * unit;
    const glowRadius = (boreRadius + 0.3) * unit;
    for (let i = 0; i <= samples; i += 1) {
      const u = (i / samples) * options.railEndU;
      points.push(offsetFromRail(curve, u, new Vector3(Math.cos(angle) * metalRadius, Math.sin(angle) * metalRadius, 0)));
      glowPoints.push(offsetFromRail(curve, u, new Vector3(Math.cos(angle) * glowRadius, Math.sin(angle) * glowRadius, 0)));
    }
    const metal = new Mesh(new TubeGeometry(new CatmullRomCurve3(points), railSegments, 0.42 * unit, 6, false), railMetal);
    metal.name = 'rail';
    root.add(metal);
    const glowGeometry = new TubeGeometry(new CatmullRomCurve3(glowPoints), railSegments, 0.07 * unit, 4, false);
    const positions = glowGeometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const ringVerts = 5;
    for (let i = 0; i < positions.count; i += 1) {
      const segment = Math.floor(i / ringVerts);
      const color = options.railGlowAt((segment / railSegments) * options.railEndU);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    glowGeometry.setAttribute('color', new BufferAttribute(colors, 3));
    const glow = new Mesh(glowGeometry, railGlow);
    glow.name = 'rail-glow';
    root.add(glow);
  }

  // ---- current pulses racing down the rails ------------------------------------------------
  const pulseCapacity = 72;
  const pulseMesh = new InstancedMesh(
    new BoxGeometry(0.2, 0.2, 6),
    new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    pulseCapacity,
  );
  pulseMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  pulseMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(pulseCapacity * 3), 3);
  pulseMesh.instanceColor.setUsage(DynamicDrawUsage);
  pulseMesh.frustumCulled = false;
  root.add(pulseMesh);
  const totalLength = curve.getLength();
  const pulses = Array.from({ length: pulseCapacity }, () => ({ alive: false, distance: 0, speed: 0, rail: 0, age: 0, life: 1, color: new Color() }));
  let pulseCursor = 0;
  const pulseColor = new Color();

  function firePulse(fromDistance: number, rail: number, speed: number, life: number, color: Color) {
    const pulse = pulses[pulseCursor];
    pulseCursor = (pulseCursor + 1) % pulseCapacity;
    pulse.alive = true;
    pulse.distance = fromDistance;
    pulse.speed = speed;
    pulse.rail = rail;
    pulse.age = 0;
    pulse.life = life;
    pulse.color.copy(color);
  }

  /** Returns the distances (along the rail) of live pulses, for the ring wave. */
  function updatePulses(dt: number, endDistance: number) {
    pulses.forEach((pulse, index) => {
      if (pulse.alive) {
        pulse.age += dt;
        pulse.distance += pulse.speed * dt;
        if (pulse.age >= pulse.life || pulse.distance >= endDistance) pulse.alive = false;
      }
      if (!pulse.alive) {
        matrix.compose(new Vector3(0, -9999, 0), quaternion.identity(), hiddenScale);
        pulseMesh.setMatrixAt(index, matrix);
        pulseMesh.setColorAt(index, pulseColor.setRGB(0, 0, 0));
        return;
      }
      const u = Math.min(1, pulse.distance / totalLength);
      const angle = railAngles[pulse.rail % railAngles.length];
      const frame = sampleRailFrame(curve, u);
      basis.makeBasis(frame.right, frame.up, frame.tangent);
      quaternion.setFromRotationMatrix(basis);
      const position = frame.position
        .addScaledVector(frame.right, Math.cos(angle) * (boreRadius + 0.3) * unit)
        .addScaledVector(frame.up, Math.sin(angle) * (boreRadius + 0.3) * unit);
      const stretch = 1 + pulse.speed / (60 * unit);
      matrix.compose(position, quaternion, scale.set(unit, unit, unit * stretch));
      pulseMesh.setMatrixAt(index, matrix);
      const fade = 1 - pulse.age / pulse.life;
      pulseMesh.setColorAt(index, pulseColor.copy(pulse.color).multiplyScalar(fade));
    });
    pulseMesh.instanceMatrix.needsUpdate = true;
    if (pulseMesh.instanceColor) pulseMesh.instanceColor.needsUpdate = true;
  }

  function clearPulses() {
    for (const pulse of pulses) pulse.alive = false;
  }

  // ---- muzzle and the safety iris ------------------------------------------------------
  const muzzle = new Group();
  muzzle.name = 'muzzle';
  muzzle.scale.setScalar(unit);
  root.add(muzzle);
  const muzzleMetal = new MeshBasicMaterial({ color: options.coil.clone().multiplyScalar(1.6) });
  // The muzzle is a beacon at the end of the tunnel; its light cuts the haze.
  const muzzleGlow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  [[boreRadius + 3, 1.3, 0], [boreRadius + 5, 1.5, 4], [boreRadius + 7.5, 1.7, 8.5]].forEach(([radius, tube, z]) => {
    const ring = new Mesh(new TorusGeometry(radius, tube, 8, 96), muzzleMetal);
    ring.position.z = z;
    const lip = new Mesh(new TorusGeometry(radius - tube * 0.95, 0.12, 4, 120), muzzleGlow);
    lip.position.z = z;
    muzzle.add(ring, lip);
  });
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const strut = new Mesh(new BoxGeometry(1.2, 1.2, 12), muzzleMetal);
    strut.position.set(Math.cos(angle) * (boreRadius + 5), Math.sin(angle) * (boreRadius + 5), 4);
    strut.lookAt(Math.cos(angle) * (boreRadius + 9), Math.sin(angle) * (boreRadius + 9), 12);
    muzzle.add(strut);
  }

  const iris = new Group();
  iris.name = 'safety-iris';
  muzzle.add(iris);
  const bladeShape = new Shape();
  const bladeReach = boreRadius + 3.2;
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(bladeReach, -0.6);
  bladeShape.lineTo(Math.cos(Math.PI / 3 + 0.12) * bladeReach, Math.sin(Math.PI / 3 + 0.12) * bladeReach);
  bladeShape.lineTo(0, 0);
  const bladeGeometry = new ShapeGeometry(bladeShape);
  const bladeMaterial = new MeshBasicMaterial({ color: options.coil.clone().multiplyScalar(1.3), side: DoubleSide });
  const bladeEdgeMaterial = new LineBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  const bladeEdges = new EdgesGeometry(bladeGeometry);
  const blades: Group[] = [];
  for (let i = 0; i < 6; i += 1) {
    const pivot = new Group();
    pivot.rotation.z = (i / 6) * Math.PI * 2;
    const blade = new Group();
    blade.add(new Mesh(bladeGeometry, bladeMaterial), new LineSegments(bladeEdges, bladeEdgeMaterial));
    pivot.add(blade);
    iris.add(pivot);
    blades.push(blade);
  }
  const jamCore = new Mesh(new OctahedronGeometry(1.3, 0), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  jamCore.position.z = -0.2;
  iris.add(jamCore);
  const jamCoreMaterial = jamCore.material as MeshBasicMaterial;

  /** 0 = sealed shut, 1 = fully retracted into the muzzle wall. */
  function setIris(open: number, edge: Color, core: Color) {
    for (const blade of blades) {
      blade.position.set(open * (boreRadius + 1), open * 2, 0);
      blade.rotation.z = open * 0.5;
      blade.visible = open < 0.999;
    }
    bladeEdgeMaterial.color.copy(edge);
    jamCoreMaterial.color.copy(core);
    jamCore.visible = open < 0.35;
    jamCore.scale.setScalar(1 - open * 2.2);
  }

  function setMuzzleGlow(color: Color) {
    muzzleGlow.color.copy(color);
  }

  return {
    root,
    placeRing,
    setRingColors,
    commitRings,
    railGlow,
    firePulse,
    updatePulses,
    clearPulses,
    muzzle,
    setIris,
    setMuzzleGlow,
  };
}

export type Barrel = ReturnType<typeof createBarrel>;
