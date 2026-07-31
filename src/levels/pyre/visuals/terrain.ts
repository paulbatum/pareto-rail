import { addPlate, type EnvironmentSink } from './kit';
import { PYRE_GROUND, PYRE_PIT } from './world';

/**
 * The ground and the cut in it.
 *
 * The ground is four slabs laid around the pit rather than one sheet with a hole
 * in it, so the pit walls are those slabs' own cut faces and cost nothing. They
 * carry no outline: the four are one continuous surface, and an edge drawn where
 * two of them meet reads as a seam in ground that has none.
 */
export function addGround(sink: EnvironmentSink) {
  const { edge, nearZ, farZ, thickness, color } = PYRE_GROUND;
  const ground = (x0: number, x1: number, z0: number, z1: number) =>
    addPlate(sink, { x0, x1, z0, z1, top: 0, drop: thickness, color, outline: false });

  ground(-edge, edge, nearZ, PYRE_PIT.nearZ);
  ground(-edge, edge, PYRE_PIT.farZ, farZ);
  ground(-edge, PYRE_PIT.x0, PYRE_PIT.nearZ, PYRE_PIT.farZ);
  ground(PYRE_PIT.x1, edge, PYRE_PIT.nearZ, PYRE_PIT.farZ);

  addPlate(sink, {
    x0: PYRE_PIT.x0,
    x1: PYRE_PIT.x1,
    z0: PYRE_PIT.nearZ,
    z1: PYRE_PIT.farZ,
    top: -PYRE_PIT.depth,
    drop: thickness - PYRE_PIT.depth,
    color: PYRE_PIT.floorColor,
  });
}
