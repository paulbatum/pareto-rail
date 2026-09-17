import { AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Points, PointsMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { createBroadside86khRail, TIME } from '../gameplay';
import { batch, box, cruiser, fighter, nebulaGeometry } from './models';

export const PALETTE={friendly:0x718398, friendlyTrim:0xa8becb, cyan:0x57d9f5, enemy:0x171824, enemyTrim:0x3c2636, orange:0xff7834, crimson:0xff2458, gold:0xffd388};
const mat=(color:number)=>new MeshBasicMaterial({color});
const projectileGeo=new SphereGeometry(0.14,6,4);
const projectileMat=mat(0xa3f7ff);
export function createEnemyMesh(kind:string, letter?:string) {
  if(kind==='letter'||letter) {
    const g=new Group();
    const plate=new Mesh(new BoxGeometry(2.1,2.7,0.22),mat(0x13283b));g.add(plate);
    const pieces=glyphOnCells(letter??'A').map(c=>box(0.24,0.24,0.09,(c.x-2)*0.31,(3-c.y)*0.31,0.18));
    g.add(batch(pieces,0xcbf7ff));
    const border=new Mesh(new RingGeometry(1.55,1.59,4),mat(PALETTE.cyan));border.rotation.z=Math.PI/4;border.scale.x=0.83;g.add(border);g.userData.lockRing=border;
    return g;
  }
  if(kind==='shell') {
    const g=new Group();g.add(new Mesh(new SphereGeometry(0.6,6,4),mat(PALETTE.crimson)),new Mesh(new TorusGeometry(1.25,0.1,4,12),mat(PALETTE.orange)));return g;
  }
  return fighter(kind,PALETTE.enemy,kind==='core'?PALETTE.gold:PALETTE.orange);
}
export function setEnemyLocked(mesh:Object3D,locked:boolean) {
  mesh.userData.locked=locked;
  const ring=mesh.userData.lockRing as Mesh|undefined;
  if(ring) {ring.visible=locked; (ring.material as MeshBasicMaterial).color.set(locked?0xbaffff:PALETTE.cyan);}
  mesh.scale.setScalar(locked?1.09:1);
}
export function setEnemyDenied(mesh:Object3D) {
  const ring=mesh.userData.lockRing as Mesh|undefined;
  if(ring) {ring.visible=true;(ring.material as MeshBasicMaterial).color.set(PALETTE.crimson);}
  mesh.scale.setScalar(0.9);
}
export function createProjectileMesh() {const g=new Group();g.add(new Mesh(projectileGeo,projectileMat));const trail=new Mesh(new BoxGeometry(0.055,0.055,1.9),projectileMat);trail.position.z=0.8;g.add(trail);return g;}
export function createReticle() {
  const g=new Group();
  const ring=new Mesh(new RingGeometry(0.44,0.48,32),mat(PALETTE.cyan));g.add(ring);
  for(let i=0;i<6;i++) {const a=i*Math.PI/3;const segment=new Mesh(new BoxGeometry(0.13,0.07,0.03),mat(PALETTE.friendlyTrim));segment.position.set(Math.cos(a)*0.62,Math.sin(a)*0.62,0);segment.rotation.z=a;g.add(segment);}
  return g;
}
export function setReticleActive(reticle:Object3D,active:boolean,count:number) {
  reticle.scale.setScalar(active?1.08:1);
  reticle.children.forEach((o,i)=>{((o as Mesh).material as MeshBasicMaterial).color.set(i>0&&i<=count?0xffffff:active?PALETTE.cyan:0x7399b1);});
}

type Burst={mesh:Mesh; age:number; life:number; size:number; velocity:Vector3};
export function createVisuals(scene:Scene,camera:PerspectiveCamera,bus:EventBus) {
  const root=new Group();scene.add(root);
  camera.far=12000;camera.updateProjectionMatrix();
  const curve=createBroadside86khRail();
  const nebula=new Mesh(nebulaGeometry(),new MeshBasicMaterial({vertexColors:true,side:DoubleSide,depthWrite:false}));nebula.renderOrder=-20;nebula.userData.raildIgnoreOcclusion=true;root.add(nebula);
  const stars:number[]=[];const colors:number[]=[];
  for(let i=0;i<1400;i++) {
    const a=i*2.399963, y=1-2*(i+0.5)/1400, r=Math.sqrt(1-y*y);
    stars.push(Math.cos(a)*r*7900,y*7900,Math.sin(a)*r*7900);const k=0.3+(i%7)/10;colors.push(k,k*0.85,k);
  }
  const starGeo=new BufferGeometry();starGeo.setAttribute('position',new Float32BufferAttribute(stars,3));starGeo.setAttribute('color',new Float32BufferAttribute(colors,3));
  const starfield=new Points(starGeo,new PointsMaterial({size:8,vertexColors:true,sizeAttenuation:true,depthWrite:false}));root.add(starfield);
  const ships:Group[]=[];
  function addShip(t:number,x:number,y:number,length:number,friendly:boolean,angle:number) {
    const ship=cruiser(length,friendly,friendly?PALETTE.friendly:PALETTE.enemy,friendly?PALETTE.friendlyTrim:PALETTE.enemyTrim,friendly?PALETTE.cyan:PALETTE.orange);
    ship.position.copy(offsetFromRail(curve,t/60,new Vector3(x,y,0)));
    ship.rotation.set(angle*0.25,angle,angle*0.4);ship.traverse(o=>{o.name=`Cruiser at ${t}s`;});root.add(ship);ships.push(ship);return ship;
  }
  const home=addShip(0,0,-65,530,true,0);
  home.position.z=180;
  addShip(16,-210,45,1000,true,-0.04);
  addShip(26,125,160,870,false,0.32);
  for(let i=0;i<17;i++) {
    const friendly=i%2===0;
    const x=(friendly?-1:1)*(320+(i%4)*190);
    addShip(5+i*2.9,x,Math.sin(i*2.2)*280,380+(i%5)*105,friendly,Math.sin(i*3.1)*0.75);
  }
  const flagship=addShip(49,0,-100,1050,false,0.04);
  const shield=new Mesh(new SphereGeometry(1,24,12),new MeshBasicMaterial({color:0x653580,wireframe:true,transparent:true,opacity:0.13,depthWrite:false}));shield.scale.set(105,95,650);flagship.add(shield);
  // Parallel armored walls leave the center of the final attack path open.
  const trenchParts:BufferGeometry[]=[]; const conduits:BufferGeometry[]=[];
  for(let i=0;i<38;i++) {
    const u=(47.5+i*0.24)/60;const frame=sampleRailFrame(curve,u);
    for(const side of [-1,1]) {
      const p=offsetFromRail(curve,u,new Vector3(side*43,-13,0));
      const piece=box(17,55,19,0,0,0);const obj=new Object3D();obj.position.copy(p);obj.lookAt(p.clone().add(frame.tangent));obj.updateMatrix();piece.applyMatrix4(obj.matrix);trenchParts.push(piece);
      const stripe=box(0.8,1.2,17,0,0,0);obj.position.copy(offsetFromRail(curve,u,new Vector3(side*34,10,0)));obj.updateMatrix();stripe.applyMatrix4(obj.matrix);conduits.push(stripe);
    }
  }
  root.add(batch(trenchParts,PALETTE.enemyTrim),batch(conduits,PALETTE.orange));
  const beams=new InstancedMesh(new BoxGeometry(0.7,0.7,24),mat(PALETTE.cyan),100);beams.instanceMatrix.setUsage(35048);root.add(beams);
  const dummy=new Object3D();const beamColor=new Color();
  const cockpit=new Group();
  const cockpitParts=[box(0.06,0.05,1.9,-0.65,-0.52,-1.5),box(0.06,0.05,1.9,0.65,-0.52,-1.5),box(0.44,0.1,0.7,0,-0.73,-1.5)];cockpit.add(batch(cockpitParts,0x33495c));
  const bars:BufferGeometry[]=[];for(let i=0;i<6;i++) bars.push(box(0.035,0.012,0.04,(i-2.5)*0.055,-0.67,-1.44));cockpit.add(batch(bars,PALETTE.cyan));
  cockpit.children.forEach(o=>{o.scale.setScalar(0.6);o.position.y=-0.42;});
  root.add(cockpit);
  const bursts:Burst[]=[];
  const burstGeo=new TorusGeometry(1,0.055,4,20);
  for(let i=0;i<90;i++) {
    const mesh=new Mesh(burstGeo,new MeshBasicMaterial({color:PALETTE.orange,transparent:true,opacity:0,depthWrite:false,blending:AdditiveBlending}));mesh.visible=false;root.add(mesh);
    bursts.push({mesh,age:10,life:1,size:1,velocity:new Vector3()});
  }
  let cursor=0, pulse=0, shake=0, victory=false, victoryTime=-1;
  const burst=(p:Vector3,color:number,size:number,life=0.6)=>{
    const b=bursts[cursor++%bursts.length]; b.mesh.position.copy(p);b.mesh.visible=true;b.mesh.quaternion.copy(camera.quaternion);b.age=0;b.life=life;b.size=size;b.velocity.set(0,0,0);(b.mesh.material as MeshBasicMaterial).color.set(color);
  };
  const off=[
    bus.on('spawn',e=>burst(e.worldPosition,PALETTE.crimson,3,0.4)),
    bus.on('lock',e=>burst(e.worldPosition,PALETTE.cyan,2,0.22)),
    bus.on('unlock',e=>burst(e.worldPosition,PALETTE.friendlyTrim,1,0.25)),
    bus.on('fire',e=>{if((e.indexInVolley??0)===0){shake=Math.max(shake,e.volleySize===6?0.32:0.06);pulse=0.8;} }),
    bus.on('hit',e=>burst(e.worldPosition,e.lethal?PALETTE.gold:0xffffff,e.lethal?4:2,0.42)),
    bus.on('kill',e=>{burst(e.worldPosition,PALETTE.orange,6,0.8);for(let i=0;i<4;i++){const p=e.worldPosition.clone().add(new Vector3(Math.sin(i*5)*1.4,Math.cos(i*5)*1.4,0));burst(p,PALETTE.gold,1.5,0.7);bursts[(cursor-1)%bursts.length].velocity.set(Math.sin(i*5)*10,Math.cos(i*5)*10,3);} }),
    bus.on('miss',e=>burst(e.worldPosition,PALETTE.crimson,4,0.5)),
    bus.on('reject',()=>{pulse=-1;shake=0.16;}),
    bus.on('playerhit',()=>{shake=0.6;pulse=-1;}),
    bus.on('beat',()=>{pulse=Math.max(pulse,0.22);}),
    bus.on('bossphase',e=>{if(e.phase==='exposed'){shield.visible=false;shake=0.45;}if(e.phase==='destroyed'){victory=true;shake=0.7;} }),
    bus.on('runstart',()=>{victory=false;victoryTime=-1;shield.visible=true;bursts.forEach(b=>{b.mesh.visible=false;b.age=10;});}),
  ];
  return {
    cameraEffect(dt:number,t:number) {
      shake*=Math.exp(-dt*9);
      camera.position.x+=Math.sin(t*83)*shake;camera.position.y+=Math.cos(t*71)*shake*0.6;
    },
    update(dt:number,t:number,elapsed:number,running:boolean) {
      nebula.position.copy(camera.position);starfield.position.copy(camera.position);
      cockpit.position.copy(camera.position);cockpit.quaternion.copy(camera.quaternion);cockpit.visible=running && t<56.3;
      pulse*=Math.exp(-dt*7);
      for(let i=0;i<100;i++) {
        const ship=ships[i%ships.length];const friendly=ship.userData.friendly as boolean;
        const phase=(elapsed*(friendly?0.49:0.38)+i*0.173)%1;
        const from=ship.position.clone().add(new Vector3(0,10,(i%9-4)*37));
        const to=from.clone().add(new Vector3(friendly?950:-950,Math.sin(i*13)*120,-200));
        dummy.position.copy(from).lerp(to,phase);dummy.lookAt(to);
        dummy.scale.setScalar((t>30&&t<34&&running)?0.1:1);dummy.updateMatrix();beams.setMatrixAt(i,dummy.matrix);
        beamColor.set(friendly?PALETTE.cyan:PALETTE.crimson);beams.setColorAt(i,beamColor);
      }
      beams.instanceMatrix.needsUpdate=true;if(beams.instanceColor)beams.instanceColor.needsUpdate=true;
      for(const b of bursts) if(b.age<b.life) {
        b.age+=dt;b.mesh.visible=b.age<b.life;b.mesh.position.addScaledVector(b.velocity,dt);b.mesh.scale.setScalar(b.size*(0.15+b.age/b.life));(b.mesh.material as MeshBasicMaterial).opacity=(1-b.age/b.life)*0.85;
      }
      if(victory) {
        if(victoryTime<0) victoryTime=t;
        flagship.rotation.z=Math.min(0.2,(t-victoryTime)*0.04);
        if(Math.floor(elapsed*18)!==Math.floor((elapsed-dt)*18)) {
          const p=flagship.position.clone().add(new Vector3(Math.sin(elapsed*17)*55,65+Math.cos(elapsed*11)*30,Math.sin(elapsed*7)*440));burst(p,PALETTE.orange,70,1.5);
          if(t>56) for(let i=1;i<ships.length;i+=4) burst(ships[i].position,PALETTE.gold,45,1);
        }
      } else flagship.rotation.z=0;
      shield.rotation.z=elapsed*0.025;
      // Broadside muzzle flashes march down the friendly cruiser on eighth notes.
      if(running && t>13.1 && t<22.5 && Math.floor(t/(TIME.stepSeconds*2))!==Math.floor((t-dt)/(TIME.stepSeconds*2))) {
        const p=ships[1].position.clone().add(new Vector3(95,32,((Math.floor(t/(TIME.stepSeconds*2))%11)-5)*65));burst(p,PALETTE.cyan,22,0.35);shake=Math.max(shake,0.1);
      }
    },
    dispose(){off.forEach(f=>f());scene.remove(root);root.traverse(o=>{if(o instanceof Mesh||o instanceof Points){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});},
  };
}
