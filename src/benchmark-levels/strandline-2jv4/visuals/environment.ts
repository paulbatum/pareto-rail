import { BackSide, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Fog, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Points, PointsMaterial, Scene, SphereGeometry, TorusGeometry, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from './models';
const TAU=Math.PI*2;
export function makeEnvironment(scene:Scene,p:Palette) {
  scene.background=new Color(p.water);scene.fog=new Fog(p.water,100,530);
  const root=new Group();scene.add(root);
  const water=new SphereGeometry(450,32,24);
  const colors:number[]=[];const pos=water.getAttribute('position');
  for(let i=0;i<pos.count;i++){const h=(pos.getY(i)/450+1)/2;const c=new Color(p.deep).lerp(new Color(p.surface),h*h);colors.push(c.r,c.g,c.b);}
  water.setAttribute('color',new Float32BufferAttribute(colors,3));
  const backdrop=new Mesh(water,new MeshBasicMaterial({vertexColors:true,side:BackSide,fog:false}));root.add(backdrop);
  const jelly=new Group();root.add(jelly);
  const living=new MeshBasicMaterial({color:p.green,transparent:true,opacity:.82,depthWrite:false});
  const sheath=new MeshBasicMaterial({color:p.tissue,transparent:true,opacity:.18,depthWrite:false,side:DoubleSide});
  const canal=new MeshBasicMaterial({color:p.gold});
  const bellgeo=new SphereGeometry(48,64,32,0,TAU,0,Math.PI/2);
  const col:number[]=[];const bpos=bellgeo.getAttribute('position');
  for(let i=0;i<bpos.count;i++){const t=bpos.getY(i)/48;const c=new Color(p.bellBase).lerp(new Color(p.bellTip),t);col.push(c.r,c.g,c.b);}
  bellgeo.setAttribute('color',new Float32BufferAttribute(col,3));
  const bell=new Mesh(bellgeo,new MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.62,side:DoubleSide,depthWrite:false}));bell.scale.y=.53;bell.position.set(0,84,-40);jelly.add(bell);
  const fine:BufferGeometry[]=[],thick:BufferGeometry[]=[],gold:BufferGeometry[]=[];
  for(let i=0;i<64;i++) {
    const a=i*TAU/64, r= i%4===0?17:25+(i%5)*4.2;
    const pts:Vector3[]=[];
    for(let j=0;j<22;j++){const t=j/21;const angle=a+Math.sin(t*8+i*.7)*.11;
      const radius=r+Math.sin(t*10+i*1.9)*5+Math.sin(t*3+i)*9;
      pts.push(new Vector3(Math.cos(angle)*radius,82-t*(178+(i%7)*4),-40+Math.sin(angle)*radius));}
    const curve=new CatmullRomCurve3(pts);
    fine.push(new TubeGeometry(curve,100,.12+(i%3)*.045,5,false));
    if(i%4===0) thick.push(new TubeGeometry(curve,100,.45,6,false));
    // Nutrient beads are emitted separately below, to keep this forest cheap.
  }
  // Eight ruffled oral arms hang in the center; their curling tips read at pullback.
  for(let i=0;i<8;i++){const a=i*TAU/8;const pts:Vector3[]=[];
    for(let j=0;j<28;j++){const t=j/27;const r=8+t*13+Math.sin(t*12+i)*4;pts.push(new Vector3(Math.cos(a+t*.8)*r,81-t*150,-40+Math.sin(a+t*.8)*r));}
    thick.push(new TubeGeometry(new CatmullRomCurve3(pts),110,.75,7,false));}
  for(let i=0;i<24;i++){const a=i*TAU/24;const pts:Vector3[]=[];
    for(let j=0;j<22;j++){const theta=j/21*Math.PI/2;pts.push(new Vector3(48*Math.sin(theta)*Math.cos(a),84+25.44*Math.cos(theta),-40+48*Math.sin(theta)*Math.sin(a)));}
    gold.push(new TubeGeometry(new CatmullRomCurve3(pts),36,.075,4,false));}
  for(let i=0;i<4;i++){const radius=48*Math.sin((i+1)*Math.PI/8);const rim=new TorusGeometry(radius,.11,5,80);rim.rotateX(Math.PI/2);rim.translate(0,84+25.44*Math.cos((i+1)*Math.PI/8),-40);gold.push(rim);}
  for(const [geos,mat] of [[fine,living],[thick,sheath],[gold,canal]] as const){const merged=mergeGeometries([...geos]);if(merged) jelly.add(new Mesh(merged,mat));geos.forEach(g=>g.dispose());}
  // The skirt is a continuous scalloped organ, not a flat Saturn ring.
  const skirtPts:Vector3[]=[];
  for(let i=0;i<=240;i++){const a=i/240*TAU;skirtPts.push(new Vector3(Math.cos(a)*48,84+Math.sin(a*24)*1.1,-40+Math.sin(a)*48));}
  jelly.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(skirtPts),240,.35,6,false),living));
  const beads=new InstancedMesh(new SphereGeometry(.21,6,4),canal,640);const dummy=new Object3D();
  for(let i=0;i<640;i++){const a=(i%64)*TAU/64,t=Math.floor(i/64)/10,r=25+(i%5)*4.2+Math.sin(t*10+i%64*1.9)*5;
    dummy.position.set(Math.cos(a)*r,82-t*190,-40+Math.sin(a)*r);dummy.scale.setScalar(.65+(i%4)*.24);dummy.updateMatrix();beads.setMatrixAt(i,dummy.matrix);}
  jelly.add(beads);
  const shafts=new Group();root.add(shafts);
  const beamMat=new MeshBasicMaterial({color:p.beam,transparent:true,opacity:.014,depthWrite:false,side:DoubleSide});
  for(let i=0;i<11;i++){const m=new Mesh(new CylinderGeometry(2,10,260,7,1,true),beamMat);m.position.set((i%4-1.5)*42,35,-120+Math.floor(i/4)*70);m.rotation.z=.18;shafts.add(m);}
  const dustGeo=new BufferGeometry();const dust:number[]=[];
  for(let i=0;i<1100;i++)dust.push(Math.sin(i*127.1)*155,Math.sin(i*311.7)*160,-40+Math.cos(i*91.7)*155);
  dustGeo.setAttribute('position',new Float32BufferAttribute(dust,3));
  const dustObj=new Points(dustGeo,new PointsMaterial({color:p.dust,size:.16,transparent:true,opacity:.42,depthWrite:false}));root.add(dustObj);
  let pulse=0;
  return {beat(){pulse=.85;},update(dt:number,time:number,restored:number,victory:boolean,cameraPosition:Vector3){
    backdrop.position.copy(cameraPosition);
    pulse*=Math.exp(-dt*2.8);
    living.color.set(p.dormant).lerp(new Color(p.green),Math.min(1,restored*.7+(victory?.5:0))).multiplyScalar(1+pulse*.12);
    canal.color.set(p.gold).multiplyScalar(.64+.35*restored+pulse*.14);
    jelly.scale.set(1+Math.sin(time*.8)*.005,1+Math.sin(time*.8)*.012,1+Math.sin(time*.8)*.005);
    jelly.position.y= victory ? Math.max(0,time-54)*.5 : 0;
    dustObj.rotation.y=Math.sin(time*.04)*.025;
  },dispose(){root.traverse(o=>{if(o instanceof Mesh || o instanceof Points){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});scene.remove(root);}};
}
