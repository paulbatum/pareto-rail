import { BoxGeometry, CatmullRomCurve3, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3, ConeGeometry } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
export type Palette = { violet:number; flesh:number; core:number; gold:number; green:number; dark:number };
const ball = new SphereGeometry(1,16,10);
export function tube(points: Vector3[], radius:number, material:MeshBasicMaterial, segments=18) {
  return new Mesh(new TubeGeometry(new CatmullRomCurve3(points),segments,radius,5,false),material);
}
export function buildTarget(kind:string,letter:string|undefined,p:Palette) {
  const root=new Group();
  const shell=new MeshBasicMaterial({color:p.flesh});
  const accent=new MeshBasicMaterial({color:p.violet});
  const core=new MeshBasicMaterial({color:p.core});
  const black=new MeshBasicMaterial({color:p.dark});
  root.userData.accent=accent;root.userData.baseColor=p.violet;root.userData.kind=kind;
  const addBall=(parent:Group,x:number,y:number,z:number,sx:number,sy:number,sz:number,mat:MeshBasicMaterial)=>{
    const m=new Mesh(ball,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m;
  };
  if(kind==='letter') {
    accent.color.set(p.gold);root.userData.baseColor=p.gold;
    for(const c of glyphOnCells(letter??'A')) {
      const m=new Mesh(new BoxGeometry(.27,.27,.16),accent);m.position.set((c.x-2)*.33,(3-c.y)*.33,0);root.add(m);
    }
    const ring=new Mesh(new TorusGeometry(1.42,.023,5,48),new MeshBasicMaterial({color:p.green}));root.add(ring);
    addBall(root,0,-1.55,0,.10,.10,.10,core);
  } else if(kind==='parent') {
    addBall(root,0,0,-.8,2.6,2.1,1.1,black);
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2;
      const pts=[new Vector3(Math.cos(a)*1.5,Math.sin(a)*1.5,0),new Vector3(Math.cos(a+.3)*3.1,Math.sin(a+.3)*3.1,.4),new Vector3(Math.cos(a)*4.3,Math.sin(a)*4.3,-.6)];
      root.add(tube(pts,.23,shell));
      addBall(root,Math.cos(a)*2,Math.sin(a)*1.6,.3,.45,.5,.4,accent);
    }
    addBall(root,0,0,.8,.95,1.15,.65,core);
    const web:Group[]=[];
    for(let sector=0;sector<3;sector++) {
      const group=new Group();
      for(let j=0;j<7;j++) {
        const a=sector*Math.PI*2/3+j*.11-.35;
        group.add(tube([new Vector3(Math.cos(a)*5.3,Math.sin(a)*5.3,1.8),new Vector3(Math.cos(a+1.1)*2,Math.sin(a+1.1)*2,2.2),new Vector3(Math.cos(a+2)*5.3,Math.sin(a+2)*5.3,1.8)],.065,accent));
      }
      web.push(group);root.add(group);
    }
    root.userData.webGroups=web;
  } else if(kind==='clasp') {
    addBall(root,0,0,0,.7,.95,.45,shell);
    for(let side=-1;side<=1;side+=2) for(let i=0;i<3;i++) {
      const leg=tube([new Vector3(side*.4,.6-i*.6,0),new Vector3(side*1.15,.8-i*.8,.2),new Vector3(side*.85,.15-i*.55,.7)],.10,accent);
      root.add(leg);
    }
    addBall(root,0,.2,.5,.3,.5,.23,core);
    const tether=tube([new Vector3(0,-2,-.6),new Vector3(.3,0,-.65),new Vector3(0,2,-.6)],.06,new MeshBasicMaterial({color:p.green}));root.add(tether);root.userData.tether=tether;
  } else if(kind==='ribbon') {
    addBall(root,0,0,0,.35,.85,.35,shell);
    for(let side=-1;side<=1;side+=2) {
      const wing=new Mesh(new ConeGeometry(.9,2.6,3),accent);wing.rotation.z=side*1.15;wing.position.x=side*.95;wing.scale.z=.24;root.add(wing);
      root.add(tube([new Vector3(side*.2,-.3,0),new Vector3(side*.7,-1.1,.1),new Vector3(side*.3,-2.1,.2)],.075,shell));
    }
    addBall(root,0,.3,.4,.24,.3,.18,core);
  } else {
    addBall(root,0,0,0,.75,.75,.55,shell);
    for(let i=0;i<(kind==='brood'?5:12);i++) {
      const a=i/(kind==='brood'?5:12)*Math.PI*2;
      const needle=new Mesh(new ConeGeometry(.17,.85,5),accent);needle.position.set(Math.cos(a)*.96,Math.sin(a)*.96,0);needle.rotation.z=a-Math.PI/2;root.add(needle);
    }
    root.add(new Mesh(new TorusGeometry(.68,.09,6,32),black));
    addBall(root,0,0,.55,.32,.32,.2,core);
    if(kind==='urchin') { const orbit=new Mesh(new TorusGeometry(1.35,.035,4,40),accent);orbit.rotation.x=.5;root.add(orbit); }
  }
  const lockRing=new Mesh(new TorusGeometry(kind==='parent'?3:1.65,.045,5,48),new MeshBasicMaterial({color:new Color(p.gold).multiplyScalar(1.4),depthTest:false,side:DoubleSide}));
  lockRing.position.z=2.7;lockRing.visible=false;root.add(lockRing);root.userData.lockRing=lockRing;
  return root;
}
