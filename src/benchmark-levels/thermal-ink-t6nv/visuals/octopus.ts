import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

export interface OctopusBoss {
  group: Group;
  coreMesh: Mesh;
  armNodes: Map<string, Mesh>;
  update: (elapsed: number, dt: number, irAmount: number, coreExposed: boolean) => void;
}

export function createOctopusBoss(): OctopusBoss {
  const group = new Group();

  // Materials for normal vs thermal IR switching
  const octopusMat = new MeshBasicMaterial({ color: new Color(0.08, 0.09, 0.12) });
  const nodeMatNormal = new MeshBasicMaterial({ color: new Color(1.8, 0.6, 0.1) });
  const coreMatNormal = new MeshBasicMaterial({ color: new Color(3.0, 0.1, 0.15) }); // HDR Red Core

  // 1. Central Mantle / Head positioned back behind target anchors
  const mantleGeo = new SphereGeometry(5.0, 16, 12);
  mantleGeo.scale(1.0, 1.3, 0.8);
  const mantleMesh = new Mesh(mantleGeo, octopusMat);
  mantleMesh.position.set(0, 4, -115);
  group.add(mantleMesh);

  // 2. Central Exposed Core Target
  const coreGeo = new SphereGeometry(2.0, 16, 16);
  const coreMesh = new Mesh(coreGeo, coreMatNormal);
  coreMesh.position.set(0, 2, -110);
  group.add(coreMesh);

  // Core protective armor plates (4 quadrant plates)
  const plateGeo = new BoxGeometry(2.2, 2.2, 0.4);
  const plateMat = new MeshBasicMaterial({ color: new Color(0.12, 0.12, 0.16) });
  const armorPlates: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const plate = new Mesh(plateGeo, plateMat);
    const angle = (i * Math.PI) / 2;
    plate.position.set(Math.cos(angle) * 2.0, Math.sin(angle) * 2.0 + 2, -108.5);
    plate.rotation.z = angle;
    group.add(plate);
    armorPlates.push(plate);
  }

  // 3. Four Major Writhing Tentacles
  const armNodes = new Map<string, Mesh>();
  const tentacleGroups: Group[] = [];

  const segGeo = new CylinderGeometry(0.7, 1.0, 4.0, 8);
  const nodeGeo = new SphereGeometry(1.1, 12, 10);

  const armKeys = ['arm_outer_1', 'arm_outer_2', 'arm_inner_1', 'arm_inner_2'];

  for (let t = 0; t < 4; t += 1) {
    const tentacle = new Group();
    const baseAngle = (t / 4) * Math.PI * 2 + Math.PI / 4;
    tentacle.position.set(Math.cos(baseAngle) * 5.0, Math.sin(baseAngle) * 5.0 + 2, -112);

    let currentParent: Group = tentacle;
    for (let s = 0; s < 5; s += 1) {
      const segGroup = new Group();
      const segMesh = new Mesh(segGeo, octopusMat);
      segMesh.position.y = -2.0;
      segGroup.add(segMesh);

      // Attach Arm Node on segment 2 and 4
      if (s === 2 || s === 4) {
        const nodeIndex = s === 2 ? 0 : 1;
        const nodeKey = armKeys[t < 2 ? nodeIndex : nodeIndex + 2];
        const nodeMesh = new Mesh(nodeGeo, nodeMatNormal.clone());
        nodeMesh.position.set(0, -2.0, 0.8);
        nodeMesh.userData.isNode = true;
        nodeMesh.userData.nodeKey = nodeKey;
        segGroup.add(nodeMesh);
        armNodes.set(nodeKey, nodeMesh);
      }

      segGroup.position.y = s === 0 ? 0 : -3.8;
      currentParent.add(segGroup);
      currentParent = segGroup;
    }

    group.add(tentacle);
    tentacleGroups.push(tentacle);
  }

  const rotAxis = new Vector3(0, 0, 1);

  return {
    group,
    coreMesh,
    armNodes,
    update(elapsed: number, _dt: number, irAmount: number, coreExposed: boolean) {
      // 1. Writhing tentacle motion
      for (let t = 0; t < tentacleGroups.length; t += 1) {
        const tentacle = tentacleGroups[t];
        const phase = elapsed * 1.6 + t * 1.5;
        tentacle.rotation.z = Math.sin(phase) * 0.35 + (t % 2 === 0 ? 0.25 : -0.25);
        tentacle.rotation.x = Math.cos(phase * 0.6) * 0.25;

        let child = tentacle.children[0] as Group | undefined;
        let depth = 0;
        while (child && depth < 5) {
          rotAxis.set(Math.sin(phase + depth), Math.cos(phase * 0.8 + depth), 0).normalize();
          child.quaternion.setFromAxisAngle(rotAxis, Math.sin(phase * 1.2 + depth * 0.5) * 0.2);
          child = child.children.find((c) => c instanceof Group) as Group | undefined;
          depth += 1;
        }
      }

      // 2. Head & Core pulse
      mantleMesh.position.y = 4 + Math.sin(elapsed * 1.2) * 0.6;
      mantleMesh.position.x = Math.cos(elapsed * 0.9) * 0.5;
      coreMesh.position.y = 2 + Math.sin(elapsed * 1.2) * 0.6;
      coreMesh.position.x = Math.cos(elapsed * 0.9) * 0.5;

      // Armor plates open up when core is exposed
      const targetSpread = coreExposed ? 4.2 : 2.0;
      for (let i = 0; i < armorPlates.length; i += 1) {
        const plate = armorPlates[i];
        const angle = (i * Math.PI) / 2;
        const currentDist = plate.position.x * Math.cos(angle) + plate.position.y * Math.sin(angle);
        const newDist = currentDist + (targetSpread - currentDist) * 0.08;
        plate.position.set(Math.cos(angle) * newDist, Math.sin(angle) * newDist + 2, -108.5);
      }

      // 3. Infrared visual update
      const mantleColor = octopusMat.color;
      mantleColor.r = 0.08 + irAmount * 1.4;
      mantleColor.g = 0.09 + irAmount * 1.5;
      mantleColor.b = 0.12 + irAmount * 1.6;

      for (const nodeMesh of armNodes.values()) {
        const mat = nodeMesh.material as MeshBasicMaterial;
        mat.color.r = 1.8 + irAmount * 1.5;
        mat.color.g = 0.6 * (1 - irAmount);
        mat.color.b = 0.1 * (1 - irAmount);
      }
    },
  };
}
