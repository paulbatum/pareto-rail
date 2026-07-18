import { BoxGeometry, CylinderGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
const BLUE=0x38bfff,VIOLET=0x9b5cff,WHITE=0xeaf8ff,AMBER=0xffb52e,GUN=0x182534;
const mat=(color:number,wire=false)=>new MeshBasicMaterial({color,wireframe:wire,side:DoubleSide,depthWrite:false,transparent:wire,opacity:wire?.72:1});
export function createEnvironment(scene:Scene){
 scene.background=new Color(0x020611);
 for(let i=0;i<128;i++){const z=-i*5.5-8;const ring=new Mesh(new TorusGeometry(11+(i%4===0?1.2:0),i%4===0?.065:.035,6,48),mat(i<48?BLUE:i<96?VIOLET:WHITE));ring.position.z=z;ring.rotation.x=Math.PI/2;ring.userData.ring=true;scene.add(ring);}
 const charge=new Mesh(new SphereGeometry(4,24,12),new MeshBasicMaterial({color:0x8f6cff,transparent:true,opacity:.08,depthWrite:false}));charge.position.z=-620;scene.add(charge);const beacon=new Mesh(new SphereGeometry(.5,12,8),mat(WHITE));beacon.position.set(0,3,-680);scene.add(beacon);
 for(const [x,y] of [[8,8],[-8,8],[8,-8],[-8,-8]]){const rail=new Mesh(new CylinderGeometry(.07,.07,620,6),mat(BLUE));rail.position.set(x,y,-300);rail.rotation.x=Math.PI/2;scene.add(rail);}
 for(let i=0;i<32;i++){const rib=new Mesh(new BoxGeometry(.16,3.5,1.8),mat(GUN));rib.position.set(Math.cos(i*1.91)*10.8,Math.sin(i*1.91)*10.8,-i*18-20);rib.lookAt(0,0,rib.position.z-1);scene.add(rib);}
 for(let i=0;i<90;i++){const s=new Mesh(new BoxGeometry(.025,.025,MathUtils(i)*2+1),mat(i%3?BLUE:VIOLET));s.position.set(((i*37)%30)-15,((i*19)%18)-9,-i*8-15);scene.add(s);}
}
function MathUtils(i:number){return (i*13%17)/17;}
export function installVisualEventHandlers(bus:EventBus,scene:Scene){
 bus.on('beat',()=>{scene.traverse(o=>{if(o.userData.ring)o.scale.setScalar(1.04);});});
 const burst=(position:Vector3,color:number,size:number)=>{const fx=new Mesh(new TorusGeometry(size,.035,5,20),mat(color,true));fx.position.copy(position);fx.lookAt(0,0,0);scene.add(fx);setTimeout(()=>scene.remove(fx),180);};
 bus.on('hit',({worldPosition,lethal})=>burst(worldPosition,lethal?WHITE:VIOLET,lethal?.75:.45));
 bus.on('stage',({worldPosition})=>burst(worldPosition,AMBER,1.05));
 bus.on('kill',({worldPosition})=>burst(worldPosition,WHITE,1.2));
}
export function createEnemyMesh(kind:string,letter?:string){if(kind==='letter'||letter)return createLetterMesh(letter??'A');const g=new Group();let core:Mesh;if(kind==='coil'){core=new Mesh(new CylinderGeometry(.65,.65,.22,6),mat(BLUE));core.rotation.x=Math.PI/2;g.add(core,new Mesh(new TorusGeometry(1,.1,6,6),mat(VIOLET,true)));}else if(kind==='threader'){core=new Mesh(new CylinderGeometry(.22,.22,2.6,6),mat(WHITE));core.rotation.z=Math.PI/2;g.add(core,new Mesh(new TorusGeometry(.5,.06,5,18),mat(VIOLET,true)));}else if(kind==='capacitor'){core=new Mesh(new CylinderGeometry(.75,.75,1.5,8),mat(VIOLET));g.add(core,new Mesh(new TorusGeometry(.9,.08,6,8),mat(BLUE,true)));for(let i=0;i<6;i++){const stave=new Mesh(new BoxGeometry(.12,.12,1.9),mat(GUN));stave.position.set(Math.cos(i*Math.PI/3)*.82,Math.sin(i*Math.PI/3)*.82,0);stave.rotation.z=i*Math.PI/3;g.add(stave);}}else if(kind==='arc'){core=new Mesh(new SphereGeometry(.28,8,6),mat(WHITE));g.add(core,new Mesh(new TorusGeometry(.5,.035,5,12),mat(BLUE,true)));}else{core=new Mesh(new BoxGeometry(2.1,.35,.35),mat(AMBER));g.add(core);const b=core.clone();b.rotation.z=Math.PI/2;b.material=mat(AMBER);g.add(b,new Mesh(new SphereGeometry(.35,8,6),mat(WHITE)));for(let i=0;i<4;i++){const stripe=new Mesh(new BoxGeometry(.16,.48,.42),mat(0x10151c));stripe.position.set(-.72+i*.48,0,.22);stripe.rotation.z=Math.PI/4;g.add(stripe);}}if(kind==='interlock')g.scale.setScalar(2.1);else if(kind==='capacitor')g.scale.setScalar(1.2);else if(kind==='threader')g.scale.setScalar(1.1);return g;}
export function setEnemyLocked(mesh:Object3D,locked:boolean){mesh.scale.setScalar(locked?1.22:1);mesh.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(locked?WHITE: (o.userData.amber?AMBER:BLUE));});}
export function setEnemyDenied(mesh:Object3D){mesh.scale.setScalar(.7);mesh.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(0xff3344);});}
export function createProjectileMesh(){return new Mesh(new SphereGeometry(.12,8,6),mat(WHITE));}
export function createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.42,.47,32),mat(BLUE)),new Mesh(new SphereGeometry(.06,8,6),mat(WHITE)));for(let i=0;i<6;i++){const s=new Mesh(new BoxGeometry(.08,.32,.03),mat(i===5?WHITE:BLUE));s.rotation.z=i*Math.PI/3;g.add(s);}return g;}
export function setReticleActive(r:Object3D,a:boolean,n:number){r.scale.setScalar(1+n*.06+(a?.1:0));}
function createLetterMesh(ch:string){const g=new Group(),geo=new BoxGeometry(.2,.2,.08);for(const c of glyphOnCells(ch)){const m=new Mesh(geo,mat(BLUE));m.position.set((c.x-2)*.28,(3-c.y)*.28,0);g.add(m);}g.add(new Mesh(new TorusGeometry(1,.035,6,24),mat(BLUE)));return g;}
