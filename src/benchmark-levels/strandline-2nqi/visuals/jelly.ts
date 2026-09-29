import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  TorusGeometry,
  Vector2,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { atan, cameraPosition, float, mix, mx_noise_float, normalWorld, positionLocal, positionWorld, smoothstep, step, time, uv, vec3 } from 'three/tsl';
import { BELL, TIP_Y } from '../world';
import { BELL_GOLD, BELL_GREEN, SICK_MAGENTA, VIOLET_DARK, hdr } from './palette';
import { cleanseU, clarityU, gloomU, infectionU, pulseU, vitalityU } from './uniforms';

// The bell: a translucent dome the size of a valley. From below it is a
// cathedral of glowing canals converging on the crown; from the swing wide it
// is a green moon. Everything lives in the jelly's own frame.

const P = 44; // profile points per side

function bellProfile() {
  const points: Vector2[] = [];
  const cy = BELL.center.y;
  const H = BELL.height;
  const R = BELL.radius;
  const phiMax = 1.72;
  // outer surface: apex → margin
  for (let i = 0; i < P; i += 1) {
    const phi = (i / (P - 1)) * phiMax;
    const flare = 7 * MathUtils.smoothstep(phi, 1.25, phiMax);
    points.push(new Vector2(R * Math.sin(phi) + flare, cy + H * Math.cos(phi)));
  }
  // rounded lip
  const lip = points[points.length - 1];
  points.push(new Vector2(lip.x - 3.5, lip.y - 2.6));
  // inner surface (subumbrella): margin → apex, thinner toward the rim
  const innerR = R - 10;
  const innerH = H - BELL.thicknessAtApex + 0; // 36 at the default numbers
  for (let i = P - 1; i >= 0; i -= 1) {
    const phi = (i / (P - 1)) * phiMax;
    points.push(new Vector2(Math.max(0, innerR * Math.sin(phi)), cy + innerH * Math.cos(phi)));
  }
  return points;
}

export function createBell() {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const geometry = new LatheGeometry(bellProfile(), 96);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, fog: false });
  const coord = uv();
  const dist = positionLocal.xz.length().div(BELL.radius);
  const cameraDistance = cameraPosition.sub(positionWorld).length();
  // The bell hangs in murk until you are close — or until the water clears.
  const haze = mix(cameraDistance.mul(-0.0068).exp().mul(0.88).add(0.12), float(1), clarityU);
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(view).abs();
  const rim = float(1).sub(facing).max(0).pow(2.2);
  const inner = step(float(0.5), coord.y);

  // Canals radiate from the crown; the ring canal circles near the margin;
  // the ripple is the pulse.
  const canal = coord.x.mul(Math.PI * 8).sin().abs().pow(40);
  const fineCanal = coord.x.mul(Math.PI * 32).sin().abs().pow(90).mul(0.45);
  const ringOffset = dist.sub(0.84).mul(26);
  const ringCanal = ringOffset.mul(ringOffset).negate().exp();
  const front = float(1).sub(pulseU);
  const rippleOffset = dist.sub(front.mul(1.15)).mul(6);
  const ripple = rippleOffset.mul(rippleOffset).negate().exp().mul(pulseU);
  const breath = time.mul(0.5).sin().mul(0.5).add(0.5);

  // Parasite stains: bruised patches that wash out as the animal recovers.
  const noise = mx_noise_float(positionLocal.mul(0.028).add(vec3(3.1, 1.7, 0.4)));
  const stain = smoothstep(float(0.28), float(0.58), noise).mul(infectionU).mul(float(1).sub(cleanseU));

  const glass = vec3(BELL_GREEN.r, BELL_GREEN.g, BELL_GREEN.b);
  const bellGold = vec3(BELL_GOLD.r, BELL_GOLD.g, BELL_GOLD.b);
  const bruise = vec3(VIOLET_DARK.r * 2.6, VIOLET_DARK.g * 2.2, VIOLET_DARK.b * 2.6);
  const sickly = vec3(SICK_MAGENTA.r * 0.6, SICK_MAGENTA.g * 0.35, SICK_MAGENTA.b * 0.65);

  // Backlit by the surface: a lantern of green glass, brightest near the crown
  // and in the rim, with gold light running through the canals.
  const life = vitalityU.mul(0.8).add(0.2);
  const lantern = float(1).sub(dist.mul(0.55));
  let color = glass.mul(lantern.mul(0.42).add(0.2));
  color = color.add(glass.mul(rim.mul(0.55)));
  const lines = canal.add(fineCanal).add(ringCanal.mul(0.9)).clamp(0, 1);
  color = mix(color, bellGold.mul(1.05), lines.mul(life));
  color = color.add(bellGold.mul(ripple.mul(0.7)).mul(life));
  color = mix(color, bruise, stain.mul(0.85));
  color = mix(color, sickly, stain.mul(0.3).mul(breath));
  const gloomDim = float(1).sub(gloomU.mul(0.72));
  material.colorNode = color.mul(life.mul(0.55).add(0.55)).mul(gloomDim);
  material.opacityNode = mix(
    float(0.26).add(rim.mul(0.4)).add(lines.mul(0.3)),
    float(0.34).add(lines.mul(0.42)).add(lantern.mul(0.12)),
    inner,
  )
    .add(ripple.mul(0.15))
    .add(stain.mul(0.25))
    .mul(haze)
    .clamp(0, 0.9);
  const shell = new Mesh(geometry, material);
  shell.renderOrder = 2;
  group.add(shell);

  // Gonads: four horseshoe rings in a clover, glowing under the crown, seen from below.
  const gonadMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const gonadPulse = time.mul(1.1).add(positionLocal.x.mul(0.08)).sin().mul(0.25).add(0.75);
  gonadMaterial.colorNode = vec3(BELL_GOLD.r, BELL_GOLD.g, BELL_GOLD.b).mul(gonadPulse).mul(vitalityU.mul(0.6).add(0.14)).mul(pulseU.mul(0.5).add(0.7)).mul(float(1).sub(smoothstep(float(0.05), float(0.5), gloomU))).mul(haze);
  const gonadGeometries: TorusGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const around = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const gonad = new Mesh(gonadGeometries[gonadGeometries.push(new TorusGeometry(9.5, 0.7, 6, 30, Math.PI * 1.7).rotateZ(around - Math.PI * 0.35)) - 1], gonadMaterial);
    gonad.rotation.x = Math.PI / 2;
    gonad.position.set(Math.cos(around) * 13, 3.6, Math.sin(around) * 13);
    gonad.renderOrder = 3;
    group.add(gonad);
  }

  // A lantern-bright rim where the bell folds under, pulsing on the heartbeat.
  const rimMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  rimMaterial.colorNode = vec3(BELL_GOLD.r, BELL_GOLD.g, BELL_GOLD.b)
    .mul(vitalityU.mul(0.6).add(0.16))
    .mul(pulseU.mul(0.6).add(0.65))
    .mul(atan(positionLocal.z, positionLocal.x).mul(12).add(time.mul(0.7)).sin().mul(0.2).add(0.8))
    .mul(float(1).sub(gloomU.mul(0.7)))
    .mul(haze);
  const rimTorus = new Mesh(new TorusGeometry(BELL.radius - 3, 1.1, 8, 160), rimMaterial);
  rimTorus.rotation.x = Math.PI / 2;
  rimTorus.position.y = BELL.marginY + 1;
  rimTorus.renderOrder = 3;
  group.add(rimTorus);

  return { group, shell, dispose() { geometry.dispose(); for (const g of gonadGeometries) g.dispose(); } };
}

void BackSide;
void Color;
void hdr;
void TIP_Y;
