import { BufferAttribute, CircleGeometry, Path, Shape } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The two outlines this level is drawn with. Everything in the cathedral —
// openings, panes, letters, and the things that come off the glass — is cut
// from a pointed arch or an almond, so the enemies read as pieces of the
// building even before their colour does.

/** Two-centred pointed arch. `rise` must exceed `halfWidth` or the head is round. */
export function lancetPath<T extends Path>(path: T, halfWidth: number, sill: number, spring: number, apex: number): T {
  const rise = apex - spring;
  const centre = (rise * rise - halfWidth * halfWidth) / (2 * halfWidth);
  const radius = centre + halfWidth;
  path.moveTo(-halfWidth, sill);
  path.lineTo(-halfWidth, spring);
  path.absarc(centre, spring, radius, Math.PI, Math.atan2(rise, -centre), true);
  path.absarc(-centre, spring, radius, Math.atan2(rise, centre), 0, true);
  path.lineTo(halfWidth, sill);
  path.closePath();
  return path;
}

export function lancetShape(halfWidth: number, sill: number, spring: number, apex: number) {
  return lancetPath(new Shape(), halfWidth, sill, spring, apex);
}

/** Vesica: two arcs meeting at a point top and bottom. The rose's petal. */
export function vesicaShape(halfWidth: number, halfHeight: number) {
  const shape = new Shape();
  shape.moveTo(0, -halfHeight);
  shape.quadraticCurveTo(halfWidth * 1.45, -halfHeight * 0.22, 0, halfHeight);
  shape.quadraticCurveTo(-halfWidth * 1.45, -halfHeight * 0.22, 0, -halfHeight);
  shape.closePath();
  return shape;
}

/** A tapered blade, used for wings and for the pieces things shatter into. */
export function bladeShape(length: number, halfWidth: number, sweep: number) {
  const shape = new Shape();
  shape.moveTo(0, -halfWidth);
  shape.quadraticCurveTo(length * 0.55, -halfWidth * 0.35 + sweep, length, 0);
  shape.quadraticCurveTo(length * 0.55, halfWidth * 0.9 + sweep, 0, halfWidth);
  shape.closePath();
  return shape;
}

/**
 * Merge and dispose. Three's merge refuses to mix indexed and non-indexed
 * inputs, and the polyhedra this level builds bodies from are non-indexed
 * while everything else is not, so flatten before merging.
 */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat);
  for (const part of flat) part.dispose();
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * A disc that fades to nothing at its rim. Additive quads with hard edges look
 * fine at range and become a white rectangle across the whole frame when the
 * camera passes within a metre of one, which is exactly what happens to every
 * target this level overtakes.
 */
export function softDiscGeometry(radius: number, segments = 20): BufferGeometry {
  const geometry = new CircleGeometry(radius, segments);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const value = (1 - Math.min(1, Math.hypot(position.getX(i), position.getY(i)) / radius)) ** 1.7;
    colors[i * 3] = value;
    colors[i * 3 + 1] = value;
    colors[i * 3 + 2] = value;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
