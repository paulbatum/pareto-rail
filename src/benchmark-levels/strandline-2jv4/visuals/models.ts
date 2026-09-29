import { BoxGeometry, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, Shape, ShapeGeometry, SphereGeometry, TubeGeometry, CatmullRomCurve3, TorusGeometry, Vector3 } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
export type Palette = { violet: number; flesh: number; ivory: number; gold: number; green: number; dark: number; water:number; deep:number; surface:number; tissue:number; bellBase:number; bellTip:number; dormant:number; beam:number; dust:number };
const bead = new SphereGeometry(1,12,8);
const plate = new BoxGeometry(1,1,1);
bead.userData.strandlineShared=true;plate.userData.strandlineShared=true;
function orb(g:Group,mat:MeshBasicMaterial,x:number,y:number,z:number,sx:number,sy=sx,sz=sx) {
  const m=new Mesh(bead,mat); m.position.set(x,y,z);m.scale.set(sx,sy,sz);g.add(m);return m;
}
function line(g:Group,mat:MeshBasicMaterial,a:Vector3,b:Vector3,r=.065) {
  const m=new Mesh(new ConeGeometry(r,b.distanceTo(a),5),mat);
  m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());g.add(m);return m;
}
export function makeTarget(kind:string,letter:string|undefined,p:Palette) {
  const g=new Group();
  const shell=new MeshBasicMaterial({color:p.flesh});
  const violet=new MeshBasicMaterial({color:p.violet});
  const core=new MeshBasicMaterial({color:p.ivory});
  const dark=new MeshBasicMaterial({color:p.dark});
  if(kind==='letter') {
    const geo=new SphereGeometry(.13,8,6);
    for(const cell of glyphOnCells(letter??'A')) {
      const m=new Mesh(geo,core);m.position.set((cell.x-2)*.3,(3-cell.y)*.3,.05);g.add(m);
    }
    const rim=new Mesh(new TorusGeometry(1.35,.035,6,48),new MeshBasicMaterial({color:p.green}));g.add(rim);
    for(let i=0;i<8;i++) {const a=i*Math.PI/4;orb(g,shell,Math.cos(a)*1.35,Math.sin(a)*1.35,0,.06);}
  } else if(kind==='clamp') {
    orb(g,dark,0,0,0,.85,.65,.5);orb(g,violet,0,0,.5,.34,.4,.12);
    for(let i=0;i<7;i++) { const a=.25+i*.45;
      const m=orb(g,shell,Math.cos(a)*.84,Math.sin(a)*.84,0,.28,.35,.35);m.rotation.z=a;
    }
    for(const side of [-1,1]) for(let i=0;i<3;i++) {
      const a=new Vector3(side*.6,-.3+i*.38,0), b=new Vector3(side*(1.25+i*.1),-.5+i*.4,.05),c=new Vector3(side*.8,-.95+i*.35,.3);
      line(g,shell,a,b,.13);line(g,violet,b,c,.085);
    }
    orb(g,core,0,.08,.64,.17);
  } else if(kind==='skate') {
    const s=new Shape();s.moveTo(0,1.15);s.lineTo(2.1,-.55);s.lineTo(.7,-.3);s.lineTo(.32,-.85);s.lineTo(0,-.45);s.lineTo(-.32,-.85);s.lineTo(-.7,-.3);s.lineTo(-2.1,-.55);s.closePath();
    const wing=new Mesh(new ShapeGeometry(s),new MeshBasicMaterial({color:p.flesh,side:DoubleSide}));g.add(wing);
    orb(g,dark,0,.1,0,.38,.95,.25);orb(g,violet,0,.25,.3,.23,.6,.13);
    for(const side of [-1,1]) {line(g,violet,new Vector3(0,.8,.1),new Vector3(side*1.8,-.45,.1),.09);orb(g,core,side*.21,.57,.35,.09);}
    line(g,shell,new Vector3(0,-.55,0),new Vector3(0,-2.3,.1),.12);
  } else if(kind==='spore') {
    orb(g,dark,0,0,0,.57);orb(g,violet,0,0,0,.38);
    for(let i=0;i<3;i++) {const r=new Mesh(new TorusGeometry(.86,.06,6,20),shell);r.rotation.set(i*.8,i*1.1,0);g.add(r);}
    for(let i=0;i<10;i++){const a=i*Math.PI*.2;const y=Math.sin(i*2.1)*.45;
      line(g,shell,new Vector3(Math.cos(a)*.55,y,Math.sin(a)*.55),new Vector3(Math.cos(a)*1.25,y*2,Math.sin(a)*1.25),.19);}
    orb(g,core,0,0,.55,.18);
  } else if(kind==='brood') {
    for(let i=0;i<4;i++) orb(g,i%2?shell:violet,0,.65-i*.42,0,.55-i*.07,.31,.3);
    for(const side of [-1,1]) for(let i=0;i<3;i++) line(g,shell,new Vector3(side*.3,.5-i*.45,0),new Vector3(side*(1.05-i*.15),.1-i*.45,.2),.1);
    orb(g,core,0,.7,.35,.17);
  } else {
    orb(g,dark,0,0,0,3.4,4.0,1.4);
    orb(g,violet,0,0,.9,2.3,3.2,.95);
    const grips:Mesh[]=[];g.userData.grips=grips;
    for(let i=0;i<9;i++) {
      const a=i*Math.PI*2/9;
      const m=orb(g,shell,Math.cos(a)*2.9,Math.sin(a)*3.5,.45,.75,1.2,.65);m.rotation.z=a-Math.PI/2;
      grips.push(line(g,shell,new Vector3(Math.cos(a)*3,Math.sin(a)*3.5,.1),new Vector3(Math.cos(a)*5,Math.sin(a)*5,-.8),.5));
    }
    g.userData.parentCore=orb(g,core,0,0,2,1.0,1.5,.25);g.userData.coreMaterial=core;
    const webs=new Group();g.add(webs);g.userData.webs=webs;
    for(let j=0;j<3;j++) {const net=new Group();webs.add(net);
      for(let i=0;i<7;i++) {
        const a=i*Math.PI*2/7+j*.4,b=a+Math.PI*.8;
        line(net,violet,new Vector3(Math.cos(a)*(5-j),Math.sin(a)*(5-j),2.3+j*.25),new Vector3(Math.cos(b)*(5-j),Math.sin(b)*(5-j),2.3+j*.25),.08);
      }
      const ring=new Mesh(new TorusGeometry(5-j,.065,6,56),violet);ring.position.z=2.3+j*.25;net.add(ring);
    }
  }
  if(['clamp','skate','spore'].includes(kind)) {
    const attached=new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(-.25,4,-.5),new Vector3(.05,1,-.6),new Vector3(0,-1,-.55),new Vector3(.35,-4,-.6)]),16,.055,5,false),new MeshBasicMaterial({color:p.green}));
    g.add(attached);g.userData.attachment=attached;
  }
  const halo=new Group();g.add(halo);g.userData.halo=halo;halo.visible=false;
  const lockMat=new MeshBasicMaterial({color:p.gold,depthTest:false});
  const radius=kind==='parent'?5.6:kind==='letter'?1.5:1.65;
  for(let i=0;i<3;i++) {const m=new Mesh(new TorusGeometry(radius,.045,5,24,Math.PI*.42),lockMat);m.rotation.z=i*Math.PI*2/3;halo.add(m);}
  g.userData.lockMat=lockMat;g.userData.radius=radius;
  return g;
}
export function makeProjectile(p:Palette):Object3D {
  const g=new Group();const m=new MeshBasicMaterial({color:p.gold});orb(g,m,0,0,0,.16,.16,.55);
  const tail=new Mesh(plate,new MeshBasicMaterial({color:p.green,transparent:true,opacity:.5,depthWrite:false}));tail.scale.set(.06,.06,1.1);tail.position.z=.7;g.add(tail);return g;
}

export function disposeSharedModels(){bead.dispose();plate.dispose();}
