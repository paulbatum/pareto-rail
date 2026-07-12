import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry,
  DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, PlaneGeometry,
  Points, PointsMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { colorForLockCount } from '../../../engine/locks';
import { createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import { createDownpour7snmRail, downpourRunProgress } from '../gameplay';
import { sampleRailFrame } from '../../../engine/rail';

const SLATE = new Color(0x07101d), CYAN = new Color(0x20d9ff), MAGENTA = new Color(0xff278f);
const AMBER = new Color(0xff9b32), WHITE = new Color(0xdbeeff), ACID = new Color(0x8cff18), RED = new Color(0xff2540);
const mat = (c: Color, intensity=1, additive=false) => new MeshBasicMaterial({ color:c.clone().multiplyScalar(intensity), side:DoubleSide, transparent:additive, blending:additive?AdditiveBlending:undefined, depthWrite:!additive });

type Record = { mesh: Group; locked: boolean; baseScale: number };
const records = createPendingVisualRecords<Group, Record>({ createRecord: mesh => ({mesh,locked:false,baseScale:1}) });
const byId = new Map<number, Record>();
let root: Group|null=null, rain: Points|null=null, elapsedNow=0, beat=0, flash=0;
type Burst={mesh:Mesh; age:number; life:number}; const bursts:Burst[]=[];
const burstGeometry = new RingGeometry(.25,.34,20);
const burstMaterials = new Map<number, MeshBasicMaterial>();

export type DownpourVisualContext={ scene:Scene; camera:Camera; elapsed:number; runTime:number; running:boolean };

export function createEnvironment(scene: Scene) {
  if(root){ root.removeFromParent(); disposeObject3D(root); }
  root=new Group(); scene.background=SLATE; const rail=createDownpour7snmRail();
  // Tower slabs, skyways, tube ribs and signage are seated along the authored journey.
  for(let i=0;i<88;i++){
    const u=i/87, frame=sampleRailFrame(rail,u), city=new Group(); city.position.copy(frame.position); city.quaternion.setFromUnitVectors(new Vector3(0,0,-1),frame.tangent);
    const underground=u>.44&&u<.68, canal=u>=.68&&u<.8, ascent=u>=.8;
    const gap=canal?17:underground?10:13; const h=underground?9:38+((i*17)%42);
    for(const side of [-1,1]){ const b=new Mesh(new BoxGeometry(8,h,12+((i*11)%20)),mat(underground?new Color(0x12100d):new Color(0x0a1422))); b.position.set(side*(gap+7),underground?0:-h*.25,0); city.add(b); const sign=new Mesh(new PlaneGeometry(.22,4+ i%5),mat(i%3?CYAN:MAGENTA,1.35,true)); sign.position.set(side*(gap-1.7),2+(i%7),-3); city.add(sign); }
    if(i%4===0){ const beam=new Mesh(new BoxGeometry(gap*2, .28, .35),mat(underground?AMBER:WHITE,.75)); beam.position.y=underground?5:10+(i%3)*4; city.add(beam); }
    if(underground||ascent){ const ring=new Mesh(new TorusGeometry(gap, .13, 4, 16),mat(underground?AMBER:WHITE,.8)); ring.rotation.x=Math.PI/2; city.add(ring); }
    city.traverse(object => { object.raycast = () => undefined; });
    root.add(city);
  }
  const pos=new Float32Array(1500*3); for(let i=0;i<1500;i++){pos[i*3]=(Math.random()-.5)*70;pos[i*3+1]=(Math.random()-.5)*50;pos[i*3+2]=-Math.random()*160;}
  const rg=new BufferGeometry();rg.setAttribute('position',new Float32BufferAttribute(pos,3));rain=new Points(rg,new PointsMaterial({color:WHITE,size:.08,transparent:true,opacity:.6,depthWrite:false,blending:AdditiveBlending}));root.add(rain);
  scene.add(root); return root;
}

export function createEnemyMesh(kind:string,letter?:string){ const g=kind==='letter'?letterMesh(letter??'A'):enemyMesh(kind); g.userData.kind=kind; g.scale.setScalar(.001); records.enqueue(g); return g; }

const enemyTemplates = new Map<string, Group>();
function enemyMesh(kind:string){
  let template=enemyTemplates.get(kind);
  if(!template){template=buildEnemyMesh(kind);enemyTemplates.set(kind,template);}
  return template.clone(true);
}
function buildEnemyMesh(kind:string){ const g=new Group(); const white=mat(WHITE,1.1), glow=mat(kind==='gunship'?ACID:kind==='skimmer'?CYAN:WHITE,1.8,true);
  if(kind==='interceptor'){ const body=new Mesh(new ConeGeometry(.55,2.5,3),white);body.rotation.x=Math.PI/2;g.add(body); for(const s of [-1,1]){const wing=new Mesh(new BoxGeometry(2.2,.08,.65),glow);wing.position.x=s*1.05;g.add(wing);} }
  else if(kind==='crawler'){ const body=new Mesh(new BoxGeometry(1.5,.55,1.1),white);g.add(body);for(const s of [-1,1]){const leg=new Mesh(new BoxGeometry(.14,2,.14),glow);leg.position.x=s*.85;leg.rotation.z=s*.5;g.add(leg);}g.add(new Mesh(new CylinderGeometry(.2,.38,1.7,6),glow)); }
  else if(kind==='skimmer'){g.add(new Mesh(new BoxGeometry(2.8,.3,1.2),white));const fin=new Mesh(new ConeGeometry(.55,1.8,3),glow);fin.rotation.x=Math.PI/2;g.add(fin);for(const s of [-1,1]){const wake=new Mesh(new PlaneGeometry(.08,3),mat(CYAN,.8,true));wake.position.set(s*.9,-.2,1.8);g.add(wake);} }
  else if(kind==='sentinel'){g.add(new Mesh(new OctahedronGeometry(1.15),white));g.add(new Mesh(new TorusGeometry(1.55,.12,5,8),glow));const gun=new Mesh(new BoxGeometry(.28,.28,2.4),glow);gun.position.z=.7;g.add(gun);}
  else { const hull=new Mesh(new BoxGeometry(8,2.2,3.5),mat(new Color(.12,.16,.15)));g.add(hull);for(const s of [-1,1]){const wing=new Mesh(new BoxGeometry(6,.18,2.8),glow);wing.position.x=s*5;g.add(wing);}g.add(new Mesh(new IcosahedronGeometry(.7,1),glow)); }
  return g;
}

function letterMesh(ch:string){const g=new Group(), geo=new BoxGeometry(.22,.22,.09), m=mat(CYAN,1.25);for(const c of glyphOnCells(ch)){const p=new Mesh(geo,m);p.position.set((c.x-2)*.29,(3-c.y)*.29,0);g.add(p);}g.add(new Mesh(new RingGeometry(.95,1.01,4),mat(MAGENTA,1.15)));return g;}
export function setEnemyLocked(mesh:Object3D,locked:boolean){const r=[...byId.values()].find(x=>x.mesh===mesh);if(r)r.locked=locked;mesh.traverse(o=>{if(o instanceof Mesh){const m=o.material as MeshBasicMaterial;if(locked)m.color.lerp(CYAN,.55);}});}
export function setEnemyDenied(mesh:Object3D){mesh.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.copy(RED);});mesh.scale.multiplyScalar(.78);}
const projectileGeometry = new OctahedronGeometry(.19);
const projectileMaterial = mat(CYAN,2.4,true);
export function createProjectileMesh(){return new Mesh(projectileGeometry,projectileMaterial);}
export function createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.48,.54,24),mat(CYAN,1.4)));for(let i=0;i<4;i++){const t=new Mesh(new PlaneGeometry(.32,.045),mat(WHITE,1.4));t.position.x=.72;t.rotation.z=i*Math.PI/2;g.add(t);}return g;}
export function setReticleActive(reticle:Object3D,active:boolean,count:number){reticle.scale.setScalar(1+(active?.08:0)+count*.035);reticle.rotation.z=elapsedNow*.35;reticle.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.copy(colorForLockCount(count));});}

function pulse(scene:Scene,p:Vector3,c:Color,life=.6){const key=c.getHex();let material=burstMaterials.get(key);if(!material){material=mat(c,1.7,true);burstMaterials.set(key,material);}const m=new Mesh(burstGeometry,material.clone());m.position.copy(p);scene.add(m);bursts.push({mesh:m,age:0,life});}
export function installVisualEventHandlers(bus:EventBus,scene:Scene){
  bus.on('spawn',({enemyId})=>{const r=records.claim(enemyId);if(r)byId.set(enemyId,r);});
  bus.on('lock',({worldPosition,lockCount})=>pulse(scene,worldPosition,colorForLockCount(lockCount),.35));
  bus.on('unlock',({worldPosition})=>pulse(scene,worldPosition,MAGENTA,.25));
  bus.on('fire',({worldPosition,volleySize})=>{pulse(scene,worldPosition,volleySize===6?WHITE:CYAN,.45);flash=Math.max(flash,volleySize===6?.8:.25);});
  bus.on('hit',({worldPosition,stageCompleted})=>pulse(scene,worldPosition,stageCompleted?AMBER:WHITE,.42));
  bus.on('stage',({worldPosition})=>{pulse(scene,worldPosition,ACID,.8);flash=.65;});
  bus.on('kill',({enemyId,worldPosition})=>{byId.delete(enemyId);pulse(scene,worldPosition,MAGENTA,.9);});
  bus.on('miss',({enemyId,worldPosition})=>{byId.delete(enemyId);pulse(scene,worldPosition,RED,.4);});
  bus.on('reject',({enemyIds,missingEnemyIds})=>{for(const id of [...enemyIds,...(missingEnemyIds??[])]){const r=byId.get(id);if(r)setEnemyDenied(r.mesh);}flash=.35;});
  bus.on('beat',({isDownbeat})=>{beat=isDownbeat?1:.45;}); bus.on('playerhit',()=>{flash=1;});
  bus.on('runstart',()=>{byId.clear();bursts.splice(0);});
}

export function updateVisuals(dt:number,{camera,elapsed,runTime,running}:DownpourVisualContext){elapsedNow=elapsed;beat=Math.max(0,beat-dt*3);flash=Math.max(0,flash-dt*2.5);
  if(root&&rain){rain.position.copy(camera.position);rain.position.y+=((elapsed*34)%8)-4;rain.rotation.z=-.11;root.traverse(o=>{if(o instanceof Mesh&&o.geometry.type==='PlaneGeometry')o.scale.y=1+beat*.18;});}
  for(const r of byId.values()){r.mesh.scale.lerp(new Vector3(1,1,1).multiplyScalar(r.locked?1.12:1),Math.min(1,dt*10));if(r.mesh.userData.kind==='gunship')r.mesh.children.at(-1)?.scale.setScalar(1+beat*.35);}
  for(let i=bursts.length-1;i>=0;i--){const b=bursts[i];b.age+=dt;b.mesh.quaternion.copy(camera.quaternion);const p=b.age/b.life;b.mesh.scale.setScalar(.3+p*5);(b.mesh.material as MeshBasicMaterial).opacity=1-p;if(p>=1){b.mesh.removeFromParent();(b.mesh.material as MeshBasicMaterial).dispose();bursts.splice(i,1);}}
  if(running&&runTime>0&&root){const u=downpourRunProgress(runTime,60);const frame=sampleRailFrame(createDownpour7snmRail(),Math.min(1,u)); void frame;}
}
