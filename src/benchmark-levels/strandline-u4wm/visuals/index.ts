import { Color, Fog, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import type { EventBus } from '../../../events';
import type { Life } from '../gameplay';
import { buildAnimal, buildWater } from './environment';
import { buildTarget } from './models';

const P = { violet:0xca68ef, flesh:0x48235e, core:0xffc6f7, gold:0xf3dc8c, green:0x82e9ac, dark:0x1b1439 };
export function createVisuals(scene:Scene,camera:PerspectiveCamera,bus:EventBus,life:Life) {
  scene.background=new Color(0x07364d);scene.fog=new Fog(0x07364d,75,390);
  const animal=buildAnimal({tissue:0x54b99b,glow:0x76cda4,gold:0xd1d88a},64);
  const water=buildWater(0xa1d7c8,0x80dccc,650);
  scene.add(animal.root,water);
  const parentEffigy=buildTarget('parent',undefined,P);
  parentEffigy.position.set(0,26,-119);parentEffigy.visible=false;scene.add(parentEffigy);
  const targets=new Map<number,Object3D>(); const pending:Object3D[]=[];
  const fx: {mesh:Mesh< TorusGeometry | SphereGeometry, MeshBasicMaterial>;age:number;life:number;speed:Vector3;expand:number}[]=[];
  let now=0,beat=0;
  const off:(()=>void)[]=[];
  const ringGeo=new TorusGeometry(1,.035,5,40);
  const moteGeo=new SphereGeometry(.10,5,4);
  function ripple(position:Vector3,color:number,size:number,duration=.55) {
    if(fx.length>180)return;
    const m=new Mesh(ringGeo,new MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false}));
    m.position.copy(position);m.quaternion.copy(camera.quaternion);scene.add(m);
    fx.push({mesh:m,age:0,life:duration,speed:new Vector3(),expand:size});
  }
  function burst(position:Vector3,color:number,n:number) {
    for(let i=0;i<n && fx.length<180;i++) {
      const m=new Mesh(moteGeo,new MeshBasicMaterial({color,transparent:true,opacity:1,depthWrite:false}));
      m.position.copy(position);scene.add(m);
      const a=i*2.39996;
      fx.push({mesh:m,age:0,life:.7+(i%3)*.2,speed:new Vector3(Math.cos(a)*3,Math.sin(a)*3,Math.sin(i*7)*2),expand:0});
    }
  }
  off.push(bus.on('spawn',e=>{const m=pending.shift();if(m)targets.set(e.enemyId,m);ripple(e.worldPosition,e.letter?P.green:P.violet,2,.65);}));
  off.push(bus.on('lock',e=>ripple(e.worldPosition,P.gold,2.3,.28)));
  off.push(bus.on('unlock',e=>ripple(e.worldPosition,P.green,1,.24)));
  off.push(bus.on('fire',e=>{if((e.indexInVolley??0)===0)ripple(e.worldPosition,P.gold,e.volleySize>=6?4:1.5,.45);}));
  off.push(bus.on('hit',e=>{ripple(e.worldPosition,P.core,e.lethal?2.8:1.8,.32);burst(e.worldPosition,P.gold,5);}));
  off.push(bus.on('kill',e=>{burst(e.worldPosition,P.green,15);ripple(e.worldPosition,P.green,4,.85);targets.delete(e.enemyId);}));
  off.push(bus.on('miss',e=>{ripple(e.worldPosition,P.violet,1.8,.6);targets.delete(e.enemyId);}));
  off.push(bus.on('beat',e=>{beat=e.isDownbeat?1:.4;}));
  off.push(bus.on('reject',()=>{const pos=new Vector3(0,0,-7).applyQuaternion(camera.quaternion).add(camera.position);ripple(pos,P.violet,2,.3);}));
  off.push(bus.on('bossphase',e=>{if(e.phase==='destroyed') {const pos=new Vector3(0,0,-32).applyQuaternion(camera.quaternion).add(camera.position);burst(pos,P.gold,60);ripple(pos,P.gold,20,2.5);}}));
  off.push(bus.on('runstart',()=>{targets.clear();pending.length=0;clearEffects();}));
  function clearEffects(){for(const e of fx){e.mesh.removeFromParent();e.mesh.material.dispose();}fx.length=0;}
  return {
    factories:{
      createEnemyMesh(kind:string,letter?:string){const m=buildTarget(kind,letter,P);pending.push(m);return m;},
      setEnemyLocked(m:Object3D,locked:boolean){m.userData.locked=locked;(m.userData.lockRing as Object3D).visible=locked;(m.userData.accent as MeshBasicMaterial).color.set(locked?P.gold:m.userData.baseColor);},
      setEnemyDenied(m:Object3D){m.userData.deniedUntil=now+.45;(m.userData.accent as MeshBasicMaterial).color.set(0xff619c);},
      createProjectileMesh(){const g=new Group();const mat=new MeshBasicMaterial({color:new Color(P.gold).multiplyScalar(1.8)});const m=new Mesh(new SphereGeometry(.13,8,6),mat);m.scale.z=4;g.add(m);return g;},
      createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.28,.32,48),new MeshBasicMaterial({color:P.gold,depthTest:false})));for(let i=0;i<6;i++){const m=new Mesh(new SphereGeometry(.055,6,4),new MeshBasicMaterial({color:P.green,depthTest:false}));m.position.set(Math.cos(i*Math.PI/3)*.43,Math.sin(i*Math.PI/3)*.43,0);g.add(m);}return g;},
      setReticleActive(m:Object3D,active:boolean,n:number){m.scale.setScalar(active?1.12:1);m.children.forEach((c,i)=>{if(i>0)(c as Mesh).scale.setScalar(i<=n?1.6:.65);});},
    },
    update(dt:number,time:number){
      now+=dt;beat=Math.max(0,beat-dt*2);animal.update(time,life);water.rotation.y=Math.sin(time*.03)*.025;
      parentEffigy.visible=life.time>=37.5 && life.time<54 && !life.exposed;
      (parentEffigy.userData.webGroups as Group[]).forEach((g,i)=>{g.visible=life.broodKills[i]<3;g.scale.setScalar(1-life.broodKills[i]*.15);});
      if(scene.fog instanceof Fog){scene.fog.near=life.time>54||life.freed?250:75;scene.fog.far=life.time>54||life.freed?850:390;}
      for(const m of targets.values()){
        const a=m.userData.accent as MeshBasicMaterial;
        if(now>(m.userData.deniedUntil??0))a.color.set(m.userData.locked?P.gold:m.userData.baseColor).multiplyScalar(1+beat*.12);
        const tether=m.userData.tether as Object3D|undefined;if(tether)tether.visible=(m.userData.detach??0)<.5;
        const webs=m.userData.webGroups as Group[]|undefined;
        if(webs)webs.forEach((g,i)=>{const strength=(m.userData.web as number[]|undefined)?.[i]??1;g.visible=strength>0;g.scale.setScalar(.75+strength*.25);});
      }
      for(let i=fx.length-1;i>=0;i--){const e=fx[i];e.age+=dt;const t=e.age/e.life;if(t>=1){e.mesh.removeFromParent();e.mesh.material.dispose();fx.splice(i,1);continue;}e.mesh.position.addScaledVector(e.speed,dt);e.mesh.material.opacity=(1-t)*.9;if(e.expand)e.mesh.scale.setScalar(.2+e.expand*t);}
    },
    dispose(){off.forEach(f=>f());clearEffects();targets.clear();pending.length=0;animal.root.removeFromParent();water.removeFromParent();parentEffigy.removeFromParent();const geometries=new Set<{dispose():void}>();const materials=new Set<{dispose():void}>();for(const root of [animal.root,water,parentEffigy])root.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>materials.add(m));}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());ringGeo.dispose();moteGeo.dispose();},
  };
}
