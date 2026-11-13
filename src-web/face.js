export function bounds(stroke) {
  const xs=stroke.map(p=>p[0]), ys=stroke.map(p=>p[1]);
  const l=Math.min(...xs), r=Math.max(...xs), t=Math.min(...ys), b=Math.max(...ys);
  return {l,r,t,b,x:(l+r)/2,y:(t+b)/2,w:r-l,h:b-t};
}
const size=box=>Math.max(box.w,box.h);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const inside=(inner,outer,pad=0)=>inner.l>=outer.l-pad&&inner.r<=outer.r+pad&&inner.t>=outer.t-pad&&inner.b<=outer.b+pad;

function enclosed(stroke,box){
  const [x,y]=stroke[0], [endX,endY]=stroke.at(-1);
  return stroke.length>=4&&Math.min(box.w,box.h)>size(box)*.19&&Math.hypot(x-endX,y-endY)<=size(box)*.32;
}

function describe(strokes){
  const parts=strokes.map((stroke,i)=>{
    const box=bounds(stroke);
    return {...box,i,closed:enclosed(stroke,box),dot:size(box)<.013};
  });
  for(const eye of parts){
    eye.pupils=eye.closed?parts.filter(p=>p!==eye&&size(p)<size(eye)*.68&&inside(p,eye)&&
      Math.hypot((p.x-eye.x)/(eye.w*.5),(p.y-eye.y)/(eye.h*.5))<.88).map(p=>p.i):[];
    eye.quality=eye.closed?.24:eye.dot?.02:eye.h<eye.w*.18?-.18:0;
    if(eye.pupils.length)eye.quality+=.25;
  }
  return parts;
}

function axes(left,right){
  const gap=distance(left,right)||.1;
  const dx=(right.x-left.x)/gap, dy=(right.y-left.y)/gap;
  const x=(left.x+right.x)/2,y=(left.y+right.y)/2;
  return {gap,along:p=>(p.x-x)*dx+(p.y-y)*dy,down:p=>(p.y-y)*dx-(p.x-x)*dy};
}

function canBeMouth(part,left,right,frame){
  const {gap,along,down}=frame;
  // The mouth belongs below both eyes and between their centers.
  if(part.y<=Math.max(left.y,right.y)||down(part)<gap*.22||Math.abs(along(part))>gap*.42)return false;
  if(!part.closed)return true;
  // A round stroke matching a nearby eye is more likely its partner.
  return ![left,right].some(eye=>eye.closed&&part.w>=eye.w*.55&&part.w<=eye.w*1.65&&
    part.h>=eye.h*.55&&part.h<=eye.h*1.65&&Math.abs(part.x-eye.x)>=Math.max(part.w,eye.w)*.8&&
    Math.abs(part.y-eye.y)<=Math.abs(part.x-eye.x)*.78);
}

function mouthProfile(lines,box,minWidth){
  const width=Math.max(box.w,minWidth);
  const top=[],bottom=[];
  for(let i=0;i<=24;i++){
    const x=box.x+width*(i/24-.5);
    let high=Infinity,low=-Infinity,nearest=Infinity,fallback=box.y;
    for(const line of lines) for(let j=0;j<line.length;j++){
      const [a,ay]=line[j], [b,by]=line[Math.max(0,j-1)];
      const d=Math.abs(x-a);
      if(d<nearest){nearest=d;fallback=ay;}
      if(a===b||x<Math.min(a,b)||x>Math.max(a,b))continue;
      const y=ay+(by-ay)*(x-a)/(b-a);
      high=Math.min(high,y);low=Math.max(low,y);
    }
    top.push([x,Number.isFinite(high)?high:fallback]);
    bottom.push([x,Number.isFinite(low)?low:fallback]);
  }
  return {top,bottom,width,height:box.h};
}

function buildFace(strokes,parts,left,right,mouth){
  const {gap,along,down}=axes(left,right);
  const eyeCenter=down(left);
  const mouthDepth=down(mouth);
  const claimed=new Set([left.i,right.i,mouth.i]);
  const group=(part,role,ids=[part.i])=>({x:part.x,y:part.y,w:part.w,h:part.h,role,ids});
  const eyes=[left,right].filter(part=>part.i!==null).map(part=>{
    const pupils=part.pupils.filter(i=>!claimed.has(i));
    pupils.forEach(i=>claimed.add(i));
    return {...group(part,'eye',[part.i,...pupils]),pupils,addPupil:part.closed&&!pupils.length&&Math.min(part.w,part.h)>gap*.09};
  });
  const lips=[mouth.i],details=[];
  for(const p of parts){
    if(claimed.has(p.i))continue;
    const offset=Math.abs(along(p)-along(mouth));
    if(inside(p,mouth)&&p.w<mouth.w*.8){details.push(p.i);claimed.add(p.i);}
    else if(!mouth.closed&&!p.closed&&p.h<p.w&&p.w>mouth.w*.52&&p.w<mouth.w*1.55&&offset<mouth.w*.3&&Math.abs(down(p)-mouthDepth)<Math.min(gap*.22,mouth.w*.34)){
      lips.push(p.i);claimed.add(p.i);
    }
  }
  const lipBox=bounds(lips.flatMap(i=>strokes[i]));
  const mouthGroup={...group(lipBox,'mouth',[...lips,...details]),details,profile:mouthProfile(lips.map(i=>strokes[i]),lipBox,gap*.13)};
  const accessories=[];
  for(const part of parts){
    if(claimed.has(part.i))continue;
    const u=along(part), v=down(part);
    const side=Math.sign(u)||1;
    const fromEye=Math.abs(u-side*gap*.5);
    let role;
    if(fromEye<gap*.29&&v<eyeCenter-gap*.045&&v>eyeCenter-gap*.65&&part.w>gap*.095&&size(part)<gap*.64&&!part.closed)role='brow';
    else if(fromEye<gap*.46&&v<=eyeCenter+gap*.07&&v>=eyeCenter-gap*.30&&size(part)<gap*.17&&!part.dot)role='lash';
    else if(Math.abs(u)<gap*.22&&v>gap*.11&&v<mouthDepth-gap*.06&&size(part)<gap*.56)role='nose';
    else if(Math.abs(u)>gap*.32&&Math.abs(u)<gap*.95&&v>gap*.12&&v<mouthDepth+gap*.21&&size(part)<gap*.34)role='cheek';
    else if(Math.abs(u)>gap*.64&&Math.abs(u)<gap*1.55&&v>-.22*gap&&v<mouthDepth+gap*.1&&size(part)<gap*.7)role='ear';
    if(role)accessories.push({...group(part,role),side});
  }
  return [...eyes,mouthGroup,...accessories];
}

export function recognize(strokes,points){
  const parts=describe(strokes);
  if(points?.length===3&&parts.length>=3){
    const selected=[];
    const gap=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
    for(const [x,y] of points){
      const nearby=parts.filter(p=>!selected.includes(p)).sort((a,b)=>distance(a,{x,y})-distance(b,{x,y}));
      const closest=nearby[0];
      const enclosingEye=selected.length<2&&nearby.find(p=>size(p)<gap&&p.pupils.includes(closest.i));
      const anchor=enclosingEye||closest;
      selected.push(anchor);
    }
    if(selected.length===3){
      const [a,b,mouth]=selected;
      return a.x<b.x?buildFace(strokes,parts,a,b,mouth):buildFace(strokes,parts,b,a,mouth);
    }
  }
  const candidates=parts.filter(p=>size(p)>.003||p.dot);
  let best=null,score=Infinity;
  for(const a of candidates) for(const b of candidates){
    if(b.x-a.x<.018||Math.abs(a.y-b.y)>(b.x-a.x)*.78)continue;
    const {gap,along,down}=axes(a,b);
    if(Math.max(size(a),size(b))>gap*1.12||a.pupils.includes(b.i)||b.pupils.includes(a.i))continue;
    const apparentEye=a.quality+b.quality;
    const mouths=candidates.filter(m=>{
      if(m===a||m===b||a.pupils.includes(m.i)||b.pupils.includes(m.i))return false;
      if(m.closed&&(inside(a,m)||inside(b,m)))return false;
      if(!canBeMouth(m,a,b,{gap,along,down}))return false;
      const depth=down(m), offset=Math.abs(along(m));
      return depth>=gap*.19&&depth<=gap*2.5&&offset<=gap*.55&&m.w>=gap*(m.closed?.105:.18)&&size(m)<=gap*1.7;
    });
    // Use the eye axis so the lower central stroke still wins on tilted faces.
    const lowerMouthDepth=mouths.reduce((deepest,m)=>{
      if(Math.abs(along(m))>gap*.36||(!m.closed&&m.h>m.w))return deepest;
      return Math.max(deepest,down(m));
    },-Infinity);
    for(const m of mouths){
      const depth=down(m), offset=Math.abs(along(m));
      if(depth<lowerMouthDepth-gap*.09)continue;
      const cost=offset/gap+.25*Math.abs(depth/gap-.73)+Math.abs(a.y-b.y)/gap*.27
        +Math.abs(size(a)-size(b))/gap*.16-apparentEye
        -(Math.min(m.w/gap,.78)*.16);
      if(cost<score){score=cost;best=[a,b,m];}
    }
  }
  if(best)return buildFace(strokes,parts,...best);
  for(const head of parts){
    if(!head.closed||head.w<.08||head.h<.1)continue;
    for(const eye of parts){
      if(!eye.closed||!inside(eye,head)||size(eye)>size(head)*.36||eye.y>=head.y)continue;
      const mouth=parts.filter(p=>p!==eye&&inside(p,head)&&p.y>eye.y+head.h*.18&&
        Math.abs(p.x-eye.x)<head.w*.24&&p.w>=head.w*.12&&p.w<=head.w*.54&&p.h<head.h*.34&&
        canBeMouth(p,eye,eye,{gap:head.w*.4,along:part=>part.x-eye.x,down:part=>part.y-eye.y}))
        .sort((a,b)=>b.y-a.y)[0];
      if(!mouth)continue;
      const side=eye.x<head.x?1:-1;
      const partner={i:null,x:eye.x+side*head.w*.4,y:eye.y};
      return side>0?buildFace(strokes,parts,eye,partner,mouth):buildFace(strokes,parts,partner,eye,mouth);
    }
  }
  return null;
}
export function validStrokes(s){
  return Array.isArray(s)&&s.length<=100&&s.every(line=>Array.isArray(line)&&line.length>0&&line.length<=500&&line.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1)));
}
