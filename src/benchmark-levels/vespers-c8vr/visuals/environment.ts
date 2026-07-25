import {
  BoxGeometry,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

const BLACK_STONE_COLOR = 0x0f1118;
const DARK_PIER_MAT = new MeshBasicMaterial({ color: BLACK_STONE_COLOR });

const JEWEL_PALETTE = [0x0033ff, 0xff0d33, 0x00cc66, 0xffaa00]; // Cobalt, Crimson, Emerald, Gold

export interface WindowState {
  index: number;
  position: Vector3;
  side: 'left' | 'right';
  isLit: boolean;
  color: number;
  mesh: Mesh;
  glowMesh: Mesh;
}

export class CathedralEnvironment {
  scene: Scene;
  container: Group;
  windows: WindowState[] = [];
  roseWindowGroup: Group;
  rosePetalMeshes: Mesh[] = [];
  candleInstancedMesh!: InstancedMesh;
  isRoseIgnited = false;
  timeAlive = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.container = new Group();
    this.container.name = 'cathedral-environment';
    scene.add(this.container);

    this.roseWindowGroup = new Group();
    this.roseWindowGroup.position.set(0, 4, -340);
    this.container.add(this.roseWindowGroup);

    this.buildArchitecture();
    this.buildStainedGlassWindows();
    this.buildWestRoseWindow();
    this.buildCandleFloor();
  }

  private buildArchitecture() {
    // Build 18 bays of black stone piers, arches, and ribbed vaults along the nave
    const pierGeo = new BoxGeometry(2.0, 32.0, 2.0);
    const archGeo = new TorusGeometry(12.0, 0.4, 8, 16, Math.PI);
    const vaultRibGeo = new TorusGeometry(16.0, 0.3, 8, 16, Math.PI);

    for (let z = 20; z >= -380; z -= 20) {
      // Left and Right Stone Piers
      const leftPier = new Mesh(pierGeo, DARK_PIER_MAT);
      leftPier.position.set(-13, 6, z);
      this.container.add(leftPier);

      const rightPier = new Mesh(pierGeo, DARK_PIER_MAT);
      rightPier.position.set(13, 6, z);
      this.container.add(rightPier);

      // Transverse Gothic Arch overhead
      const arch = new Mesh(archGeo, DARK_PIER_MAT);
      arch.position.set(0, 10, z);
      arch.rotation.x = Math.PI / 2;
      this.container.add(arch);

      // Ribbed Vaulting Ribs
      const rib = new Mesh(vaultRibGeo, DARK_PIER_MAT);
      rib.position.set(0, 16, z);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.y = (z % 40 === 0 ? 1 : -1) * 0.25;
      this.container.add(rib);
    }
  }

  private buildStainedGlassWindows() {
    // 16 pairs of lancet stained glass windows along the left and right walls
    const windowGeo = new PlaneGeometry(4.0, 12.0);
    const glowGeo = new PlaneGeometry(12.0, 20.0);

    let windowIdx = 0;
    for (let z = 0; z >= -340; z -= 22) {
      // Left Window (x = -14.5)
      const leftMat = new MeshBasicMaterial({
        color: 0x08090d,
        side: DoubleSide,
      });
      const leftWindow = new Mesh(windowGeo, leftMat);
      leftWindow.position.set(-14.5, 8, z);
      leftWindow.rotation.y = Math.PI / 2;
      this.container.add(leftWindow);

      const leftGlowMat = new MeshBasicMaterial({
        color: 0x0033ff,
        transparent: true,
        opacity: 0.0,
        side: DoubleSide,
      });
      const leftGlow = new Mesh(glowGeo, leftGlowMat);
      leftGlow.position.set(-13.5, 8, z);
      leftGlow.rotation.y = Math.PI / 2;
      this.container.add(leftGlow);

      this.windows.push({
        index: windowIdx++,
        position: new Vector3(-14.5, 8, z),
        side: 'left',
        isLit: false,
        color: JEWEL_PALETTE[windowIdx % JEWEL_PALETTE.length],
        mesh: leftWindow,
        glowMesh: leftGlow,
      });

      // Right Window (x = +14.5)
      const rightMat = new MeshBasicMaterial({
        color: 0x08090d,
        side: DoubleSide,
      });
      const rightWindow = new Mesh(windowGeo, rightMat);
      rightWindow.position.set(14.5, 8, z);
      rightWindow.rotation.y = -Math.PI / 2;
      this.container.add(rightWindow);

      const rightGlowMat = new MeshBasicMaterial({
        color: 0xff0d33,
        transparent: true,
        opacity: 0.0,
        side: DoubleSide,
      });
      const rightGlow = new Mesh(glowGeo, rightGlowMat);
      rightGlow.position.set(13.5, 8, z);
      rightGlow.rotation.y = -Math.PI / 2;
      this.container.add(rightGlow);

      this.windows.push({
        index: windowIdx++,
        position: new Vector3(14.5, 8, z),
        side: 'right',
        isLit: false,
        color: JEWEL_PALETTE[windowIdx % JEWEL_PALETTE.length],
        mesh: rightWindow,
        glowMesh: rightGlow,
      });
    }
  }

  private buildWestRoseWindow() {
    // Outer stone traceried rim
    const rimGeo = new TorusGeometry(7.0, 0.6, 12, 32);
    const rim = new Mesh(rimGeo, DARK_PIER_MAT);
    this.roseWindowGroup.add(rim);

    // 12 Stained Glass Petals forming the Rose Wheel
    const petalGeo = new BoxGeometry(1.6, 5.0, 0.1);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const mat = new MeshBasicMaterial({
        color: 0x0a0c10,
        transparent: true,
        opacity: 0.9,
      });
      const petal = new Mesh(petalGeo, mat);
      petal.position.set(Math.cos(angle) * 4.0, Math.sin(angle) * 4.0, 0);
      petal.rotation.z = angle + Math.PI / 2;
      this.roseWindowGroup.add(petal);
      this.rosePetalMeshes.push(petal);
    }

    // Central Oculus Pane
    const oculusGeo = new SphereGeometry(1.8, 16, 16);
    const oculusMat = new MeshBasicMaterial({ color: 0x08090d });
    const oculus = new Mesh(oculusGeo, oculusMat);
    oculus.name = 'rose-oculus';
    this.roseWindowGroup.add(oculus);
  }

  private buildCandleFloor() {
    // Instanced candle flames on floor at y = -9.8
    const candleCount = 200;
    const flameGeo = new ConeGeometry(0.08, 0.25, 4);
    const flameMat = new MeshBasicMaterial({ color: 0xffaa33 });

    this.candleInstancedMesh = new InstancedMesh(flameGeo, flameMat, candleCount);
    const dummy = new Matrix4();

    for (let i = 0; i < candleCount; i++) {
      const x = (Math.random() - 0.5) * 20.0;
      const y = -9.8 + Math.random() * 0.2;
      const z = -Math.random() * 340.0;

      dummy.setPosition(x, y, z);
      this.candleInstancedMesh.setMatrixAt(i, dummy);
    }
    this.candleInstancedMesh.instanceMatrix.needsUpdate = true;
    this.container.add(this.candleInstancedMesh);
  }

  restoreNearestWindow(pos: Vector3, preferredColor?: number) {
    let bestDist = Infinity;
    let bestWin: WindowState | null = null;

    for (const win of this.windows) {
      if (!win.isLit) {
        const d = win.position.distanceTo(pos);
        if (d < bestDist) {
          bestDist = d;
          bestWin = win;
        }
      }
    }

    if (bestWin) {
      bestWin.isLit = true;
      if (preferredColor) bestWin.color = preferredColor;

      const mat = bestWin.mesh.material as MeshBasicMaterial;
      mat.color.setHex(bestWin.color);

      const glowMat = bestWin.glowMesh.material as MeshBasicMaterial;
      glowMat.color.setHex(bestWin.color);
      glowMat.opacity = 0.45;
    }
  }

  igniteRoseWindow() {
    this.isRoseIgnited = true;

    // Light up all Rose Petals in bright saturated jewel light!
    for (let i = 0; i < this.rosePetalMeshes.length; i++) {
      const petal = this.rosePetalMeshes[i];
      const mat = petal.material as MeshBasicMaterial;
      mat.color.setHex(JEWEL_PALETTE[i % JEWEL_PALETTE.length]);
    }

    const oculus = this.roseWindowGroup.getObjectByName('rose-oculus') as Mesh | undefined;
    if (oculus && oculus.material instanceof MeshBasicMaterial) {
      oculus.material.color.setHex(0xffffff);
    }

    // Ignite ALL cathedral windows at once!
    for (const win of this.windows) {
      win.isLit = true;
      (win.mesh.material as MeshBasicMaterial).color.setHex(win.color);
      (win.glowMesh.material as MeshBasicMaterial).opacity = 0.6;
    }
  }

  update(dt: number) {
    this.timeAlive += dt;

    if (this.isRoseIgnited) {
      // Rotating kaleidoscope of jewel light at the Rose Window
      this.roseWindowGroup.rotation.z += dt * 0.3;
    }
  }
}
