import { AmbientLight, BoxGeometry, Color, DirectionalLight, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene, Vector3, CylinderGeometry, TorusGeometry, RingGeometry } from 'three';
import type { EventBus } from '../../../events';
import { COLORS, facePoint, faceQuaternion, type SolveState } from '../gameplay';
import { box, ink, letterMesh, matte, ring, target } from './models';

export function createVisuals(scene:Scene,bus:EventBus,state:SolveState,camera:PerspectiveCamera) {
  const root=new Group();scene.add(root);
  const ambient=new AmbientLight(0xffffff,.8);root.add(ambient);
  const sun=new DirectionalLight(0xffffff,1.25);sun.position.set(12,20,18);root.add(sun);
  const fill=new DirectionalLight(0xcad7e4,.5);fill.position.set(-12,-8,-14);root.add(fill);
  const machine=new Group();root.add(machine);
  const hub=new Mesh(new BoxGeometry(4,4,4),matte(0xb6c0c7));machine.add(hub);
  for(let axis=0;axis<3;axis++) {
    const axle=new Mesh(new CylinderGeometry(.55,.55,8.6,12),matte(0x74818c));axle.rotation.set(axis===1?Math.PI/2:0,0,axis===2?Math.PI/2:0);machine.add(axle);
    const gyro=ring(3.15+axis*.28,.11,0x98a4ae);gyro.rotation.set(axis*Math.PI/2,axis===2?Math.PI/2:0,0);machine.add(gyro);
    for(let i=0;i<12;i++) {const tooth=box(.3,.5,.45,0xdbe1e5);tooth.position.set(Math.cos(i*Math.PI/6)*3.3,Math.sin(i*Math.PI/6)*3.3,0);tooth.rotation.z=i*Math.PI/6;gyro.add(tooth);}
  }
  const faces=Array.from({length:6},(_,f)=>{
    const g=new Group();g.quaternion.copy(faceQuaternion(f));root.add(g);
    const rows=Array.from({length:3},(_,row)=>{
      const r=new Group();r.position.y=(1-row)*3.2;g.add(r);
      const plates:Mesh[]=[];
      for(let col=0;col<3;col++) {
        const cubie=box(3.04,3.04,.65,0x35414d);cubie.position.set((col-1)*3.2,0,4.46);r.add(cubie);
        const plate=box(2.78,2.78,.16,COLORS[(f+col+row+1)%6]);plate.position.set((col-1)*3.2,0,4.87);r.add(plate);plates.push(plate);
        for(const sign of [-1,1]){const screw=box(.1,.1,.035,0xc6cdd1);screw.position.set((col-1)*3.2+sign*1.22,1.22,4.98);r.add(screw);}
      }
      return {group:r,plates};
    });return {group:g,rows};
  });
  // The arena is deliberately neutral; fine survey rings establish scale without competing with the six colors.
  for(let i=0;i<3;i++){
    const survey=new Mesh(new TorusGeometry(15+i*5,.025,4,120),ink(0xb7c1c9));survey.rotation.x=Math.PI/2;survey.position.y=-9-i*2;root.add(survey);
  }
  for(let i=0;i<48;i++) {const a=i/48*Math.PI*2;const tick=box(.06,.08,i%4===0?1:.4,0xb0bcc5);tick.position.set(Math.cos(a)*20,-11,Math.sin(a)*20);tick.rotation.y=-a;root.add(tick);}
  const shadow=new Mesh(new RingGeometry(.1,7.4,64),new MeshBasicMaterial({color:0xa8b4bf,transparent:true,opacity:.14,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-12;root.add(shadow);

  const capacity=720;
  const confetti=new InstancedMesh(new BoxGeometry(.18,.18,.18),new MeshBasicMaterial({color:0xffffff,depthWrite:false}),capacity);confetti.instanceMatrix.setUsage(35048);confetti.frustumCulled=false;confetti.count=0;root.add(confetti);
  type Particle={p:Vector3;v:Vector3;age:number;life:number;size:number;color:number;spin:number};
  const particles:Particle[]=[];const dummy=new Object3D();let serial=0;
  function burst(p:Vector3,color:number,count:number,speed=4,size=1) {
    for(let i=0;i<count;i++){const n=serial++;const a=n*2.39996,z=((n*73%199)/99.5)-1;const v=new Vector3(Math.cos(a)*Math.sqrt(1-z*z),z,Math.sin(a)*Math.sqrt(1-z*z)).multiplyScalar(speed*(.5+(n%9)/12));particles.push({p:p.clone(),v,age:0,life:1.1+n%7*.15,size,color,spin:n});}
    if(particles.length>capacity)particles.splice(0,particles.length-capacity);
  }
  const pulses:{mesh:Mesh;age:number;life:number}[]=[];
  function pulse(p:Vector3,color:number,size=1) {const m=ring(size,.045,color);(m.material as MeshBasicMaterial).depthWrite=false;m.position.copy(p);m.lookAt(p.clone().add(p.clone().normalize()));root.add(m);pulses.push({mesh:m,age:0,life:.45});}
  const prototypes=new Map<string,Object3D>();
  const shotPrototype=new Group();shotPrototype.add(box(.075,.075,.95,0x20354c));shotPrototype.add(new Mesh(new BoxGeometry(.14,.14,.22),ink(0xffffff)));
  const enemyKinds=new Map<number,string>();let factoryIndex=0;let ended=false;let peelSeen=Array<boolean>(6).fill(false);let coreSeen=false;
  const off=[
    bus.on('runstart',()=>{enemyKinds.clear();peelSeen=Array<boolean>(6).fill(false);coreSeen=false;ended=false;particles.length=0;}),
    bus.on('runend',()=>{ended=true;}),
    bus.on('spawn',e=>{enemyKinds.set(e.enemyId,e.kind);if(!e.letter&&e.kind!=='conductor')pulse(e.worldPosition,0x637a8c,.7);}),
    bus.on('lock',e=>{pulse(e.worldPosition,0x26394e,.8);}),
    bus.on('unlock',e=>{burst(e.worldPosition,0x93a5b2,5,2,.7);}),
    bus.on('fire',e=>{pulse(e.targetPosition,0x26394e,e.volleySize===6?.65:.3);}),
    bus.on('hit',e=>{burst(e.worldPosition,COLORS[Math.floor(state.time/8)%6],e.lethal?12:7,4,.8);pulse(e.worldPosition,0x344d64,.35);}),
    bus.on('kill',e=>{const kind=enemyKinds.get(e.enemyId);if(kind==='weakpoint')burst(e.worldPosition,0xe5ebee,60,6,2);else if(kind!=='tile'&&kind!=='core')burst(e.worldPosition,COLORS[e.enemyId%6],16,5,1.3);enemyKinds.delete(e.enemyId);}),
    bus.on('miss',e=>{burst(e.worldPosition,0x6b7c87,6,1,.6);enemyKinds.delete(e.enemyId);}),
    bus.on('reject',()=>{root.userData.denied=.35;}),
    bus.on('beat',()=>{root.userData.beat=.1;}),
  ];
  return {
    factories:{
      createEnemyMesh(kind:string,letter?:string){const f=factoryIndex++%6;const key=`${kind}:${letter??''}:${f}`;let prototype=prototypes.get(key);if(!prototype){prototype=kind==='letter'||letter?letterMesh(letter??'A',COLORS[f]):target(kind,COLORS[f]);prototypes.set(key,prototype);}return prototype.clone(true);},
      setEnemyLocked(mesh:Object3D,locked:boolean){const l=mesh.getObjectByName('lock');if(l)l.visible=locked;mesh.userData.locked=locked;},
      setEnemyDenied(mesh:Object3D){mesh.userData.denied=.3;mesh.scale.setScalar(.88);const l=mesh.getObjectByName('lock');if(l)l.visible=true;},
      createProjectileMesh(){return shotPrototype.clone(true);},
      createReticle(){const g=new Group();g.add(new Mesh(new RingGeometry(.36,.40,4),ink(0x243b51)));for(let i=0;i<6;i++){const p=box(.08,.08,.03,COLORS[i]);p.position.set(Math.cos(i*Math.PI/3)*.54,Math.sin(i*Math.PI/3)*.54,0);g.add(p);}return g;},
      setReticleActive(reticle:Object3D,active:boolean,count:number){reticle.scale.setScalar(active?1.08:1);reticle.children.forEach((c,i)=>{if(i>0)c.scale.setScalar(i<=count?1.7:.75);});},
    },
    update(dt:number) {
      const t=state.time;
      machine.visible=t<50&&!(state.coreDead&&t>=state.coreBurst);
      machine.rotation.set(t*.08,t*.12,t*.035);
      for(let f=0;f<6;f++) {
        const face=faces[f];face.group.visible=!state.peeled[f]&&t<49;
        face.rows.forEach((row,r)=>{
          const pending=state.pending.find(p=>p.face===f&&p.row===r);
          const winding=pending?Math.max(0,1-(pending.at-t)/.24):0;
          row.group.rotation.y=winding*Math.PI/2;
          row.plates.forEach((plate,c)=>{(plate.material as MeshStandardMaterial).color.setHex(COLORS[state.rows[f][r]?f:(f+c+r+1)%6]);});
        });
        if(state.peeled[f]&&!peelSeen[f]) {peelSeen[f]=true;for(let r=0;r<3;r++)for(let c=0;c<3;c++)burst(facePoint(f,(c-1)*3.2,(1-r)*3.2),COLORS[f],9,4,3.6);}
      }
      if(state.coreDead&&t>=state.coreBurst&&!coreSeen){coreSeen=true;for(let c=0;c<6;c++)burst(new Vector3(),COLORS[c],100,11,1.8);}
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.age+=dt;if(p.age>=p.life){particles.splice(i,1);continue;}p.p.addScaledVector(p.v,dt);p.v.y-=dt*1.8;}
      confetti.count=particles.length;
      particles.forEach((p,i)=>{dummy.position.copy(p.p);dummy.rotation.set(p.age*3+p.spin,p.age*2,p.age*4);const distance=p.p.distanceTo(camera.position);dummy.scale.setScalar(distance<7?0:Math.min(p.size,2)*Math.min(1,(p.life-p.age)*3));dummy.updateMatrix();confetti.setMatrixAt(i,dummy.matrix);confetti.setColorAt(i,new Color(p.color));});
      confetti.instanceMatrix.needsUpdate=true;if(confetti.instanceColor)confetti.instanceColor.needsUpdate=true;
      for(let i=pulses.length-1;i>=0;i--){const p=pulses[i];p.age+=dt;p.mesh.scale.setScalar(1+p.age*3);if(p.age>p.life){root.remove(p.mesh);p.mesh.geometry.dispose();(p.mesh.material as MeshBasicMaterial).dispose();pulses.splice(i,1);}}
      scene.traverse(o=>{if(o.userData.denied>0){o.userData.denied-=dt;if(o!==root)o.scale.setScalar(1-.12*Math.max(0,o.userData.denied/.3));}});
      shadow.scale.setScalar(1+(t>49?-.4:0));
      if(ended)machine.rotation.y+=dt*.2;
    },
    dispose(){off.forEach(f=>f());scene.remove(root);const geometries=new Set<BoxGeometry>();const materials=new Set<MeshBasicMaterial>();root.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());},
  };
}
