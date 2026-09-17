import { AmbientLight, BoxGeometry, Color, DirectionalLight, DoubleSide, Fog, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { box, compact, creature, cylinder, makeMaterials, ring, sphere, supply } from './models';

export const PALETTE = { ink: 0x201d2a, brass: 0xd5a343, cream: 0xffedc5, coral: 0xe56f64, teal: 0x4ca9a0, blue: 0x657fc0, wood: 0xbb8750 };
const materials = makeMaterials(PALETTE);
const parts = Array.from({length:8},(_,i)=>supply(i,materials));
const cream = new MeshBasicMaterial({color:PALETTE.cream, side:DoubleSide});
const teal = new MeshBasicMaterial({color:PALETTE.teal, side:DoubleSide});
const coral = new MeshBasicMaterial({color:PALETTE.coral, side:DoubleSide});
const dark = new MeshBasicMaterial({color:PALETTE.ink, side:DoubleSide});
const shadowMaterial = new MeshBasicMaterial({color:0x4c3129, transparent:true, opacity:0.18, depthWrite:false});
const effectsGeometry = new RingGeometry(0.88,1,32);

function text(word: string, color=cream, pixel=0.14) {
  const g=new Group();const geo=new BoxGeometry(pixel*0.8,pixel*0.8,pixel*0.18);
  [...word].forEach((char,i)=> {
    if(char===' ')return;
    for(const cell of glyphOnCells(char)) {const p=new Mesh(geo,color);p.position.set((i*6+cell.x)*pixel,-cell.y*pixel,0);g.add(p);}
  });
  return compact(g);
}
const creatureTemplates = new Map<string,Group>();
export function createEnemyMesh(kind:string, letter?:string) {
  let g:Group;
  if(kind==='letter'||letter) {
    g=new Group();const plate=box(1.78,2.5,0.16,materials.wood);g.add(plate);
    const face=box(1.58,2.3,0.07,materials.cream);face.position.z=0.11;g.add(face);
    const glyph=text(letter??'A',coral,0.27);glyph.position.set(-0.54,0.81,0.18);g.add(glyph);
    for(const x of [-0.68,0.68])for(const y of [-1,1]) {const rivet=sphere(0.07,materials.brass);rivet.position.set(x,y,0.19);g.add(rivet);}
  } else {
    let template=creatureTemplates.get(kind);
    if(!template){template=creature(kind,materials,parts);creatureTemplates.set(kind,template);}
    g=template.clone();
  }
  const targetRing=ring(kind==='spill-core'?1.05:0.84,0.045,teal);targetRing.name='lock-ring';targetRing.position.z=kind==='spill-core'?1:0.85;targetRing.visible=false;g.add(targetRing);
  return g;
}
export function setEnemyLocked(mesh:Object3D,locked:boolean) {
  const r=mesh.getObjectByName('lock-ring') as Mesh|undefined;
  if(r){r.visible=locked;r.material=teal;}
}
export function setEnemyDenied(mesh:Object3D) {
  const r=mesh.getObjectByName('lock-ring') as Mesh|undefined;
  if(r){r.visible=true;r.material=coral;}
  mesh.userData.deniedUntil=(mesh.userData.deniedUntil as number|undefined??0.3);
  deniedMeshes.add(mesh);
}
const deniedMeshes=new Set<Object3D>();
export function createProjectileMesh() {
  const g=new Group();const pin=cylinder(0.065,0.75,cream);pin.rotation.x=Math.PI/2;g.add(pin);
  const head=sphere(0.18,materials.coral);head.position.z=-0.3;g.add(head);return g;
}
export function createReticle() {
  const g=new Group();g.add(ring(0.52,0.03,dark));g.add(ring(0.49,0.016,cream));
  for(let i=0;i<6;i++) {const pip=sphere(0.055,teal);pip.position.set(Math.cos(i*Math.PI/3)*0.61,Math.sin(i*Math.PI/3)*0.61,0);pip.name=`pip-${i}`;g.add(pip);}
  g.scale.setScalar(1.6);
  return g;
}
export function setReticleActive(reticle:Object3D,active:boolean,count:number) {
  for(let i=0;i<6;i++){const p=reticle.getObjectByName(`pip-${i}`) as Mesh;p.material=i<count?coral:cream;p.visible=active||i<count;}
}
export function updateDenied(dt:number) {
  for(const mesh of [...deniedMeshes]) {
    const left=(mesh.userData.deniedUntil as number)-dt;
    if(left<=0){const r=mesh.getObjectByName('lock-ring') as Mesh|undefined;if(r){r.visible=false;r.material=teal;}mesh.userData.deniedUntil=0.3;deniedMeshes.delete(mesh);}
    else mesh.userData.deniedUntil=left;
  }
}

export function createEnvironment(scene:Scene) {
  scene.background=new Color(0x695249);scene.fog=new Fog(0x9b7860,65,165);
  scene.add(new AmbientLight(0xffe4be,1.7));
  const lamp=new DirectionalLight(0xffd296,3.1);lamp.position.set(-25,55,25);scene.add(lamp);
  const fill=new DirectionalLight(0xb8dce5,0.9);fill.position.set(40,20,-40);scene.add(fill);
  const table=box(150,3,210,materials.wood);table.name='table-surface';table.position.set(0,-1.55,0);scene.add(table);
  const scenery=new Group();
  const grainMat=new MeshBasicMaterial({color:0x9a693e});
  const lightGrain=new MeshBasicMaterial({color:0xcb9a63});
  for(let i=0;i<160;i++) {
    const z=-104+i*1.3;
    const scratch=box(35+(i*13%111),0.014,0.018+(i%4)*0.012,i%3?grainMat:lightGrain);
    scratch.position.set(Math.sin(i*7)*14,0.006,z);scratch.rotation.y=Math.sin(i*13)*0.035;scenery.add(scratch);
  }
  // Clutter stays outside the combat lanes. Each cluster uses actual supply meshes.
  for(let i=0;i<125;i++) {
    const p=parts[i%8].clone();const side=i%2?1:-1;
    const z=92-(i%63)*3.05;const x=side*(48+(i*17%20));
    p.position.set(x,0.6,z);p.rotation.set(Math.PI/2,(i%7)*0.3,i*2.4);p.scale.setScalar(1.3+(i%5)*0.9);scenery.add(p);
  }
  // Early notions establish marble scale; later paint jars and rulers establish growth.
  for(let i=0;i<35;i++) {
    const p=parts[i%3===0?6:i%3===1?0:7].clone();
    p.position.set(-43+(i%5)*2,0.16,74-Math.floor(i/5)*5);p.rotation.x=Math.PI/2;p.rotation.z=i;scenery.add(p);
  }
  for(const x of [-59,59]) {const rail=box(1.2,0.7,208,materials.cream);rail.position.set(x,0.35,0);scenery.add(rail);}
  // Lamp, cup, and folded cardboard stay fixed on this one table.
  const stand=cylinder(2.8,0.7,materials.ink);stand.position.set(-48,0.4,-17);scenery.add(stand);
  const arm=box(0.7,28,0.7,materials.brass);arm.position.set(-48,14,-17);arm.rotation.z=-0.2;scenery.add(arm);
  const shade=cylinder(7,6,materials.teal,2.2);shade.position.set(-44,28,-17);scenery.add(shade);
  const bulb=sphere(2,cream);bulb.position.set(-44,25,-17);scenery.add(bulb);
  for(let i=0;i<3;i++) {const card=box(11,0.13,15,materials.cream);card.position.set(40+i*1.2,0.4+i*0.15,61-i);card.rotation.y=i*0.18;scenery.add(card);}
  for(let i=0;i<8;i++) {const p=parts[1].clone();p.scale.setScalar(5);p.position.set(52+Math.sin(i)*2,5,-60+Math.cos(i)*2);p.rotation.z=Math.sin(i)*0.25;scenery.add(p);}
  const cup=cylinder(4,6,materials.coral);cup.position.set(52,3,-60);scenery.add(cup);
  const baked=compact(scenery);baked.children.forEach(c=>c.name='tabletop-scenery');scene.add(baked);
}

type Debris={mesh:Group; velocity:Vector3; age:number; landed:boolean; type:number};
type Pulse={mesh:Mesh; age:number; duration:number; max:number};
export function installVisualEventHandlers(bus:EventBus,scene:Scene,camera:PerspectiveCamera) {
  let running=false,time=0,collected=0,steer=0,beat=0,bossBreaks=0;
  const debris:Debris[]=[];const pulses:Pulse[]=[];
  const enemyKinds=new Map<number,string>();
  const ballRoot=new Group();const rolling=new Group();ballRoot.add(rolling);scene.add(ballRoot);
  const marble=sphere(0.8,materials.teal);marble.name='collector-ball';rolling.add(marble);
  for(let i=0;i<3;i++) {const seam=ring(0.805,0.025,materials.cream);seam.rotation.set(i*0.8,i*1.1,0);rolling.add(seam);}
  const ballShadow=new Mesh(new RingGeometry(0,1,32),shadowMaterial);ballShadow.rotation.x=-Math.PI/2;scene.add(ballShadow);
  const spill=new Group();spill.name='glue-spill';scene.add(spill);
  for(let i=0;i<18;i++) {const blob=sphere(4+(i%4),materials.ink);blob.scale.y=0.045;blob.position.set(Math.cos(i*2.4)*(i%5)*2.5,0.12,Math.sin(i*2.4)*(i%5)*2.5);spill.add(blob);}
  spill.position.set(0,0,-14);
  const orbiting=new Group();spill.add(orbiting);
  for(let i=0;i<14;i++) {const p=parts[i%8].clone();p.scale.setScalar(1.8);p.position.set(Math.cos(i)*9,1,Math.sin(i)*9);orbiting.add(p);}
  const title=text('TINKER BALL',dark,0.32);title.position.set(-40,0.1,84);title.rotation.x=-Math.PI/2;scene.add(title);
  const label=text('RESCUED',cream,0.065);label.position.set(-0.98,-0.98,-3.1);camera.add(label);
  let counter:Group|undefined;
  function updateCounter(){if(counter){camera.remove(counter);counter.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});}counter=text(String(collected).padStart(3,'0'),teal,0.07);counter.position.set(-0.98,-1.1,-3.1);camera.add(counter);}
  updateCounter();
  function pulse(position:Vector3,color:number,max=2,duration=0.45) {
    const mat=new MeshBasicMaterial({color,side:DoubleSide,transparent:true,opacity:1,depthWrite:false});
    const mesh=new Mesh(effectsGeometry,mat);mesh.position.copy(position);mesh.quaternion.copy(camera.quaternion);scene.add(mesh);pulses.push({mesh,age:0,duration,max});
  }
  function scatter(position:Vector3,kind:string,count:number) {
    for(let i=0;i<count;i++) {
      const type=kind==='spill-core'?(i%2?4:5):kind==='peg-bird'?(i%2?3:1):kind==='pencil-strider'?(i%2?4:1):[0,2,6,7][i%4];
      const mesh=parts[type].clone();mesh.position.copy(position);mesh.scale.setScalar(kind==='spill-core'?1.3:0.8);scene.add(mesh);
      mesh.traverse(o=>o.name='rescued-debris');
      const angle=i*2.399+time;
      const outward=new Vector3(Math.cos(angle),Math.sin(angle),0).applyQuaternion(camera.quaternion);
      mesh.position.addScaledVector(outward,kind==='spill-core'?3.1:1.1);
      debris.push({mesh,velocity:new Vector3(outward.x*4,-1, outward.z*4),age:0,landed:false,type});
    }
  }
  const off=[
    bus.on('runstart',()=>{
      running=true;time=0;collected=0;steer=0;bossBreaks=0;enemyKinds.clear();
      debris.forEach(d=>scene.remove(d.mesh));debris.length=0;
      while(rolling.children.length>4)rolling.remove(rolling.children[rolling.children.length-1]);
      spill.scale.setScalar(1);spill.visible=true;updateCounter();
    }),
    bus.on('runend',()=>{running=false;}),
    bus.on('spawn',e=>{enemyKinds.set(e.enemyId,e.kind);if(!e.letter)pulse(e.worldPosition,PALETTE.cream,2,0.6);}),
    bus.on('lock',e=>pulse(e.worldPosition,PALETTE.teal,1.4,0.18)),
    bus.on('unlock',e=>pulse(e.worldPosition,PALETTE.cream,0.9,0.18)),
    bus.on('fire',e=>{pulse(e.worldPosition,e.volleySize===6?PALETTE.coral:PALETTE.brass,e.volleySize===6?1.2:0.4,0.16);}),
    bus.on('hit',e=>{pulse(e.worldPosition,PALETTE.cream,e.lethal?2.4:1.3,0.2);}),
    bus.on('stage',e=>{scatter(e.worldPosition,'spill-core',7);pulse(e.worldPosition,PALETTE.coral,5,0.6);}),
    bus.on('kill',e=>{
      const kind=enemyKinds.get(e.enemyId)??'button-beetle';enemyKinds.delete(e.enemyId);
      if(e.letter)return;
      scatter(e.worldPosition,kind,kind==='spill-core'?12:5);
      pulse(e.worldPosition,PALETTE.brass,kind==='spill-core'?7:3,0.6);
      if(kind==='spill-core'){bossBreaks++;spill.scale.setScalar(Math.max(0.15,1-bossBreaks*0.27));}
    }),
    bus.on('miss',e=>{enemyKinds.delete(e.enemyId);pulse(e.worldPosition,PALETTE.coral,2,0.35);}),
    bus.on('reject',()=>{pulse(ballRoot.position,PALETTE.coral,3,0.4);}),
    bus.on('beat',e=>{beat=e.isDownbeat?1:0.35;}),
  ];
  const forward=new Vector3(),right=new Vector3(),delta=new Vector3();
  return {
    update(dt:number){
      if(running)time+=dt;
      beat*=Math.exp(-dt*9);
      orbiting.rotation.y+=dt*(time>40?1.2:0.12);
      if(time>55&&bossBreaks===3)spill.scale.multiplyScalar(Math.exp(-dt*2));
      ballRoot.visible=running;ballShadow.visible=running;label.visible=running;if(counter)counter.visible=running;
      forward.set(0,0,-1).applyQuaternion(camera.quaternion);forward.y=0;forward.normalize();
      right.set(1,0,0).applyQuaternion(camera.quaternion);right.y=0;right.normalize();
      const radius=0.8+Math.min(2.1,collected*0.009);
      const base=camera.position.clone().addScaledVector(forward,10+camera.position.y*0.8);
      let wanted=Math.sin(time*1.9)*0.35,nearest=Infinity;
      // Choose the next fresh field in front of the ball. Steering is continuous,
      // while the camera stays on the larger authored tabletop route.
      for(const d of debris) {
        delta.copy(d.mesh.position).sub(base);
        const ahead=delta.dot(forward),side=delta.dot(right);
        if(ahead>-3&&ahead<14&&Math.abs(side)<11&&ahead<nearest){nearest=ahead;wanted=Math.max(-8,Math.min(8,side));}
      }
      steer+=(wanted-steer)*(1-Math.exp(-dt*2.5));
      ballRoot.position.copy(base).addScaledVector(right,steer);ballRoot.position.y=radius;
      rolling.scale.setScalar(radius/0.8);rolling.rotateOnWorldAxis(right,dt*(4/radius));
      ballShadow.position.copy(ballRoot.position);ballShadow.position.y=0.02;ballShadow.scale.setScalar(radius*1.35);
      for(let i=debris.length-1;i>=0;i--) {
        const d=debris[i];d.age+=dt;
        if(!d.landed){d.velocity.y-=13*dt;d.mesh.position.addScaledVector(d.velocity,dt);d.mesh.rotation.x+=dt*3;d.mesh.rotation.z+=dt*2;
          if(d.mesh.position.y<0.25){d.mesh.position.y=0.25;d.landed=true;d.mesh.rotation.x=Math.PI/2;}
        }
        delta.copy(d.mesh.position).sub(ballRoot.position);delta.y=0;
        if(running&&d.landed&&delta.length()<radius+1.5) {
          // Keep the same rescued mesh; attach it at the contact point, not a replacement effect.
          scene.remove(d.mesh);rolling.add(d.mesh);
          const a=collected*2.399;const y=1-2*((collected*0.618)%1);const r=Math.sqrt(1-y*y);
          d.mesh.position.set(Math.cos(a)*r,y,Math.sin(a)*r).multiplyScalar(0.83);
          d.mesh.scale.setScalar(d.type===4?0.36:0.28);d.mesh.rotation.set(a,y,a*0.7);d.mesh.traverse(o=>{o.name='collected-supply';});
          collected++;updateCounter();debris.splice(i,1);
          pulse(ballRoot.position,PALETTE.teal,1.5,0.18);
        } else if(d.age>18) {scene.remove(d.mesh);debris.splice(i,1);}
      }
      // Limit attached detail without erasing the uneven silhouette.
      if(rolling.children.length>220) {const p=rolling.children[4];rolling.remove(p);}
      marble.scale.setScalar(1+beat*0.025);
      for(let i=pulses.length-1;i>=0;i--) {const p=pulses[i];p.age+=dt;const u=p.age/p.duration;
        p.mesh.scale.setScalar(0.12+u*p.max);(p.mesh.material as MeshBasicMaterial).opacity=Math.max(0,1-u);
        if(u>=1){scene.remove(p.mesh);(p.mesh.material as MeshBasicMaterial).dispose();pulses.splice(i,1);}
      }
    },
    details:()=>[`${collected} clean supplies collected`, `${bossBreaks}/3 glue shells dismantled`],
    dispose(){off.forEach(f=>f());camera.remove(label);if(counter)camera.remove(counter);},
  };
}
