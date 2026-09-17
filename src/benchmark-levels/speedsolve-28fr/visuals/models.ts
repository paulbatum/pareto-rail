import { BoxGeometry, CylinderGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, RingGeometry, TetrahedronGeometry, TorusGeometry, DoubleSide } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
export const matte=(color:number)=>new MeshStandardMaterial({color,roughness:.38,metalness:.16});
export const ink=(color:number)=>new MeshBasicMaterial({color,side:DoubleSide});
export function box(x:number,y:number,z:number,color:number){return new Mesh(new BoxGeometry(x,y,z),matte(color));}
export function outlined(mesh:Mesh,color:number){mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry),new LineBasicMaterial({color})));return mesh;}
export function ring(radius:number,width:number,color:number){return new Mesh(new TorusGeometry(radius,width,6,48),ink(color));}
export function target(kind:string,color:number) {
  const g=new Group();
  if(kind==='tile') {
    g.add(box(2.72,2.72,.22,0x263443));
    const plate=box(2.48,2.48,.23,color);plate.position.z=.16;plate.name='body';g.add(plate);
    for(const x of [-1,1])for(const y of [-1,1]) {const b=box(.46,.16,.12,0xffffff);b.position.set(x*1.08,y*1.07,.34);g.add(b);const v=box(.16,.46,.12,0xffffff);v.position.copy(b.position);g.add(v);}
    g.add(ring(.38,.055,0x25313f));
  } else if(kind==='weakpoint'||kind==='core') {
    const r=kind==='core'?2.3:.9;
    g.add(outlined(new Mesh(new OctahedronGeometry(r),matte(0xe9eef0)),0x354452));
    for(let i=0;i<3;i++){const t=ring(r*1.18,.09,0x5e6c7a);t.rotation.set(i*Math.PI/2,(i===2?Math.PI/2:0),0);g.add(t);}
    for(let i=0;i<6;i++){const p=box(.2,.2,r*1.8,color);p.rotation.y=i*Math.PI/3;g.add(p);}
  } else if(kind==='conductor') return g;
  else {
    const geo=kind==='tetra'?new TetrahedronGeometry(.84):kind==='octa'?new OctahedronGeometry(.87):kind==='bolt'?new OctahedronGeometry(.32):new CylinderGeometry(.55,.55,1.7,3);
    const body=outlined(new Mesh(geo,matte(color)),0x2c3946);body.name='body';g.add(body);
    if(kind!=='bolt') {const cage=ring(.95,.035,0x364451);cage.rotation.x=Math.PI/2;g.add(cage);const eye=new Mesh(new OctahedronGeometry(.2),ink(0xffffff));eye.position.z=.7;g.add(eye);}
    else {const r=new Mesh(new RingGeometry(.4,.5,4),ink(color));g.add(r);}
  }
  const halo=new Mesh(new RingGeometry(kind==='tile'?1.65:1.05,kind==='tile'?1.78:1.15,4),ink(0x27394d));halo.name='lock';halo.visible=false;halo.position.z=kind==='tile'?.36:1;g.add(halo);
  return g;
}
export function letterMesh(char:string,color:number) {
  const g=new Group();const backing=box(1.68,2.28,.16,0xeff1f2);g.add(backing);
  for(const c of glyphOnCells(char)){const p=box(.23,.23,.1,0x263747);p.position.set((c.x-2)*.28,(3-c.y)*.28,.16);g.add(p);}
  const tab=box(1.5,.12,.1,color);tab.position.set(0,-1.02,.15);g.add(tab);
  const halo=new Mesh(new RingGeometry(1.35,1.44,4),ink(0x263747));halo.name='lock';halo.visible=false;halo.position.z=.2;g.add(halo);return g;
}
