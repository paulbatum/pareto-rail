import { AdditiveBlending, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3 } from 'three';
import type { Life } from '../gameplay';

export function buildAnimal(colors: { tissue: number; glow: number; gold: number }, strandCount: number) {
  const root = new Group();
  const tissue = new MeshBasicMaterial({ color: colors.tissue, transparent: true, opacity: .22, depthWrite: false, side: DoubleSide });
  const glow = new MeshBasicMaterial({ color: colors.glow, transparent: true, opacity: .7, depthWrite: false });
  const gold = new MeshBasicMaterial({ color: colors.gold, transparent: true, opacity: .6, depthWrite: false });
  const cap = new Mesh(new SphereGeometry(61, 80, 36, 0, Math.PI*2, 0, Math.PI/2), tissue);
  cap.scale.y = .56; cap.position.set(0,38,-150); root.add(cap);
  const rim = new Mesh(new TorusGeometry(60.8,.48,8,120),glow);
  rim.rotation.x = Math.PI/2; rim.position.copy(cap.position); root.add(rim);
  const inner = new Mesh(new SphereGeometry(36,48,24), new MeshBasicMaterial({ color: colors.glow, transparent:true, opacity:.045, depthWrite:false }));
  inner.scale.y=.32; inner.position.set(0,43,-150); root.add(inner);
  for (let rib=0;rib<32;rib++) {
    const a=rib/32*Math.PI*2;
    const points: Vector3[]=[];
    for(let i=0;i<=36;i++) {
      const t=i/36*Math.PI/2;
      points.push(new Vector3(Math.sin(t)*61*Math.cos(a),38+Math.cos(t)*34.2,-150+Math.sin(t)*61*Math.sin(a)));
    }
    root.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(points),48,.11,4,false),gold));
  }
  const beads = new InstancedMesh(new SphereGeometry(.25,6,4),gold,strandCount*26);
  let bead=0;
  const matrix=new Matrix4();
  for(let s=0;s<strandCount;s++) {
    const angle=s*2.399963;
    const radius=12+Math.sqrt((s+.5)/strandCount)*43;
    const length=120+(s%7)*11;
    const points: Vector3[]=[];
    for(let i=0;i<=40;i++) {
      const t=i/40;
      points.push(new Vector3(Math.cos(angle)*radius+Math.sin(t*8+s)*t*9,38-t*length,-150+Math.sin(angle)*radius+Math.sin(t*6+s*.7)*t*11));
    }
    const curve=new CatmullRomCurve3(points);
    const strand=new Mesh(new TubeGeometry(curve,80,.18+(s%4)*.07,5,false),glow);
    root.add(strand);
    for(let b=0;b<26;b++) {
      const p=curve.getPoint(b/26);
      matrix.makeTranslation(p.x,p.y,p.z); beads.setMatrixAt(bead++,matrix);
    }
    if(s%8===0) {
      const pos:number[]=[]; const idx:number[]=[];
      for(let i=0;i<=64;i++) {
        const t=i/64; const p=curve.getPoint(t);
        const width=(1-t)*2.6+.15;
        pos.push(p.x-width,p.y,p.z+Math.sin(t*60)*1.2,p.x+width,p.y,p.z-Math.sin(t*60)*1.2);
        if(i<64) { const n=i*2; idx.push(n,n+1,n+2,n+1,n+3,n+2); }
      }
      const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
      root.add(new Mesh(g,new MeshBasicMaterial({color:colors.tissue,transparent:true,opacity:.28,side:DoubleSide,depthWrite:false})));
    }
  }
  root.add(beads);
  return { root, update(time:number,life:Life) {
    const pulse=1+Math.sin(time*1.05)*.015;
    cap.scale.set(pulse,.56*(1+Math.sin(time*1.05)*.045),pulse);
    glow.color.set(colors.glow).lerp(new Color(colors.gold),life.clean*.45).multiplyScalar(.85+life.clean*.4);
    tissue.opacity=.18+life.clean*.06;
    root.rotation.z=Math.sin(time*.18)*.012;
    if(life.freed) root.position.y=Math.max(0,time-life.freedAt)*.45;
    else root.position.y=0;
  }};
}

export function buildWater(color: number, shaftColor: number, count: number) {
  const root=new Group();
  const particles=new InstancedMesh(new SphereGeometry(.13,4,3),new MeshBasicMaterial({color,transparent:true,opacity:.48,depthWrite:false}),count);
  const matrix=new Matrix4();
  for(let i=0;i<count;i++) {
    const x=Math.sin(i*127.1)*140, y=Math.sin(i*311.7)*150, z=-150+Math.sin(i*71.7)*160;
    matrix.makeTranslation(x,y,z); particles.setMatrixAt(i,matrix);
  }
  root.add(particles);
  for(let i=0;i<9;i++) {
    const x=-120+i*32;
    const g=new BufferGeometry();
    g.setAttribute('position',new Float32BufferAttribute([x,150,-180,x+10,150,-180,x+90,-160,-175,x+35,-160,-175],3));
    g.setIndex([0,1,2,0,2,3]);
    root.add(new Mesh(g,new MeshBasicMaterial({color:shaftColor,transparent:true,opacity:.025,side:DoubleSide,depthWrite:false,blending:AdditiveBlending})));
  }
  return root;
}
