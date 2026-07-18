import { BoxGeometry, CylinderGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
const BLUE=0x38bfff,VIOLET=0x9b5cff,WHITE=0xeaf8ff,AMBER=0xffb52e,GUN=0x182534;
const mat=(color:number,wire=false)=>new MeshBasicMaterial({color,wireframe:wire,side:DoubleSide,depthWrite:false,transparent:wire,opacity:wire?.72:1});
export function createEnvironment(scene:Scene){
 scene.background=new Color(0x020611);
 for(let i=0;i<64;i++){const z=-i*11-8;const ring=new Mesh(new TorusGeometry(11+(i%4===0?1:0),.045,6,48),mat(i<40?BLUE:i<112?VIOLET:WHITE));ring.position.z=z;ring.rotation.x=Math.PI/2;scene.add(ring);}
 for(const [x,y] of [[8,8],[-8,8],[8,-8],[-8,-8]]){const rail=new Mesh(new CylinderGeometry(.07,.07,620,6),mat(BLUE));rail.position.set(x,y,-300);rail.rotation.x=Math.PI/2;scene.add(rail);}
 for(let i=0;i<90;i++){const s=new Mesh(new BoxGeometry(.025,.025,MathUtils(i)*2+1),mat(i%3?BLUE:VIOLET));s.position.set(((i*37)%30)-15,((i*19)%18)-9,-i*8-15);scene.add(s);}
}
function MathUtils(i:number){return (i*13%17)/17;}
export function installVisualEventHandlers(bus:EventBus,scene:Scene){bus.on('beat',()=>{scene.traverse(o=>{if(o.userData.ring)o.scale.setScalar(1.04);});});bus.on('kill',({enemyId})=>{const o=scene.getObjectByName(`enemy-${enemyId}`);if(o)o.scale.setScalar(1.5);});}
export function createEnemyMesh(kind:string,letter?:string){if(kind==='letter'||letter)return createLetterMesh(letter??'A');const g=new Group();let core:Mesh;if(kind==='coil'){core=new Mesh(new CylinderGeometry(.65,.65,.22,6),mat(BLUE));core.rotation.x=Math.PI/2;g.add(core,new Mesh(new TorusGeometry(1,.1,6,6),mat(VIOLET,true)));}else if(kind==='threader'){core=new Mesh(new CylinderGeometry(.22,.22,2.6,6),mat(WHITE));core.rotation.z=Math.PI/2;g.add(core,new Mesh(new TorusGeometry(.5,.06,5,18),mat(VIOLET,true)));}else if(kind==='capacitor'){core=new Mesh(new CylinderGeometry(.75,.75,1.5,8),mat(VIOLET));g.add(core,new Mesh(new TorusGeometry(.9,.08,6,8),mat(BLUE,true)));}else if(kind==='arc'){core=new Mesh(new SphereGeometry(.28,8,6),mat(WHITE));g.add(core,new Mesh(new TorusGeometry(.5,.035,5,12),mat(BLUE,true)));}else{core=new Mesh(new BoxGeometry(2.1,.35,.35),mat(AMBER));g.add(core);const b=core.clone();b.rotation.z=Math.PI/2;b.material=mat(AMBER);g.add(b,new Mesh(new SphereGeometry(.35,8,6),mat(WHITE)));}return g;}
export function setEnemyLocked(mesh:Object3D,locked:boolean){mesh.scale.setScalar(locked?1.22:1);mesh.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(locked?WHITE: (o.userData.amber?AMBER:BLUE));});}
export function setEnemyDenied(mesh:Object3D){mesh.scale.setScalar(.7);mesh.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(0xff3344);});}
export function createProjectileMesh(){return new Mesh(new SphereGeometry(.12,8,6),mat(WHITE));}
export function createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.42,.47,32),mat(BLUE)),new Mesh(new SphereGeometry(.06,8,6),mat(WHITE)));for(let i=0;i<6;i++){const s=new Mesh(new BoxGeometry(.08,.32,.03),mat(i===5?WHITE:BLUE));s.rotation.z=i*Math.PI/3;g.add(s);}return g;}
export function setReticleActive(r:Object3D,a:boolean,n:number){r.scale.setScalar(1+n*.06+(a?.1:0));}
function createLetterMesh(ch:string){const g=new Group(),geo=new BoxGeometry(.2,.2,.08);for(const c of glyphOnCells(ch)){const m=new Mesh(geo,mat(BLUE));m.position.set((c.x-2)*.28,(3-c.y)*.28,0);g.add(m);}g.add(new Mesh(new TorusGeometry(1,.035,6,24),mat(BLUE)));return g;}
