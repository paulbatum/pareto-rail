import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OctahedronGeometry, TorusGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function box(w:number,h:number,d:number,x:number,y:number,z:number) { return new BoxGeometry(w,h,d).translate(x,y,z); }
export function batch(parts:BufferGeometry[], color:number) {
  const flat=parts.map(p=>p.index?p.toNonIndexed():p);
  const geo=mergeGeometries(flat); flat.forEach(p=>p.dispose()); parts.forEach(p=>p.dispose());
  return new Mesh(geo,new MeshBasicMaterial({color}));
}
export function cruiser(length:number, friendly:boolean, hull:number, trim:number, engine:number) {
  const group=new Group();
  const w=length*0.085, h=length*0.037;
  const body:BufferGeometry[]=[]; const panels:BufferGeometry[]=[]; const lights:BufferGeometry[]=[];
  body.push(new OctahedronGeometry(1,0).scale(w,h,length/2));
  body.push(box(w*1.35,h*1.1,length*0.65,0,0,length*0.05));
  for(let i=0;i<11;i++) {
    const z=length*(i/13-0.36);
    panels.push(box(w*1.43,h*0.3,length*0.038,0,h*0.65,z));
    for(const side of [-1,1]) {
      panels.push(box(w*0.25,h*0.5,length*0.024,side*w*0.77,0,z));
      lights.push(box(0.7,1.1,length*0.03,side*w*0.92,1,z));
      if(i%2===0) {
        body.push(box(w*0.28,h*0.4,length*0.023,side*w*0.67,h*0.78,z));
        panels.push(box(w*0.5,1.6,1.6,side*w*0.96,h*0.83,z));
      }
    }
  }
  body.push(box(w*0.42,h*1.4,length*0.13,0,h*1.0,length*0.16));
  panels.push(box(w*0.66,h*0.22,length*0.05,0,h*1.85,length*0.15));
  for(let i=-1;i<=1;i++) lights.push(box(w*0.22,h*0.55,1,i*w*0.4,0,length*0.385));
  const main=batch(body,hull); group.add(main,batch(panels,trim),batch(lights,engine));
  const outline=new LineSegments(new EdgesGeometry(main.geometry,35),new LineBasicMaterial({color:friendly?0x657e91:0x793f56})); group.add(outline);
  group.userData.friendly=friendly;
  return group;
}
export function fighter(kind:string, hull:number, hot:number) {
  const g=new Group(); const parts:BufferGeometry[]=[];
  if(kind==='interceptor') {
    parts.push(new OctahedronGeometry(1).scale(0.6,0.35,2));
    for(const s of [-1,1]) parts.push(new OctahedronGeometry(1).scale(2,0.18,1.1).rotateY(s*0.5).translate(s*1.4,0,0.4));
  } else if(kind==='helix') {
    parts.push(new OctahedronGeometry(0.85));
    for(let i=0;i<3;i++) parts.push(box(0.4,2.5,0.8,0,1.3,0).rotateZ(i*Math.PI*2/3));
  } else if(kind==='bomber') {
    parts.push(box(2.1,1.1,2.7,0,0,0));
    for(const s of [-1,1]) parts.push(box(0.85,1.2,3.5,s*2,0,0.2),box(3,0.3,1,s*1,0,0));
  } else if(kind==='turret') {
    parts.push(new CylinderGeometry(1.9,2.3,0.7,6).rotateX(Math.PI/2));
    parts.push(box(0.4,0.4,3,-0.65,0,1),box(0.4,0.4,3,0.65,0,1));
  } else {
    parts.push(box(3.6,3.6,1,0,0,-0.7));
    for(const s of [-1,1]) parts.push(box(0.6,4.5,2,s*2,0,0),box(4.5,0.6,2,0,s*2,0));
  }
  const body=batch(parts,hull);g.add(body);
  g.add(new LineSegments(new EdgesGeometry(body.geometry),new LineBasicMaterial({color:hot})));
  const core=new Mesh(new OctahedronGeometry(kind==='generator'||kind==='core'?1.25:0.5),new MeshBasicMaterial({color:hot}));core.position.z=1;g.add(core);
  const ring=new Mesh(new TorusGeometry(kind==='core'||kind==='generator'?2.8:2.5,0.045,4,24),new MeshBasicMaterial({color:0xaaffff}));ring.visible=false;g.add(ring);g.userData.lockRing=ring;
  return g;
}

export function nebulaGeometry() {
  const geometry=new BufferGeometry();const p:number[]=[],c:number[]=[];
  const n=100,m=60;
  const point=(i:number,j:number)=>{
    const u=i/n*Math.PI*2,v=j/m*Math.PI;
    const x=Math.sin(v)*Math.cos(u),y=Math.cos(v),z=Math.sin(v)*Math.sin(u);
    p.push(x*8500,y*8500,z*8500);
    const ribbon=Math.exp(-Math.pow((y-0.27*Math.sin(u*2)-0.08*Math.sin(u*7))/0.29,2));
    const dust=0.5+0.2*Math.sin(u*19+v*11)+0.16*Math.sin(u*37-v*17)+0.1*Math.sin(u*73+v*47);
    const gold=0.5+0.5*Math.sin(u*3+v*2);
    const color=new Color().setRGB(0.025+ribbon*dust*(0.26+gold*0.18),0.009+ribbon*dust*gold*0.18,0.035+ribbon*dust*(0.22-gold*0.14));
    c.push(color.r,color.g,color.b);
  };
  for(let j=0;j<m;j++) for(let i=0;i<n;i++) { point(i,j);point(i+1,j);point(i,j+1);point(i+1,j);point(i+1,j+1);point(i,j+1); }
  geometry.setAttribute('position',new Float32BufferAttribute(p,3));geometry.setAttribute('color',new Float32BufferAttribute(c,3));return geometry;
}
