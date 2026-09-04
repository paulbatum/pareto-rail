import { AdditiveBlending, BackSide, Float32BufferAttribute, HemisphereLight, DirectionalLight, Points, PointsMaterial, SphereGeometry, InstancedMesh, BoxGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Scene, TorusGeometry, Vector3, IcosahedronGeometry, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { fighter, capitalShip, type Palette } from './models';
import type { BattleState } from '../gameplay';
export const PALETTE={ice:0xc4d4e1,cyan:0x78edff,hull:0x14131f,orange:0xff832f,crimson:0xff284c,gold:0xffd391,white:0xf1fbff,steel:0x292e3e,allyRib:0x76899c,enemyRib:0x43303c};
const owned=new Set<Object3D>();
function own<T extends Object3D>(o:T):T {owned.add(o);return o;}
function release(o:Object3D){const geos=new Set<BufferGeometry>();const mats=new Set<import('three').Material>();o.traverse(c=>{if(c instanceof Mesh){geos.add(c.geometry);(Array.isArray(c.material)?c.material:[c.material]).forEach(m=>mats.add(m));}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());owned.delete(o);}
const mat=(color:number)=>new MeshBasicMaterial({color,side:DoubleSide});
export function createEnemyMesh(kind:string,letter?:string) {
  let g:Group;
  if(kind==='letter') {
    g=new Group();
    const plate=new Mesh(new BoxGeometry(1.85,2.45,.18),mat(0x101e30));plate.position.z=-.15;g.add(plate);
    const geo=new BoxGeometry(.22,.22,.12),m=mat(PALETTE.ice);
    for(const c of glyphOnCells(letter??'A')){const b=new Mesh(geo,m);b.position.set((c.x-2)*.29,(3-c.y)*.29,0);g.add(b);}
    for(const s of [-1,1]){const stripe=new Mesh(new BoxGeometry(1.85,.04,.08),mat(PALETTE.cyan));stripe.position.y=s*1.22;g.add(stripe);}
  } else g=fighter(PALETTE,kind);
  const lock=new Group();
  const size=kind==='letter'?1.3:kind==='core'||kind==='generator'?3.3:3.6;
  for(const s of [-1,1])for(const v of [-1,1]) {
    const a=new Mesh(new BoxGeometry(.65,.12,.06),mat(PALETTE.cyan));a.position.set(s*(size-.3),v*size,2.2);lock.add(a);
    const b=new Mesh(new BoxGeometry(.12,.65,.06),mat(PALETTE.cyan));b.position.set(s*size,v*(size-.3),2.2);lock.add(b);
  }
  lock.visible=false;g.add(lock);g.userData.lock=lock;g.userData.baseScale=1;
  return own(g);
}
export function setEnemyLocked(mesh:Object3D,locked:boolean) {const brackets=mesh.userData.lock as Group|undefined;if(brackets){brackets.visible=locked;brackets.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(PALETTE.cyan);});}mesh.userData.locked=locked;}
export function setEnemyDenied(mesh:Object3D) {const brackets=mesh.userData.lock as Group|undefined;if(brackets){brackets.visible=true;brackets.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).color.set(PALETTE.crimson);});}mesh.userData.denied=.4;}
export function createProjectileMesh(){const g=new Group();g.add(new Mesh(new BoxGeometry(.14,.14,2.8),mat(PALETTE.white)));g.add(new Mesh(new BoxGeometry(.28,.28,1.3),mat(PALETTE.cyan)));return own(g);}
export function createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.39,.44,32),mat(PALETTE.white)));for(let i=0;i<6;i++){const m=new Mesh(new BoxGeometry(.08,.17,.01),mat(PALETTE.cyan));const a=i*Math.PI/3;m.position.set(Math.sin(a)*.62,Math.cos(a)*.62,0);m.rotation.z=-a;g.add(m);}return own(g);}
export function setReticleActive(o:Object3D,active:boolean,count:number){o.scale.setScalar(active?1.1:1);o.children.forEach((c,i)=>{if(i>0)(c as Mesh).visible=i<=count||!active;});}
export function createVisuals(bus:EventBus,scene:Scene,state:BattleState) {
  const environment=buildEnvironment(scene,PALETTE,state);
  type Effect={mesh:Mesh<BufferGeometry,MeshBasicMaterial>;age:number;life:number;velocity:Vector3;ring:boolean};
  const effects:Effect[]=[];
  const geo=new IcosahedronGeometry(.45,0),ringGeo=new TorusGeometry(1,.045,4,24);
  let kick=0,beat=0;
  const burst=(p:Vector3,color:number,n:number,life=.6,ring=false)=>{
    for(let i=0;i<n;i++) {
      if(effects.length>=180){const old=effects.shift()!;scene.remove(old.mesh);old.mesh.material.dispose();}
      const m=new Mesh(ring?ringGeo:geo,new MeshBasicMaterial({color:new Color(color).multiplyScalar(1.2),transparent:true,depthWrite:false}));m.position.copy(p);scene.add(m);
      const a=i*2.39996;effects.push({mesh:m,age:0,life,ring,velocity:ring?new Vector3():new Vector3(Math.cos(a)*8,Math.sin(a)*8,Math.sin(i*9)*7)});
    }
  };
  const subscriptions=[
    bus.on('spawn',e=>burst(e.worldPosition,PALETTE.orange,1,.4,true)),
    bus.on('lock',e=>burst(e.worldPosition,PALETTE.cyan,1,.3,true)),
    bus.on('unlock',e=>burst(e.worldPosition,PALETTE.ice,3,.25)),
    bus.on('fire',e=>{burst(e.worldPosition,PALETTE.cyan,2,.2);kick=Math.max(kick,e.volleySize===6?.22:.05);}),
    bus.on('hit',e=>burst(e.worldPosition,PALETTE.white,4,.35)),
    bus.on('kill',e=>{burst(e.worldPosition,PALETTE.orange,12,.8);burst(e.worldPosition,PALETTE.gold,1,.6,true);}),
    bus.on('miss',e=>burst(e.worldPosition,PALETTE.crimson,3,.45)),
    bus.on('reject',()=>{kick=.13;}),bus.on('playerhit',()=>{kick=.3;}),
    bus.on('beat',()=>{beat=1;}),bus.on('runstart',()=>{for(const e of effects){scene.remove(e.mesh);e.mesh.material.dispose();}effects.length=0;}),
  ];
  // Minimal cockpit framing makes the craft's scale visible against the fleet.
  const cockpit=new Group();const lines=[];
  for(const s of [-1,1])lines.push(new Vector3(s*2.7,-1.8,-4),new Vector3(s*1.5,-1.35,-4),new Vector3(s*1.5,-1.35,-4),new Vector3(s*.8,-1.65,-4));
  cockpit.add(new LineSegments(new BufferGeometry().setFromPoints(lines),new LineBasicMaterial({color:PALETTE.cyan,transparent:true,opacity:.45,depthTest:false})));scene.add(cockpit);
  return {
    update(dt:number,elapsed:number,camera:import('three').PerspectiveCamera) {
      for(const o of owned){if(o.parent)o.userData.wasAttached=true;else if(o.userData.wasAttached)release(o);}
      environment.update(elapsed);kick*=Math.exp(-dt*12);beat*=Math.exp(-dt*8);
      cockpit.position.copy(camera.position);cockpit.quaternion.copy(camera.quaternion);cockpit.scale.setScalar(1+kick*.15+beat*.006);
      for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.age+=dt;if(e.age>e.life){scene.remove(e.mesh);e.mesh.material.dispose();effects.splice(i,1);continue;}e.mesh.position.addScaledVector(e.velocity,dt);e.mesh.material.opacity=1-e.age/e.life;if(e.ring){e.mesh.quaternion.copy(camera.quaternion);e.mesh.scale.setScalar(.7+e.age*8);}else e.mesh.rotation.x+=dt*3;}
      scene.traverse(o=>{if(o.userData.denied){o.userData.denied-=dt;if(o.userData.denied<=0)setEnemyLocked(o,!!o.userData.locked);}});
    },
    dispose(){for(const o of owned)release(o);subscriptions.forEach(f=>f());environment.dispose();for(const e of effects){scene.remove(e.mesh);e.mesh.material.dispose();}geo.dispose();ringGeo.dispose();scene.remove(cockpit);cockpit.traverse(o=>{if(o instanceof LineSegments){o.geometry.dispose();o.material.dispose();}});},
  };
}

function buildEnvironment(scene:Scene,p:Palette,state:BattleState) {
  const root=new Group();scene.add(root);
  scene.background=new Color(0x090814);
  const hemi=new HemisphereLight(0xbc94df,0x131a32,2.1);root.add(hemi);
  const sun=new DirectionalLight(0xffc378,3.5);sun.position.set(-800,1000,-2000);root.add(sun);
  const rim=new DirectionalLight(0x79dfff,2.8);rim.position.set(600,180,600);root.add(rim);
  // Vertex-colored nebula: broad luminous gas bands with dark turbulent rifts.
  const skyGeo=new SphereGeometry(16000,100,64);const pos=skyGeo.attributes.position;const colors=[];
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i)/16000,y=pos.getY(i)/16000,z=pos.getZ(i)/16000;
    const cloud=Math.sin(x*14+z*9+Math.sin(y*17)*.8)*.14+Math.sin(x*29-y*13+z*25)*.09+Math.sin(x*63+y*57+z*18)*.03;
    const band=Math.exp(-Math.pow((y-x*.35-.12+cloud)*3.5,2));
    const c=new Color(0x0b091c).lerp(new Color(0x8e225f),band*.72);
    c.lerp(new Color(0xe4a24e),Math.pow(Math.max(0,band-.45)/.55,3)*(.5+.5*Math.sin(x*7+z*4))*.78);
    colors.push(c.r,c.g,c.b);
  }
  skyGeo.setAttribute('color',new Float32BufferAttribute(colors,3));root.add(new Mesh(skyGeo,new MeshBasicMaterial({vertexColors:true,side:BackSide,depthWrite:false})));
  const stars=[];for(let i=0;i<1800;i++){const a=i*2.39996;const y=1-2*(i+.5)/1800;const r=Math.sqrt(1-y*y);stars.push(Math.cos(a)*r*13000,y*13000,Math.sin(a)*r*13000);}
  const starGeo=new BufferGeometry();starGeo.setAttribute('position',new Float32BufferAttribute(stars,3));root.add(new Points(starGeo,new PointsMaterial({color:0xe5d9ff,size:7,sizeAttenuation:true})));
  const ships:Group[]=[];
  const place=(x:number,y:number,z:number,len:number,friendly:boolean,yaw:number,roll:number)=>{const s=capitalShip(p,friendly,len,ships.length);s.position.set(x,y,z);s.rotation.set(0,yaw,roll);s.name=`capital-${ships.length}`;s.children.forEach((c,i)=>c.name=`capital-${ships.length}-part-${i}`);root.add(s);ships.push(s);return s;};
  place(0,-30,320,850,true,0,0);
  place(-135,20,-1070,890,true,0,.04);
  place(-15,95,-1610,740,false,-.05,.06);
  const flagship=place(0,-5,-2550,1100,false,0,0);
  for(let i=0;i<14;i++) {
    const side=i%2===0?-1:1;
    place(side*(340+(i%4)*145),((i*73)%270)-110,-300-i*160,520+(i%3)*190,i%3===0||side<0,Math.sin(i*3)*.65,Math.cos(i*2)*.2);
  }
  // Moving tracer batteries cross the spaces between slow, asymmetric hulls.
  const count=110;
  const bolts=new InstancedMesh(new BoxGeometry(1,1,1),new MeshBasicMaterial({vertexColors:false}),count);
  bolts.instanceMatrix.setUsage(35048);root.add(bolts);
  const dummy=new Object3D();
  for(let i=0;i<count;i++)bolts.setColorAt(i,new Color(i%2===0?p.cyan:p.crimson).multiplyScalar(1.5));
  const shield=new Mesh(new SphereGeometry(1,28,14),new MeshBasicMaterial({color:0xf04b72,transparent:true,opacity:.07,wireframe:true,depthWrite:false,blending:AdditiveBlending}));
  shield.position.copy(flagship.position);shield.scale.set(118,76,630);root.add(shield);
  const blasts:Mesh[]=[];
  for(let i=0;i<12;i++) {const b=new Mesh(new SphereGeometry(1,10,8),new MeshBasicMaterial({color:i%2?p.gold:p.orange,transparent:true,opacity:0,depthWrite:false}));b.position.set(Math.sin(i*8)*70,10+Math.cos(i*4)*25,-2100-i*78);root.add(b);blasts.push(b);}
  const wave=new Mesh(new TorusGeometry(1,.025,6,80),new MeshBasicMaterial({color:p.gold,transparent:true,opacity:0,depthWrite:false}));wave.position.copy(flagship.position);wave.rotation.x=Math.PI/2;root.add(wave);
  const fleetOrigins=ships.map(s=>s.position.clone());
  const muzzle=new InstancedMesh(new SphereGeometry(1,8,6),new MeshBasicMaterial({color:new Color(p.cyan).multiplyScalar(2)}),12);root.add(muzzle);
  let victoryAt=-1;
  return {
    update(elapsed:number) {
      const t=state.time;
      for(let i=0;i<12;i++){
        const beat=t/(60/128);
        const flash=t>=15&&t<22.5?Math.pow(Math.max(0,1-((beat-i*.15)%2+2)%2*4),2):0;
        dummy.position.set(-32,28,-820-i*52);dummy.scale.set(1+flash*7,.1+flash*4,.1+flash*4);dummy.updateMatrix();muzzle.setMatrixAt(i,dummy.matrix);
      }
      muzzle.instanceMatrix.needsUpdate=true;
      if(!state.won)victoryAt=-1;
      if(state.won&&victoryAt<0)victoryAt=t;
      shield.visible=state.shields<3;shield.rotation.z=Math.sin(elapsed*.35)*.02;
      for(let i=0;i<count;i++) {
        const a=(elapsed*(.35+(i%7)*.023)+i*.173)%1;const side=i%2===0?1:-1;
        dummy.position.set(side*(-560+a*1120),-75+(i*71%240),-200-(i*137%2800));
        dummy.rotation.set(0,Math.sin(i)*.3,Math.cos(i*2)*.08);dummy.scale.set(14+(i%4)*8,.35,.35);dummy.updateMatrix();bolts.setMatrixAt(i,dummy.matrix);
      }
      bolts.instanceMatrix.needsUpdate=true;
      if(victoryAt>=0) {
        const age=t-victoryAt;
        for(let i=0;i<blasts.length;i++){const a=Math.max(0,age-i*.17);blasts[i].scale.setScalar(2+a*24);(blasts[i].material as MeshBasicMaterial).opacity=Math.max(0,.85-a*.15);}
        const size=1+age*180;wave.scale.setScalar(size);(wave.material as MeshBasicMaterial).opacity=Math.max(0,.7-age*.1);
        flagship.rotation.z=Math.min(.22,age*.027);flagship.position.y=-5-age*5;
        for(let i=4;i<ships.length;i++)if(i%2){ships[i].rotation.x=age*.025;ships[i].position.x=fleetOrigins[i].x+age*age*(i%3+1);}
      } else {for(let i=4;i<ships.length;i++){ships[i].position.copy(fleetOrigins[i]);ships[i].rotation.x=0;}flagship.rotation.z=0;flagship.position.y=-5;blasts.forEach(b=>(b.material as MeshBasicMaterial).opacity=0);(wave.material as MeshBasicMaterial).opacity=0;}
    },
    dispose(){scene.remove(root);root.traverse(o=>{if(o instanceof Mesh||o instanceof Points){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});},
  };
}
