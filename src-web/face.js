export function bounds(stroke) {
  const xs=stroke.map(p=>p[0]), ys=stroke.map(p=>p[1]);
  const l=Math.min(...xs), r=Math.max(...xs), t=Math.min(...ys), b=Math.max(...ys);
  return {l,r,t,b,x:(l+r)/2,y:(t+b)/2,w:r-l,h:b-t};
}
export function recognize(strokes) {
  const boxes=strokes.map(bounds);
  const candidates=boxes.map((box,i)=>({...box,i})).filter(b=>Math.max(b.w,b.h)>.012);
  let best=null, score=Infinity;
  for(const a of candidates) for(const b of candidates) {
    const gap=b.x-a.x;
    if(gap<.045 || Math.abs(a.y-b.y)>gap*.4 || Math.max(a.w,b.w)>gap*.85) continue;
    for(const m of candidates) {
      const down=m.y-(a.y+b.y)/2, offset=Math.abs(m.x-(a.x+b.x)/2);
      if(down<gap*.2 || down>gap*2.2 || offset>gap*.42 || m.w<gap*.23 || m.i===a.i || m.i===b.i) continue;
      const cost=(offset+Math.abs(a.y-b.y)+.25*Math.abs(down-gap*.65))/gap;
      if(cost<score){score=cost;best=[a,b,m];}
    }
  }
  if(!best)return null;
  return best.map((anchor,j)=>({x:anchor.x,y:anchor.y,ids:boxes.flatMap((b,i)=>{
    if(best.some((other,k)=>k!==j&&other.i===i)) return [];
    return i===anchor.i || (b.l>=anchor.l-.007 && b.r<=anchor.r+.007 && b.t>=anchor.t-.007 && b.b<=anchor.b+.007) ? [i]:[];
  })}));
}
export function validStrokes(s){
  return Array.isArray(s)&&s.length<=100&&s.every(line=>Array.isArray(line)&&line.length>0&&line.length<=500&&line.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1)));
}
