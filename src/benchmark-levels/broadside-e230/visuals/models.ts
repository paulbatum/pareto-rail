import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, ConeGeometry, Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Palette = { ice:number; cyan:number; hull:number; orange:number; crimson:number; gold:number; white:number; steel:number; allyRib:number; enemyRib:number };
export function capitalShip(p:Palette, friendly:boolean, length:number, seed:number) {
  const group=new Group();
  const hull:BufferGeometry[]=[], ribs:BufferGeometry[]=[], lights:BufferGeometry[]=[], engines:BufferGeometry[]=[];
  const box=(list:BufferGeometry[],x:number,y:number,z:number,w:number,h:number,d:number)=>list.push(new BoxGeometry(w,h,d).translate(x,y,z));
  // Twin tapered hulls leave an actual navigable service trench between them.
  for(const side of [-1,1]) {
    box(hull,side*length*.047,0,0,length*.065,length*.044,length*.83);
    const prow=new CylinderGeometry(length*.033,length*.006,length*.23,4,1);prow.rotateX(Math.PI/2);prow.rotateZ(Math.PI/4);prow.translate(side*length*.047,0,-length*.49);hull.push(prow);
    for(let j=0;j<19;j++) {
      const z=(j/18-.5)*length*.79;
      box(ribs,side*length*.048,length*.025,z,length*.068,length*.007,length*.007);
      box(lights,side*length*.082,0,z,length*.0018,length*.009,length*.027);
      if(j%3===0) {
        box(hull,side*length*.087,length*.008,z,length*.024,length*.016,length*.027);
        box(ribs,side*length*.107,length*.008,z,length*.025,length*.005,length*.005);
        box(ribs,side*length*.107,length*.008,z+length*.009,length*.025,length*.005,length*.005);
      }
      for(let k=0;k<3;k++)box(lights,side*length*.052+(k-1)*length*.015,length*.028,z,length*.002,length*.001,length*.006);
    }
    for(let j=0;j<3;j++) {
      const g=new CylinderGeometry(length*.012,length*.009,length*.03,10);g.rotateX(Math.PI/2);g.translate(side*length*.05+(j-1)*length*.021,0,length*.435);engines.push(g);
    }
    box(lights,side*length*.017,length*.019,0,length*.002,length*.002,length*.82);
  }
  box(hull,0,-length*.022,0,length*.13,length*.009,length*.82);
  box(hull,0,length*.028,length*.28,length*.12,length*.016,length*.06);
  box(hull,0,length*.053,length*.3,length*.036,length*.045,length*.04);
  box(ribs,0,length*.074,length*.295,length*.064,length*.008,length*.025);
  box(lights,0,length*.075,length*.28,length*.055,length*.003,length*.002);
  for(let j=0;j<7;j++)box(ribs,(j-3)*length*.007,length*(.085+((j+seed)%3)*.006),length*.3,length*.001,length*.025,length*.001);
  const mats=[new MeshStandardMaterial({color:friendly?p.ice:p.hull,roughness:.68,metalness:.45}),new MeshStandardMaterial({color:friendly?p.allyRib:p.enemyRib,roughness:.6,metalness:.5}),new MeshBasicMaterial({color:new Color(friendly?p.cyan:p.orange).multiplyScalar(1.4)}),new MeshBasicMaterial({color:new Color(friendly?p.cyan:p.crimson).multiplyScalar(2)})];
  [hull,ribs,lights,engines].forEach((parts,i)=>{const merged=mergeGeometries(parts);group.add(new Mesh(merged,mats[i]));parts.forEach(g=>g.dispose());});
  return group;
}
export function fighter(p:Palette,kind:string) {
  const g=new Group();
  const dark=new MeshStandardMaterial({color:p.steel,metalness:.6,roughness:.45});
  const trim=new MeshBasicMaterial({color:p.orange});
  const hot=new MeshBasicMaterial({color:new Color(p.crimson).multiplyScalar(1.7)});
  const add=(geo:BufferGeometry,mat:MeshBasicMaterial|MeshStandardMaterial,x=0,y=0,z=0)=>{const m=new Mesh(geo,mat);m.position.set(x,y,z);g.add(m);return m;};
  if(kind==='generator'||kind==='core') {
    add(new BoxGeometry(5.3,4.5,2),dark,0,0,-.6);
    add(new TorusGeometry(1.8,.3,6,12),trim);
    add(new TorusGeometry(1.25,.13,6,12),hot,0,0,.3);
    add(new CylinderGeometry(.9,.9,.6,8),hot).rotateX(Math.PI/2);
    for(const s of [-1,1]){add(new BoxGeometry(.3,5.2,.4),trim,s*2.5);add(new BoxGeometry(5.2,.3,.4),trim,0,s*2.5);}
    if(kind==='core') {
      add(new TorusGeometry(2.4,.12,5,6),hot).rotateZ(Math.PI/6);
      for(let i=0;i<4;i++) {const a=i*Math.PI/2;const shutter=add(new BoxGeometry(1.7,1.7,.3),dark,Math.cos(a)*1.1,Math.sin(a)*1.1,1);shutter.name=`shutter-${i}`;}
    }
  } else if(kind==='shell') {
    add(new ConeGeometry(.65,2.4,5),hot).rotateX(Math.PI/2);
    add(new TorusGeometry(1.05,.1,4,8),trim);
  } else if(kind==='turret') {
    add(new BoxGeometry(4,2.2,2.6),dark);
    for(const s of [-1,1]) {add(new BoxGeometry(.4,.4,4),trim,s,0,1);add(new BoxGeometry(.6,1.6,.2),hot,s*1.7,0,1.4);}
  } else {
    const heavy=kind==='bomber';
    add(new ConeGeometry(heavy?1.2:.65,heavy?3.5:4.6,4),dark).rotateX(-Math.PI/2);
    add(new BoxGeometry(.35,.5,1.3),hot,0,.25,1.2);
    if(kind==='spiral') {
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3;const fin=add(new BoxGeometry(2.8,.35,1.7),dark,Math.cos(a)*1.5,Math.sin(a)*1.5,0);fin.rotation.z=a;add(new BoxGeometry(.55,.55,.4),trim,Math.cos(a)*2.5,Math.sin(a)*2.5,1);}
    } else for(const s of [-1,1]) {
      const wing=add(new BoxGeometry(heavy?3.4:2.6,.23,heavy?2:1.5),dark,s*(heavy?2:1.4),0,-.3);wing.rotation.y=s*.38;
      add(new BoxGeometry(.2,.28,heavy?2.8:2.2),trim,s*(heavy?3.5:2.6),0,-.3);
      add(new CylinderGeometry(.28,.35,1.2,6),hot,s*1.1,0,-1.5).rotateX(Math.PI/2);
    }
  }
  return g;
}
