import { BufferGeometry, EdgesGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from 'three';
import type { InstancedMesh, Mesh } from 'three';

/**
 * Edge shells for flat-shaded masses.
 *
 * Nothing here knows what it is outlining: callers supply the mesh and the
 * colour. The one problem the mechanism does own is that an edge line lies
 * exactly on the faces it traces, which is the worst case a depth buffer can be
 * handed. Rather than lean on a depth bias, the shell is inflated off the
 * surface — every vertex moves outward from the geometry's centre so that no
 * line shares a plane with a face, from any viewing angle.
 */
export interface EdgeStyle {
  color: number;
  /** Degrees. Only face pairs meeting more sharply than this contribute an edge. */
  threshold?: number;
  /** World units the shell stands off the surface it traces. */
  offset?: number;
}

const DEFAULT_THRESHOLD = 16;
const DEFAULT_OFFSET = 0.06;
/** Instanced shells inflate by ratio instead, because instance scales vary. */
const DEFAULT_INSTANCED_SWELL = 1.012;

const centre = new Vector3();
const size = new Vector3();
const vertex = new Vector3();

/**
 * Push every vertex out from the geometry's own centre so the shell clears the
 * faces. `scale` is the mesh's own scale: the offset is a world-unit request, so
 * on a scaled mesh it has to be divided back down or the shell stands off by the
 * scale factor and the mass's far edges surface through its own front.
 */
function inflate(geometry: BufferGeometry, offset: number, scale: Vector3) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;
  bounds.getCenter(centre);
  bounds.getSize(size);
  const spanX = size.x * Math.abs(scale.x);
  const spanY = size.y * Math.abs(scale.y);
  const spanZ = size.z * Math.abs(scale.z);
  const scaleX = spanX > 1e-4 ? 1 + (2 * offset) / spanX : 1;
  const scaleY = spanY > 1e-4 ? 1 + (2 * offset) / spanY : 1;
  const scaleZ = spanZ > 1e-4 ? 1 + (2 * offset) / spanZ : 1;

  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    positions.setXYZ(
      i,
      centre.x + (positions.getX(i) - centre.x) * scaleX,
      centre.y + (positions.getY(i) - centre.y) * scaleY,
      centre.z + (positions.getZ(i) - centre.z) * scaleZ,
    );
  }
  positions.needsUpdate = true;
}

/**
 * An edge shell for one mesh, returned unparented. Add it as a child of that
 * mesh so it inherits the transform.
 */
export function createEdges(mesh: Mesh, style: EdgeStyle): LineSegments {
  const geometry = new EdgesGeometry(mesh.geometry, style.threshold ?? DEFAULT_THRESHOLD);
  inflate(geometry, style.offset ?? DEFAULT_OFFSET, mesh.scale);
  return new LineSegments(geometry, new LineBasicMaterial({ color: style.color }));
}

/**
 * One merged shell covering every instance of an instanced mesh. Instances vary
 * in scale, so this swells by ratio rather than by a world-unit offset.
 */
export function createInstancedEdges(mesh: InstancedMesh, style: EdgeStyle, swell = DEFAULT_INSTANCED_SWELL): LineSegments {
  const source = new EdgesGeometry(mesh.geometry, style.threshold ?? DEFAULT_THRESHOLD);
  const local = source.getAttribute('position');
  const matrix = new Matrix4();
  const merged: number[] = [];

  for (let instance = 0; instance < mesh.count; instance += 1) {
    mesh.getMatrixAt(instance, matrix);
    for (let i = 0; i < local.count; i += 1) {
      vertex.set(local.getX(i) * swell, local.getY(i) * swell, local.getZ(i) * swell).applyMatrix4(matrix);
      merged.push(vertex.x, vertex.y, vertex.z);
    }
  }
  source.dispose();

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(merged, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color: style.color }));
}
