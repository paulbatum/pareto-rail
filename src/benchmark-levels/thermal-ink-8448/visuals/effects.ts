import {
  Camera,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';

type Spark = {
  mesh: Mesh;
  velocity: Vector3;
  age: number;
  life: number;
  spin: number;
};

type Ring = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  size: number;
};

type Glint = {
  group: Group;
  materials: MeshBasicMaterial[];
  age: number;
  life: number;
  size: number;
};

export type ThermalInkEffects = ReturnType<typeof createEffects>;

export function createEffects(scene: Group | { add(object: Group | Mesh): unknown }) {
  const sparks: Spark[] = [];
  const rings: Ring[] = [];
  const glints: Glint[] = [];
  const sparkGeometry = new TetrahedronGeometry(0.13, 0);
  const ringGeometry = new RingGeometry(0.965, 1, 48);
  const bladeGeometry = new TetrahedronGeometry(0.06, 0);

  function ring(position: Vector3, color: Color, size: number, life = 0.38) {
    if (rings.length > 64) {
      const old = rings.shift();
      if (old) disposeMesh(old.mesh);
    }
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false });
    const mesh = new Mesh(ringGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(size * 0.12);
    scene.add(mesh);
    rings.push({ mesh, color: color.clone(), age: 0, life, size });
  }

  function glint(position: Vector3, color: Color, size = 1, life = 0.18) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false });
      const blade = new Mesh(bladeGeometry, material);
      blade.scale.set(size * 7, size * 0.25, size * 0.25);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.position.copy(position);
    scene.add(group);
    glints.push({ group, materials, age: 0, life, size });
  }

  function burst(position: Vector3, color: Color, count = 8, speed = 8) {
    for (let index = 0; index < count; index += 1) {
      const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
      const mesh = new Mesh(sparkGeometry, material);
      mesh.position.copy(position);
      const direction = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      scene.add(mesh);
      sparks.push({
        mesh,
        velocity: direction.multiplyScalar(speed * (0.45 + Math.random() * 0.8)),
        age: 0,
        life: 0.24 + Math.random() * 0.3,
        spin: 5 + Math.random() * 12,
      });
    }
  }

  function reset() {
    for (const spark of sparks) disposeMesh(spark.mesh);
    for (const item of rings) disposeMesh(item.mesh);
    for (const item of glints) {
      item.group.removeFromParent();
      for (const material of item.materials) material.dispose();
    }
    sparks.length = 0;
    rings.length = 0;
    glints.length = 0;
  }

  function update(dt: number, camera: Camera) {
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      spark.age += dt;
      if (spark.age >= spark.life) {
        disposeMesh(spark.mesh);
        sparks.splice(index, 1);
        continue;
      }
      spark.velocity.multiplyScalar(Math.max(0, 1 - dt * 3.3));
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += spark.spin * dt;
      spark.mesh.rotation.y += spark.spin * 0.73 * dt;
      (spark.mesh.material as MeshBasicMaterial).opacity = 1 - spark.age / spark.life;
    }

    for (let index = rings.length - 1; index >= 0; index -= 1) {
      const item = rings[index];
      item.age += dt;
      if (item.age >= item.life) {
        disposeMesh(item.mesh);
        rings.splice(index, 1);
        continue;
      }
      const progress = item.age / item.life;
      item.mesh.quaternion.copy(camera.quaternion);
      item.mesh.scale.setScalar(item.size * (0.12 + progress * 0.88));
      (item.mesh.material as MeshBasicMaterial).color.copy(item.color).multiplyScalar((1 - progress) ** 1.5);
      (item.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - progress);
    }

    for (let index = glints.length - 1; index >= 0; index -= 1) {
      const item = glints[index];
      item.age += dt;
      if (item.age >= item.life) {
        item.group.removeFromParent();
        for (const material of item.materials) material.dispose();
        glints.splice(index, 1);
        continue;
      }
      const progress = item.age / item.life;
      const scale = item.size * (0.15 + Math.sin(progress * Math.PI) * 1.1);
      item.group.quaternion.copy(camera.quaternion);
      item.group.scale.setScalar(scale);
      for (const material of item.materials) material.opacity = 1 - progress;
    }
  }

  return { burst, ring, glint, reset, update };
}

function disposeMesh(mesh: Mesh) {
  mesh.removeFromParent();
  if (mesh.material instanceof MeshBasicMaterial) mesh.material.dispose();
}
