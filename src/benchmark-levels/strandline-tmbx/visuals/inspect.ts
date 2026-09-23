import { Color, DirectionalLight, Group, HemisphereLight } from 'three';
import {
  createBladderMesh,
  createCreeperMesh,
  createDrifterMesh,
  createHatchlingMesh,
  createParentMesh,
  createSporeMesh,
  createTickMesh,
} from './enemies';

// Inspection only: every parasite in a row under the level's own sun, for
// `npm run snapshot -- --module src/benchmark-levels/strandline-tmbx/visuals/inspect.ts --export createParasiteLineup`.
export function createParasiteLineup() {
  const group = new Group();
  const kinds = [createTickMesh(), createCreeperMesh(), createBladderMesh(), createDrifterMesh(), createHatchlingMesh(), createSporeMesh()];
  kinds.forEach((mesh, index) => {
    mesh.position.set((index - (kinds.length - 1) / 2) * 4.2, 0, 0);
    mesh.rotation.y = -0.6;
    group.add(mesh);
  });
  group.add(new HemisphereLight(new Color(0.62, 0.92, 0.88), new Color(0.02, 0.07, 0.16), 1.25));
  const sun = new DirectionalLight(new Color(0.9, 1, 0.94), 1.8);
  sun.position.set(2, 10, 3);
  group.add(sun);
  return group;
}

export function createParentInspection() {
  const group = new Group();
  group.add(createParentMesh({ web: true }));
  group.add(new HemisphereLight(new Color(0.62, 0.92, 0.88), new Color(0.02, 0.07, 0.16), 1.25));
  const sun = new DirectionalLight(new Color(0.9, 1, 0.94), 1.8);
  sun.position.set(2, 10, 3);
  group.add(sun);
  return group;
}
