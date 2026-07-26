import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Camera, Scene } from 'three';
import { BEAD, GLUE, LAMP, MARBLE_GLASS, matte, glow } from './palette';
import { shadowBlob } from './props';
import type { PieceShape, PieceSpec } from './enemies';

// The level's signature loop, in one module: a dismantled monster drops its
// stolen supplies onto the table, the loose pieces roll into the scratch the
// ball is following, and the ball picks them up and wears them for the rest of
// the run. Loose and stuck pieces are instanced, so a run's whole accumulated
// history costs six draw calls.

const SHAPES: PieceShape[] = ['disc', 'rod', 'plate'];
const LOOSE_CAPACITY = 84;
const STUCK_CAPACITY = 78;
const GRAVITY = 30;
const FLIGHT_SECONDS = 0.85;
/** How fast a resting piece crawls sideways into the scratch the ball is following. */
const HERD_SPEED = 4.6;
const REST_BOUNCE = 0.34;
/**
 * Framing constants for the player's ball. The rail carries the camera at
 * BALL_HEIGHT_RATIO times the ball's radius and the ball rides
 * BALL_LEAD_RADII radii ahead: together they keep it a constant, small wedge
 * across the bottom of the frame however large it grows.
 */
const BALL_HEIGHT_RATIO = 5.4;
const BALL_LEAD_RADII = 5;

type LoosePiece = {
  active: boolean;
  resting: boolean;
  position: Vector3;
  velocity: Vector3;
  quaternion: Quaternion;
  spin: Vector3;
  size: number;
  age: number;
  stray: boolean;
};

/**
 * A piece welded to the ball. The seat and orientation are in the ball's own
 * space, but the size is remembered in world units: the ball keeps growing
 * under its cargo, and a button picked up as a marble has to still look like a
 * button when the ball is a melon.
 */
type StuckPiece = {
  seat: Vector3;
  orientation: Quaternion;
  worldSize: number;
};

type PieceLayer = {
  shape: PieceShape;
  loose: InstancedMesh;
  stuck: InstancedMesh;
  pieces: LoosePiece[];
  stuckPieces: StuckPiece[];
  nextLoose: number;
  stuckCount: number;
  nextStuck: number;
};

const matrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchVector = new Vector3();
const scratchScale = new Vector3();
const scratchColor = new Color();
const forwardFlat = new Vector3();
const rightFlat = new Vector3();
const toPiece = new Vector3();
const rollAxis = new Vector3();
const rollDelta = new Quaternion();
const inverseSpin = new Quaternion();
const UP = new Vector3(0, 1, 0);
const HIDDEN = new Vector3(0, -10000, 0);

function shapeGeometry(shape: PieceShape): BufferGeometry {
  if (shape === 'disc') return new CylinderGeometry(0.5, 0.5, 0.22, 10);
  if (shape === 'rod') return new BoxGeometry(0.17, 1.15, 0.17);
  return new BoxGeometry(1, 0.15, 0.68);
}

export type BallState = {
  radius: number;
  center: Vector3;
};

export type PieceField = ReturnType<typeof createPieceField>;

export function createPieceField(scene: Scene, tableY: number) {
  const root = new Group();
  root.name = 'tinker-pieces';
  scene.add(root);

  const ballRoot = new Group();
  const ballSpin = new Group();
  ballRoot.add(ballSpin);
  root.add(ballRoot);

  // A glass marble to begin with. Everything else on the surface is earned.
  const marble = new Mesh(new SphereGeometry(1, 20, 14), matte(MARBLE_GLASS, 0.24));
  ballSpin.add(marble);
  const swirl = new Mesh(new TorusGeometry(0.62, 0.26, 8, 20), matte(BEAD, 0.3));
  swirl.rotation.x = 0.7;
  ballSpin.add(swirl);
  const smear = new Mesh(new SphereGeometry(1.02, 16, 10), matte(GLUE, 0));
  smear.scale.set(0.42, 0.42, 0.42);
  smear.position.set(0.45, -0.4, 0.42);
  ballSpin.add(smear);
  const gloss = new Mesh(new SphereGeometry(0.26, 10, 8), glow(LAMP, 0.32));
  gloss.position.set(-0.4, 0.62, 0.42);
  ballSpin.add(gloss);

  const ballShadow = shadowBlob(1, 0.6);
  root.add(ballShadow);

  // Instanced pieces tint per instance, so the shared material must be white;
  // any colour here would multiply into every rescued supply.
  const pieceMaterial = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x0d0a06, flatShading: true });

  const layers: PieceLayer[] = SHAPES.map((shape) => {
    const geometry = shapeGeometry(shape);
    const loose = new InstancedMesh(geometry, pieceMaterial, LOOSE_CAPACITY);
    const stuck = new InstancedMesh(geometry, pieceMaterial, STUCK_CAPACITY);
    loose.frustumCulled = false;
    stuck.frustumCulled = false;
    loose.count = LOOSE_CAPACITY;
    stuck.count = STUCK_CAPACITY;
    root.add(loose);
    ballSpin.add(stuck);
    const layer: PieceLayer = {
      shape,
      loose,
      stuck,
      pieces: Array.from({ length: LOOSE_CAPACITY }, () => ({
        active: false,
        resting: false,
        position: new Vector3(),
        velocity: new Vector3(),
        quaternion: new Quaternion(),
        spin: new Vector3(),
        size: 1,
        age: 0,
        stray: false,
      })),
      stuckPieces: Array.from({ length: STUCK_CAPACITY }, () => ({
        seat: new Vector3(),
        orientation: new Quaternion(),
        worldSize: 1,
      })),
      nextLoose: 0,
      stuckCount: 0,
      nextStuck: 0,
    };
    for (let i = 0; i < LOOSE_CAPACITY; i += 1) hideInstance(loose, i);
    for (let i = 0; i < STUCK_CAPACITY; i += 1) hideInstance(stuck, i);
    return layer;
  });

  const ball: BallState = { radius: 0.7, center: new Vector3() };
  let smoothedRadius = 0.7;
  /** Ball radius the stuck matrices were last written for. */
  let stuckRadius = 0.7;
  let stuckTotal = 0;
  let lastCenter: Vector3 | null = null;
  let scatterSeed = 1;

  function hideInstance(mesh: InstancedMesh, index: number) {
    matrix.compose(HIDDEN, scratchQuaternion.identity(), scratchScale.set(0.0001, 0.0001, 0.0001));
    mesh.setMatrixAt(index, matrix);
  }

  function random() {
    scatterSeed = (scatterSeed * 1664525 + 1013904223) % 4294967296;
    return scatterSeed / 4294967296;
  }

  function layerFor(shape: PieceShape) {
    return layers[SHAPES.indexOf(shape)] ?? layers[0];
  }

  /**
   * Throw one enemy's supplies onto the table. Most of them are aimed at the
   * lane ahead of the camera so the ball can gather them; a few are left as
   * litter, which is what makes the trail behind the ball read as a route.
   */
  function scatter(origin: Vector3, specs: PieceSpec[], camera: Camera, count: number, spread: number) {
    if (specs.length === 0) return;
    camera.getWorldDirection(forwardFlat);
    forwardFlat.y = 0;
    if (forwardFlat.lengthSq() < 1e-6) forwardFlat.set(0, 0, -1);
    forwardFlat.normalize();
    rightFlat.set(forwardFlat.z, 0, -forwardFlat.x);

    const cameraPosition = camera.position;
    const aheadOfCamera = scratchVector.copy(origin).sub(cameraPosition).dot(forwardFlat);

    for (let i = 0; i < count; i += 1) {
      const spec = specs[i % specs.length];
      const layer = layerFor(spec.shape);
      const index = layer.nextLoose;
      layer.nextLoose = (layer.nextLoose + 1) % LOOSE_CAPACITY;
      const piece = layer.pieces[index];

      const stray = random() < 0.22;
      // Landing spot: a little short of where the debris field started, so the
      // pieces settle into the ball's path instead of behind it.
      const landAhead = Math.max(4, aheadOfCamera * (stray ? 0.78 : 0.6));
      const lateral = (random() - 0.5) * (stray ? spread * 3.4 : spread);
      const target = scratchVector.copy(cameraPosition)
        .addScaledVector(forwardFlat, landAhead)
        .addScaledVector(rightFlat, lateral);
      target.y = tableY + spec.size * 0.5;

      piece.active = true;
      piece.resting = false;
      piece.stray = stray;
      piece.age = 0;
      piece.size = spec.size;
      piece.position.copy(origin);
      piece.velocity
        .copy(target)
        .sub(origin)
        .multiplyScalar(1 / FLIGHT_SECONDS);
      piece.velocity.y += 0.5 * GRAVITY * FLIGHT_SECONDS;
      piece.spin.set((random() - 0.5) * 16, (random() - 0.5) * 16, (random() - 0.5) * 16);
      piece.quaternion.setFromAxisAngle(
        rollAxis.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
        random() * Math.PI * 2,
      );
      layer.loose.setColorAt(index, spec.color);
      if (layer.loose.instanceColor) layer.loose.instanceColor.needsUpdate = true;
    }
  }

  function stickPiece(layer: PieceLayer, piece: LoosePiece, color: Color) {
    const slot = layer.stuckCount < STUCK_CAPACITY ? layer.stuckCount : layer.nextStuck;
    if (layer.stuckCount < STUCK_CAPACITY) layer.stuckCount += 1;
    else layer.nextStuck = (layer.nextStuck + 1) % STUCK_CAPACITY;

    // Seat the piece where it touched, converted out of the ball's spin so it
    // keeps that spot for the rest of the run.
    toPiece.copy(piece.position).sub(ball.center);
    if (toPiece.lengthSq() < 1e-6) toPiece.set(0, 1, 0);
    toPiece.normalize();
    inverseSpin.copy(ballSpin.quaternion).invert();
    toPiece.applyQuaternion(inverseSpin);

    const stuck = layer.stuckPieces[slot];
    stuck.seat.copy(toPiece).multiplyScalar(0.92 + random() * 0.12);
    stuck.orientation.setFromUnitVectors(UP, toPiece);
    stuck.orientation.multiply(rollDelta.setFromAxisAngle(UP, random() * Math.PI * 2));
    stuck.worldSize = piece.size * 2;
    writeStuckMatrix(layer, slot);
    layer.stuck.setColorAt(slot, color);
    layer.stuck.instanceMatrix.needsUpdate = true;
    if (layer.stuck.instanceColor) layer.stuck.instanceColor.needsUpdate = true;

    piece.active = false;
    stuckTotal += 1;
  }

  function writeStuckMatrix(layer: PieceLayer, slot: number) {
    const stuck = layer.stuckPieces[slot];
    // The stuck mesh is parented to the spinning ball, which is scaled by the
    // ball's radius, so a world size has to be divided back out.
    const local = stuck.worldSize / Math.max(0.2, smoothedRadius);
    matrix.compose(stuck.seat, stuck.orientation, scratchScale.setScalar(local));
    layer.stuck.setMatrixAt(slot, matrix);
  }

  /** Rewrite the cargo whenever the ball has grown enough for the drift to show. */
  function rescaleStuck() {
    if (Math.abs(smoothedRadius - stuckRadius) < stuckRadius * 0.03) return;
    stuckRadius = smoothedRadius;
    for (const layer of layers) {
      if (layer.stuckCount === 0) continue;
      for (let slot = 0; slot < layer.stuckCount; slot += 1) writeStuckMatrix(layer, slot);
      layer.stuck.instanceMatrix.needsUpdate = true;
    }
  }

  function update(dt: number, camera: Camera, tension: number) {
    camera.getWorldDirection(forwardFlat);
    forwardFlat.y = 0;
    if (forwardFlat.lengthSq() < 1e-6) forwardFlat.set(0, 0, -1);
    forwardFlat.normalize();
    rightFlat.set(forwardFlat.z, 0, -forwardFlat.x);

    // The ball's size is read straight off how high the rail carries the
    // camera, so growing the ball and climbing over a bigger table are the
    // same authored curve.
    const targetRadius = Math.max(0.4, (camera.position.y - tableY) / BALL_HEIGHT_RATIO);
    smoothedRadius += (targetRadius - smoothedRadius) * Math.min(1, dt * 3.2);
    ball.radius = smoothedRadius;
    ball.center
      .copy(camera.position)
      .addScaledVector(forwardFlat, smoothedRadius * BALL_LEAD_RADII);
    ball.center.y = tableY + smoothedRadius;

    ballRoot.position.copy(ball.center);
    ballSpin.scale.setScalar(smoothedRadius);
    ballShadow.position.set(ball.center.x, tableY + 0.02, ball.center.z);
    ballShadow.scale.setScalar(smoothedRadius * 2.5);

    if (lastCenter) {
      const travelled = scratchVector.copy(ball.center).sub(lastCenter);
      const distance = travelled.length();
      if (distance > 1e-5) {
        rollAxis.copy(travelled).normalize().cross(UP);
        if (rollAxis.lengthSq() > 1e-8) {
          rollAxis.normalize();
          rollDelta.setFromAxisAngle(rollAxis, -distance / Math.max(0.2, smoothedRadius));
          ballSpin.quaternion.premultiply(rollDelta);
        }
      }
      lastCenter.copy(ball.center);
    } else {
      lastCenter = ball.center.clone();
    }

    rescaleStuck();

    const reach = smoothedRadius * 1.35 + 0.3;
    for (const layer of layers) {
      let dirty = false;
      for (let index = 0; index < LOOSE_CAPACITY; index += 1) {
        const piece = layer.pieces[index];
        if (!piece.active) continue;
        piece.age += dt;

        if (!piece.resting) {
          piece.velocity.y -= GRAVITY * dt;
          piece.position.addScaledVector(piece.velocity, dt);
          const floor = tableY + piece.size * 0.42;
          if (piece.position.y <= floor) {
            piece.position.y = floor;
            if (piece.velocity.y < -1.2) {
              piece.velocity.y = -piece.velocity.y * REST_BOUNCE;
              piece.velocity.x *= 0.6;
              piece.velocity.z *= 0.6;
              piece.spin.multiplyScalar(0.5);
            } else {
              piece.resting = true;
              piece.velocity.set(0, 0, 0);
              piece.spin.set(0, 0, 0);
            }
          }
          const spinRate = piece.spin.length();
          if (spinRate > 1e-4) {
            rollAxis.copy(piece.spin).divideScalar(spinRate);
            piece.quaternion.multiply(scratchQuaternion.setFromAxisAngle(rollAxis, spinRate * dt * 0.25));
          }
        } else if (!piece.stray) {
          // Resting pieces creep into the groove the ball rides, so a debris
          // field turns into a line of loot laid out directly ahead.
          toPiece.copy(piece.position).sub(camera.position);
          const along = toPiece.dot(forwardFlat);
          if (along > 0 && along < 70) {
            const lateral = toPiece.dot(rightFlat);
            const step = Math.min(Math.abs(lateral), HERD_SPEED * dt * (1 + tension));
            if (step > 0.0001) piece.position.addScaledVector(rightFlat, -Math.sign(lateral) * step);
          }
        }

        // Pick-up test is a squat cylinder, not a sphere: the ball rolls over
        // pieces lying flat on the wood, and a sphere test around its centre
        // would need them to be almost exactly under the equator.
        toPiece.copy(piece.position).sub(ball.center);
        const vertical = Math.abs(toPiece.y);
        toPiece.y = 0;
        if (vertical <= smoothedRadius * 1.6 && toPiece.lengthSq() <= (reach + piece.size) ** 2) {
          if (layer.loose.instanceColor) layer.loose.getColorAt(index, scratchColor);
          else scratchColor.setRGB(1, 1, 1);
          hideInstance(layer.loose, index);
          stickPiece(layer, piece, scratchColor);
          dirty = true;
          continue;
        }

        // Recycle anything the ball rolled past; it has no more work to do.
        if (scratchVector.copy(piece.position).sub(camera.position).dot(forwardFlat) < -14 || piece.age > 26) {
          piece.active = false;
          hideInstance(layer.loose, index);
          dirty = true;
          continue;
        }

        matrix.compose(piece.position, piece.quaternion, scratchScale.setScalar(piece.size * 2));
        layer.loose.setMatrixAt(index, matrix);
        dirty = true;
      }
      if (dirty) layer.loose.instanceMatrix.needsUpdate = true;
    }
  }

  function reset() {
    for (const layer of layers) {
      for (let index = 0; index < LOOSE_CAPACITY; index += 1) {
        layer.pieces[index].active = false;
        hideInstance(layer.loose, index);
      }
      for (let index = 0; index < STUCK_CAPACITY; index += 1) hideInstance(layer.stuck, index);
      layer.loose.instanceMatrix.needsUpdate = true;
      layer.stuck.instanceMatrix.needsUpdate = true;
      layer.stuckCount = 0;
      layer.nextStuck = 0;
      layer.nextLoose = 0;
    }
    stuckRadius = smoothedRadius;
    ballSpin.quaternion.identity();
    lastCenter = null;
    stuckTotal = 0;
  }

  return {
    ball,
    scatter,
    update,
    reset,
    stuckCount: () => stuckTotal,
  };
}
