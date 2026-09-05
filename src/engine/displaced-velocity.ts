import type { Node, NodeBuilder } from 'three/webgpu';
import { deltaTime, Fn, positionLocal, positionPrevious, time, uniform } from 'three/tsl';

/* Correct motion vectors for geometry a material moves in its positionNode.

   With `post.velocityBuffer` on, three's velocity pass compares each vertex's current
   position with `positionPrevious`, which is the undisplaced geometry position after the
   previous frame's instance matrix. A positionNode that rotates or waves vertices therefore
   reports the whole displacement as velocity every frame, and the object smears even at
   rest. `displacedPosition` builds the positionNode and also assigns `positionPrevious`
   from the same displacement evaluated at the previous frame's clock value, so only the
   change between frames becomes velocity. */

/** A scalar the displacement depends on, evaluated for this frame and the previous one. */
export type DisplacementClock = { current: Node<'float'>; previous: Node<'float'> };

/** The renderer's frame clock: TSL `time` now and `time - deltaTime` for the previous frame. */
export const frameClock: DisplacementClock = { current: time, previous: time.sub(deltaTime) };

/** A clock the level drives, for displacement keyed to run time, a spin-up value, or any other scalar the level owns. */
export function createDisplacementClock(initial = 0) {
  const current = uniform(initial);
  const previous = uniform(initial);
  return {
    current,
    previous,
    /** Call once per frame with the new value before the frame renders. */
    set(value: number) {
      previous.value = current.value;
      current.value = value;
    },
  };
}

/**
 * Returns a positionNode. `displace` receives the vertex position (after instancing) and the
 * clock value, and returns the moved position. Assign the result to `material.positionNode`.
 * The previous-position work is emitted only in passes that write velocity.
 */
export function displacedPosition(
  displace: (position: Node<'vec3'>, clock: Node<'float'>) => Node<'vec3'>,
  clock: DisplacementClock = frameClock,
): Node<'vec3'> {
  return Fn((builder: NodeBuilder) => {
    /* The method exists at runtime; the type declaration lags it. */
    const needsPreviousData = (builder as NodeBuilder & { needsPreviousData(): boolean }).needsPreviousData();
    if (needsPreviousData) positionPrevious.assign(displace(positionPrevious, clock.previous));
    return displace(positionLocal, clock.current);
  })();
}
