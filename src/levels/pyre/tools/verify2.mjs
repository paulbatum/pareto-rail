import { PerspectiveCamera, Vector3, Matrix4, Quaternion, Euler, MathUtils } from 'three';
import { readMasses } from './read-masses.mjs';
const W=1920,H=1080,FOV=62,PITCH=16,EYE=5;
const TAN_V=Math.tan(MathUtils.degToRad(FOV)/2), TAN_H=TAN_V*(W/H);
const p=MathUtils.degToRad(PITCH), SIN=Math.sin(p), COS=Math.cos(p);
function framePoint(px,py,depth){
  const nx=2*px/W-1, ny=1-2*py/H, k=ny*TAN_V;
  const rise=depth*(SIN+k*COS)/(COS-k*SIN);
  const fwd=rise*SIN+depth*COS;
  return new Vector3(nx*TAN_H*fwd, EYE+rise, -depth);
}
function frameBox(r,d){
  const mx=(r.x0+r.x1)/2,my=(r.y0+r.y1)/2;
  const l=framePoint(r.x0,my,d),rr=framePoint(r.x1,my,d),t=framePoint(mx,r.y0,d),b=framePoint(mx,r.y1,d);
  return {center:new Vector3((l.x+rr.x)/2,(t.y+b.y)/2,-d),width:Math.abs(rr.x-l.x),height:Math.abs(t.y-b.y)};
}
const cam=new PerspectiveCamera(FOV,W/H,0.1,500);
cam.position.set(0,EYE,0); cam.lookAt(0,EYE,-10); cam.rotateX(p); cam.updateMatrixWorld(true);
const CORNERS=[-1,1].flatMap(sx=>[-1,1].flatMap(sy=>[-1,1].map(sz=>new Vector3(sx,sy,sz))));
function solve(rect,depth,thickness,roll=0,yaw=0,verbose=false){
  const seed=frameBox(rect,depth);
  const pos=new Vector3(seed.center.x,seed.center.y,-depth-thickness/2);
  let width=seed.width,height=seed.height;
  const q=new Quaternion().setFromEuler(new Euler(0,MathUtils.degToRad(yaw),MathUtils.degToRad(roll)));
  const tW=rect.x1-rect.x0,tH=rect.y1-rect.y0,tX=(rect.x0+rect.x1)/2,tY=(rect.y0+rect.y1)/2;
  const m=new Matrix4(),v=new Vector3();
  for(let pass=0;pass<8;pass++){
    m.compose(pos,q,new Vector3(width/2,height/2,thickness/2));
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    for(const c of CORNERS){v.copy(c).applyMatrix4(m).project(cam);
      const px=(v.x+1)/2*W,py=(1-v.y)/2*H;
      minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}
    if(verbose)console.log(`  pass${pass} bbox ${minX.toFixed(0)},${minY.toFixed(0)}-${maxX.toFixed(0)},${maxY.toFixed(0)} w=${width.toFixed(1)} h=${height.toFixed(1)} z=${pos.z.toFixed(1)}`);
    const gW=maxX-minX,gH=maxY-minY;
    pos.x+=((tX-(minX+maxX)/2)/gW)*width;
    pos.y-=((tY-(minY+maxY)/2)/gH)*height;
    width*=tW/gW; height*=tH/gH;
  }
  return {pos,width,height};
}
console.log('frameslab want -90,-140-128,482');
solve({x0:-90,y0:-140,x1:128,y1:482},28,26,6,-14,true);
console.log('right1 want 1492,456-1600,550');
solve({x0:1492,y0:456,x1:1600,y1:550},56,22,-2,10,true);
console.log('backdrop want -260,-240-980,380');
solve({x0:-260,y0:-240,x1:980,y1:380},222,2,0,0,true);

// --- real slab audit ---
const slabs = readMasses();
console.log('\n=== audit ===');
for (const s of slabs) {
  const r=s.rect;
  const {x0,y0,x1,y1}=r;
  const res=solve(r,s.depth,s.thickness,s.roll,s.yaw);
  // measure final
  const q=new Quaternion().setFromEuler(new Euler(0,MathUtils.degToRad(s.yaw),MathUtils.degToRad(s.roll)));
  const m=new Matrix4().compose(res.pos,q,new Vector3(res.width/2,res.height/2,s.thickness/2));
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9; const v=new Vector3();
  for(const c of CORNERS){v.copy(c).applyMatrix4(m).project(cam);const px=(v.x+1)/2*W,py=(1-v.y)/2*H;
    minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}
  const ex=Math.max(Math.abs(minX-x0),Math.abs(maxX-x1)), ey=Math.max(Math.abs(minY-y0),Math.abs(maxY-y1));
  if (ex>12||ey>12) console.log(`${s.group.padEnd(22)} want ${x0},${y0}-${x1},${y1} got ${minX.toFixed(0)},${minY.toFixed(0)}-${maxX.toFixed(0)},${maxY.toFixed(0)}  err ${ex.toFixed(0)}/${ey.toFixed(0)}`);
}
