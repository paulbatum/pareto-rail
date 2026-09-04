import {
  BackSide, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, Points, PointsMaterial, SphereGeometry,
} from 'three';

function turbulence(x: number, y: number, z: number) {
  let value = 0, weight = 0.52;
  for (let i = 0; i < 5; i++) {
    value += weight * (Math.sin(x + Math.sin(y * 1.7)) * Math.cos(y + Math.sin(z * 1.8)) * Math.sin(z + Math.cos(x * 1.4)));
    x = x * 2.07 + 13.2; y = y * 2.13 + 7.1; z = z * 2.03 - 9.3;
    weight *= 0.5;
  }
  return value;
}

export function makeSky(colors: { void: number; magenta: number; gold: number; haze: number }) {
  const root = new Group();
  const geometry = new SphereGeometry(10500, 192, 112);
  const positions = geometry.getAttribute('position');
  const values: number[] = [];
  const dark = new Color(colors.void), magenta = new Color(colors.magenta), gold = new Color(colors.gold), haze = new Color(colors.haze);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / 10500, y = positions.getY(i) / 10500, z = positions.getZ(i) / 10500;
    const n = turbulence(x * 5, y * 5, z * 5);
    const ribbon = y + x * 0.38 + 0.13 * Math.sin(z * 7 + x * 4);
    const envelope = Math.exp(-Math.pow((ribbon - n * 0.45 - 0.17) / 0.33, 2));
    const filaments = Math.max(0, 0.56 + n * 1.5);
    const color = dark.clone().lerp(magenta, Math.min(0.84, envelope * filaments));
    const seam = Math.exp(-Math.pow((ribbon - n * 0.5 - 0.08) / 0.105, 2));
    color.lerp(gold, Math.min(0.83, seam * Math.max(0, 0.4 + n * 2)));
    color.lerp(haze, Math.max(0, n - 0.16) * envelope * 0.55);
    values.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
  const sky = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -20;
  root.add(sky);
  const stars: number[] = [], starColors: number[] = [];
  for (let i = 0; i < 2100; i++) {
    const a = i * 2.39996322973;
    const y = 1 - 2 * (i + 0.5) / 2100;
    const r = Math.sqrt(1 - y * y);
    stars.push(Math.cos(a) * r * 9700, y * 9700, Math.sin(a) * r * 9700);
    const tint = i % 7 === 0 ? new Color(1.1, 0.61, 0.3) : new Color(0.68, 0.8, 1);
    tint.multiplyScalar(0.5 + (Math.sin(i * 71.17) + 1) * 0.4);
    starColors.push(tint.r, tint.g, tint.b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(stars, 3));
  g.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  root.add(new Points(g, new PointsMaterial({ vertexColors: true, size: 9, fog: false, depthWrite: false })));
  return root;
}
