import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Palette = { ink: number; brass: number; cream: number; coral: number; teal: number; blue: number; wood: number };
export type Materials = ReturnType<typeof makeMaterials>;
export function makeMaterials(p: Palette) {
  return {
    ink: new MeshStandardMaterial({ color: p.ink, roughness: 0.27, metalness: 0.15 }),
    brass: new MeshStandardMaterial({ color: p.brass, roughness: 0.35, metalness: 0.45 }),
    cream: new MeshStandardMaterial({ color: p.cream, roughness: 0.85 }),
    coral: new MeshStandardMaterial({ color: p.coral, roughness: 0.65 }),
    teal: new MeshStandardMaterial({ color: p.teal, roughness: 0.6 }),
    blue: new MeshStandardMaterial({ color: p.blue, roughness: 0.45 }),
    wood: new MeshStandardMaterial({ color: p.wood, roughness: 0.8 }),
  };
}
export function box(x: number, y: number, z: number, mat: Material) { return new Mesh(new BoxGeometry(x,y,z), mat); }
export function sphere(r: number, mat: Material) { return new Mesh(new SphereGeometry(r, 12, 8), mat); }
export function cylinder(r: number, h: number, mat: Material, top = r) { return new Mesh(new CylinderGeometry(top,r,h,12),mat); }
export function ring(r: number, tube: number, mat: Material) { return new Mesh(new TorusGeometry(r,tube,5,24),mat); }

// Bake component transforms, keeping one draw call per material for each prop.
export function compact(root: Object3D) {
  root.updateMatrixWorld(true);
  const batches = new Map<Material, ReturnType<BoxGeometry['clone']>[]>();
  root.traverse((o) => {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const list = batches.get(o.material) ?? [];
    list.push(g); batches.set(o.material,list);
  });
  const result = new Group();
  for (const [material, geometries] of batches) {
    const g = mergeGeometries(geometries);
    if (g) result.add(new Mesh(g,material));
    geometries.forEach(geo => geo.dispose());
  }
  return result;
}

export function supply(type: number, m: Materials): Group {
  const g = new Group();
  switch (type % 8) {
    case 0: { // Button with four dark sewing holes and a raised rim.
      const disk = cylinder(0.48,0.12,m.coral); disk.rotation.x = Math.PI/2; g.add(disk);
      g.add(ring(0.4,0.025,m.cream));
      for (const x of [-0.13,0.13]) for (const y of [-0.13,0.13]) {
        const hole = sphere(0.065,m.ink); hole.scale.z = 0.25; hole.position.set(x,y,0.08); g.add(hole);
      }
      break;
    }
    case 1: { // Pencil, sharpened tip and ferrule.
      const shaft = cylinder(0.1,1.7,m.teal); g.add(shaft);
      const tip = cylinder(0.1,0.38,m.wood,0); tip.position.y = 1.04; g.add(tip);
      const lead = cylinder(0.03,0.14,m.ink,0); lead.position.y = 1.25; g.add(lead);
      const ferrule = cylinder(0.115,0.19,m.brass); ferrule.position.y = -0.82; g.add(ferrule);
      const eraser = cylinder(0.11,0.2,m.coral); eraser.position.y = -1.01; g.add(eraser);
      break;
    }
    case 2: { // Wound thread spool.
      g.add(cylinder(0.29,0.65,m.teal));
      for (const y of [-0.37,0.37]) { const end = cylinder(0.44,0.1,m.wood); end.position.y=y; g.add(end); }
      for (let i=0;i<6;i++) { const thread=ring(0.294,0.025,m.cream); thread.rotation.x=Math.PI/2; thread.position.y=(i-2.5)*0.09; g.add(thread); }
      break;
    }
    case 3: { // Folded cardboard / clothespin.
      for (const s of [-1,1]) { const jaw=box(0.25,1.4,0.25,m.wood); jaw.position.x=s*0.17; jaw.rotation.z=s*0.08; g.add(jaw); }
      const spring=ring(0.18,0.055,m.brass); spring.rotation.y=Math.PI/2; g.add(spring); break;
    }
    case 4: { // Numberless ruler, etched ticks.
      g.add(box(0.42,2.9,0.12,m.wood));
      for (let i=0;i<12;i++) { const tick=box(i%3===0?0.27:0.13,0.025,0.025,m.ink); tick.position.set(-0.05,-1.28+i*0.23,0.072);g.add(tick); }
      break;
    }
    case 5: { // Opaque glass paint jar and lid.
      g.add(cylinder(0.38,0.85,m.blue));
      const label= cylinder(0.385,0.32,m.cream);g.add(label);
      const lid=cylinder(0.42,0.14,m.brass);lid.position.y=0.47;g.add(lid);break;
    }
    case 6: { // Paperclip bent from two nested narrow loops.
      for(let i=0;i<2;i++) {const clip=ring(0.3-i*0.075,0.035,m.brass);clip.scale.y=2.3;clip.position.y=i*0.12;g.add(clip);}break;
    }
    default: {
      const bead=sphere(0.36,m.teal);g.add(bead);
      const hole=sphere(0.11,m.ink);hole.position.z=0.32;hole.scale.z=0.3;g.add(hole);break;
    }
  }
  return compact(g);
}

export function creature(kind: string, m: Materials, parts: Group[]) {
  const root = new Group();
  const shell = new Group();shell.name='shell';root.add(shell);
  const core = sphere(kind==='spill-core'?0.9:0.66,m.ink); core.name='core';root.add(core);
  // Cream eyes and adhesive drips make the dark core identifiable without bloom.
  for(const x of [-0.23,0.23]) {
    const eye=sphere(0.12,m.cream);eye.position.set(x,0.13,0.61);root.add(eye);
    const pupil=sphere(0.055,m.ink);pupil.position.set(x,0.12,0.72);root.add(pupil);
  }
  for(let i=0;i<4;i++) {const drip=sphere(0.16,m.ink);drip.position.set((i-1.5)*0.25,-0.56,0.05);drip.scale.y=1.8;root.add(drip);}
  function part(type:number,x:number,y:number,z:number,angle:number,scale=1,parent=shell) {
    const p=parts[type].clone();p.position.set(x,y,z);p.rotation.z=angle;p.scale.setScalar(scale);parent.add(p);return p;
  }
  if(kind==='button-beetle') {
    part(0,-0.65,0,0,0,1.5);part(2,0.65,0,0,Math.PI/2,1.05);
    const legs=new Group();legs.name='legs';shell.add(legs);
    for(const s of [-1,1]) for(let i=0;i<3;i++) part(6,s*0.8,(i-1)*0.48,-0.18,s*0.9,0.55,legs);
    for(const s of [-1,1]) part(1,s*0.4,0.85,-0.2,s*0.5,0.4);
  } else if(kind==='pencil-strider') {
    const legs=new Group();legs.name='legs';shell.add(legs);
    for(const s of [-1,1]) {part(1,s*0.82,-0.6,-0.1,s*-0.5,1.1,legs);part(4,s*0.85,0.55,-0.25,s*0.65,0.7);}
    part(7,0,0.9,0,0,0.7);
  } else if(kind==='peg-bird') {
    for(const s of [-1,1]) {
      const wing=new Group();wing.name=s<0?'wing-left':'wing-right';wing.position.x=s*0.45;shell.add(wing);
      part(3,s*0.65,0,-0.2,s*1.15,1.3,wing);
      const cardboard=box(1.35,0.7,0.08,m.cream);cardboard.position.set(s*0.65,0.05,-0.35);cardboard.rotation.z=s*0.3;wing.add(cardboard);
    }
    part(1,0,-0.8,-0.3,0,0.55);
    const beak=cylinder(0.22,0.55,m.brass,0);beak.rotation.x=Math.PI/2;beak.position.z=0.78;root.add(beak);
  } else {
    for(let i=0;i<10;i++) {const a=i*Math.PI/5;part(i%2?4:5,Math.cos(a)*1.25,Math.sin(a)*1.25,-0.25,a,0.7);}
    for(let i=0;i<6;i++) {const a=i*Math.PI/3;const blob=sphere(0.35,m.ink);blob.position.set(Math.cos(a),Math.sin(a),-0.15);shell.add(blob);}
    const halo=ring(1.85,0.08,m.brass);halo.position.z=-0.5;shell.add(halo);
  }
  return root;
}
