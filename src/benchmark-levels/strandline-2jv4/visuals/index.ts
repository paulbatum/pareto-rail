import { Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { EventBus } from '../../../events';
import { makeTarget, makeProjectile, type Palette, disposeSharedModels } from './models';
import { makeEnvironment } from './environment';

export const PALETTE:Palette = {violet:0xb04dda,flesh:0x58366c,ivory:0xebe0fc,gold:0xe6ec9a,green:0x83e9a0,dark:0x181d37,water:0x073d59,deep:0x031a39,surface:0x238d98,tissue:0x286e58,bellBase:0x357f60,bellTip:0x91c78a,dormant:0x77a85d,beam:0x8bdec0,dust:0xa3d8bb};
export function createVisuals(scene:Scene,bus:EventBus) {
  const env=makeEnvironment(scene,PALETTE);
  const parentPreview=makeTarget('parent',undefined,PALETTE);parentPreview.position.set(0,78,-40);parentPreview.visible=false;scene.add(parentPreview);
  let broodCleared=0,exposed=false,destroyed=false;const broodIds=new Set<number>();

  const targets=new Map<number,Object3D>();const pending:Object3D[]=[];
  const projectileMeshes=new Map<number,Object3D>(),pendingProjectiles:Object3D[]=[];
  let reticle:Object3D|undefined;
  function free(mesh:Object3D){mesh.traverse(o=>{if(o instanceof Mesh){if(!o.geometry.userData.strandlineShared)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}

  const particles=new InstancedMesh(new SphereGeometry(.13,5,4),new MeshBasicMaterial({vertexColors:false,depthWrite:false}),240);
  particles.instanceColor=null;particles.frustumCulled=false;scene.add(particles);
  const dummy=new Object3D();const black=new Color();
  const particlesState=Array.from({length:240},()=>({position:new Vector3(),velocity:new Vector3(),life:0,max:1,color:new Color()}));let pi=0;
  const rings=Array.from({length:24},()=>{
    const mesh=new Mesh(new RingGeometry(.9,1.0,36),new MeshBasicMaterial({color:PALETTE.gold,transparent:true,opacity:0,depthWrite:false,side:2}));
    mesh.visible=false;scene.add(mesh);return {mesh,life:0,max:1,size:1};});let ri=0;
  function ripple(position:Vector3,color:number,size:number,life=.55) {
    const r=rings[ri++%rings.length];r.mesh.position.copy(position);r.mesh.material.color.set(color);r.mesh.visible=true;r.life=r.max=life;r.size=size;
  }
  function spray(position:Vector3,color:number,count:number,force=5) {
    for(let i=0;i<count;i++){const s=particlesState[pi++%240];s.position.copy(position);s.velocity.set(Math.sin(pi*17.1),Math.cos(pi*3.7),Math.sin(pi*8.3)).normalize().multiplyScalar(force*(.5+(pi%7)/7));s.life=s.max=.7+(pi%5)*.11;s.color.set(color);}
  }
  const off=[
    bus.on('runstart',()=>{targets.forEach(free);targets.clear();projectileMeshes.forEach(free);projectileMeshes.clear();pendingProjectiles.length=0;pending.length=0;broodIds.clear();broodCleared=0;exposed=false;destroyed=false;rings.forEach(r=>r.life=0);particlesState.forEach(p=>p.life=0);}),
    bus.on('spawn',e=>{const mesh=pending.shift();if(mesh)targets.set(e.enemyId,mesh);if(e.kind==='brood')broodIds.add(e.enemyId);if(e.kind!=='letter')ripple(e.worldPosition,PALETTE.violet,1.4,.65);}),
    bus.on('lock',e=>{ripple(e.worldPosition,PALETTE.gold,.65,.3);spray(e.worldPosition,PALETTE.gold,3,1.8);}),
    bus.on('unlock',e=>ripple(e.worldPosition,0x72b6ba,.8,.25)),
    bus.on('fire',e=>{const projectile=pendingProjectiles.shift();if(projectile)projectileMeshes.set(e.projectileId,projectile);ripple(e.worldPosition,PALETTE.gold,e.volleySize===6?1.8:.8,.35);}),
    bus.on('hit',e=>{const projectile=projectileMeshes.get(e.projectileId);if(projectile){free(projectile);projectileMeshes.delete(e.projectileId);}ripple(e.worldPosition,PALETTE.ivory,e.lethal?1.6:1,.35);spray(e.worldPosition,PALETTE.ivory,e.lethal?5:3,4);}),
    bus.on('kill',e=>{if(broodIds.delete(e.enemyId))broodCleared++;const m=targets.get(e.enemyId);const boss=m?.userData.kind==='parent';spray(e.worldPosition,boss?PALETTE.gold:PALETTE.green,boss?50:14,boss?14:6);ripple(e.worldPosition,PALETTE.green,boss?12:2,.95);if(m)free(m);targets.delete(e.enemyId);}),
    bus.on('miss',e=>{const m=targets.get(e.enemyId);if(m)free(m);spray(e.worldPosition,PALETTE.violet,6,3);ripple(e.worldPosition,PALETTE.violet,1,.45);targets.delete(e.enemyId);}),
    bus.on('reject',e=>{for(const id of [...e.enemyIds,...e.missingEnemyIds??[]]) {const m=targets.get(id);if(m)ripple(m.position,PALETTE.violet,2,.4);}}),
    bus.on('beat',()=>env.beat()),
    bus.on('bossphase',e=>{if(e.phase==='exposed')exposed=true;if(e.phase==='destroyed')destroyed=true;if(e.phase==='exposed')ripple(new Vector3(0,78,-40),PALETTE.gold,8,1.2);}),
  ];
  return {
    factories:{
      createEnemyMesh(kind:string,letter?:string){const g=makeTarget(kind,letter,PALETTE);g.userData.kind=kind;pending.push(g);return g;},
      setEnemyLocked(mesh:Object3D,locked:boolean){const halo=mesh.userData.halo as Group;halo.visible=locked;mesh.userData.locked=locked;},
      setEnemyDenied(mesh:Object3D){mesh.userData.denied=.65;(mesh.userData.halo as Group).visible=true;(mesh.userData.lockMat as MeshBasicMaterial).color.set(PALETTE.violet);},
      createProjectileMesh(){const mesh=makeProjectile(PALETTE);pendingProjectiles.push(mesh);return mesh;},
      createReticle(){const g=new Group();const mat=new MeshBasicMaterial({color:PALETTE.gold,depthTest:false});
        g.add(new Mesh(new TorusGeometry(.48,.025,6,36),mat));const dot=new Mesh(new SphereGeometry(.055,6,4),mat);g.add(dot);
        for(let i=0;i<6;i++){const m=new Mesh(new TorusGeometry(.66,.035,5,8,.38),mat);m.rotation.z=i*Math.PI/3;g.add(m);}reticle=g;return g;},
      setReticleActive(g:Object3D,active:boolean,count:number){g.scale.setScalar(active?1.06:1);for(let i=2;i<g.children.length;i++)g.children[i].visible=i-2<count;},
    },
    update(dt:number,time:number,camera:PerspectiveCamera,restored:number,victory:boolean){
      env.update(dt,time,restored,victory,camera.position);
      parentPreview.visible=time>=38.8 && !exposed && !destroyed;
      parentPreview.quaternion.copy(camera.quaternion);
      const previewWebs=parentPreview.userData.webs as Group;
      previewWebs.children.forEach((net,i)=>{const f=Math.max(0,Math.min(1,(1-broodCleared/8)*3-i));net.visible=f>0;net.scale.setScalar(.5+f*.5);});

      for(const m of targets.values()) {
        const halo=m.userData.halo as Group;halo.rotation.z+=dt*.7;
        if(m.userData.denied>0){m.userData.denied-=dt;if(m.userData.denied<=0){(m.userData.lockMat as MeshBasicMaterial).color.set(PALETTE.gold);halo.visible=!!m.userData.locked;}}
        if(m.userData.parentCore){const damage=m.userData.damage??0;
          (m.userData.parentCore as Object3D).scale.set(1+damage*.2,1.5+damage*.35,.25);
          (m.userData.coreMaterial as MeshBasicMaterial).color.set(PALETTE.ivory).lerp(new Color(PALETTE.gold),damage);
          (m.userData.grips as Mesh[]).forEach((grip,i)=>{grip.rotation.z+=Math.sin(time*1.7+i)*dt*.02;grip.scale.y=1-damage*.4;});
        }
        if(m.userData.webs){const webs=m.userData.webs as Group;const fraction=Math.max(0,m.userData.webFraction??1);
          webs.children.forEach((net,i)=>{const f=Math.max(0,Math.min(1,fraction*3-i));net.visible=f>0;net.scale.setScalar(.5+f*.5);net.rotation.z=Math.sin(time*.55)*.04;});}
      }
      for(let i=0;i<particlesState.length;i++){const s=particlesState[i];s.life=Math.max(0,s.life-dt);s.position.addScaledVector(s.velocity,dt);s.velocity.multiplyScalar(Math.exp(-dt*.6));dummy.position.copy(s.position);dummy.scale.setScalar(s.life>0?(s.life/s.max)*1.8:0);dummy.updateMatrix();particles.setMatrixAt(i,dummy.matrix);particles.setColorAt(i,s.life>0?s.color:black);}
      particles.instanceMatrix.needsUpdate=true;if(particles.instanceColor)particles.instanceColor.needsUpdate=true;
      for(const r of rings){r.life-=dt;r.mesh.visible=r.life>0;if(!r.mesh.visible)continue;const f=1-r.life/r.max;r.mesh.quaternion.copy(camera.quaternion);r.mesh.scale.setScalar(r.size*(.4+f*1.8));r.mesh.material.opacity=(1-f)*.65;}
    },
    dispose(){off.forEach(f=>f());env.dispose();scene.remove(parentPreview);free(parentPreview);targets.forEach(free);projectileMeshes.forEach(free);if(reticle)free(reticle);disposeSharedModels();scene.remove(particles);particles.geometry.dispose();(particles.material as MeshBasicMaterial).dispose();rings.forEach(r=>{scene.remove(r.mesh);r.mesh.geometry.dispose();r.mesh.material.dispose();});},
  };
}
