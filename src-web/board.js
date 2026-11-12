import QRCode from 'qrcode';
import {recognize,validStrokes,bounds} from './face.js';
import {connect} from './link.js';
import {voice} from './voice.js';
const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
let strokes=loadBoard(),face=recognize(strokes), timer, link, width,height, pairing, last='', expression='alegría', busy=false, ticket=0,volume=.8, nextBlink=0,blinkStart=-1000, disconnected=false;
const active=new Map();
const audio=voice();
function loadBoard(){try{const lines=JSON.parse(localStorage.getItem('board-drawing'));return validStrokes(lines)?lines:[];}catch{return [];}}
function saveBoard(){try{localStorage.setItem('board-drawing',JSON.stringify(strokes));}catch{}}
function resize(){width=canvas.clientWidth;height=canvas.clientHeight;const d=Math.min(devicePixelRatio,2);canvas.width=width*d;canvas.height=height*d;ctx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',resize);resize();
function point(e){return [Math.min(1,Math.max(0,e.clientX/width)),Math.min(1,Math.max(0,e.clientY/height))];}
canvas.onpointerdown=e=>{
  audio.unlock();
  if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
  if(pairing||face||strokes.length>=100||e.button!==0||e.width>45||e.height>45)return;
  clearTimeout(timer);canvas.setPointerCapture(e.pointerId);
  const line=[point(e)];active.set(e.pointerId,line);strokes.push(line);
};
canvas.onpointermove=e=>{const line=active.get(e.pointerId);if(!line)return;for(const sample of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])if(line.length<500)line.push(point(sample));};
function finish(e){if(!active.delete(e.pointerId)||active.size)return;timer=setTimeout(()=>{face=recognize(strokes);saveBoard();state();},1500);}
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=finish;
function state(){link?.send({type:'state',ready:!!face,busy});}
function frame(t){
  if(t>nextBlink){blinkStart=t;nextBlink=t+1900+Math.random()*5000;}
  const blink=Math.max(0,1-Math.abs(t-blinkStart-85)/85);
  const mouth=audio.level(), look=Math.sin(t/1050)*Math.cos(t/3600);
  const mood={alegría:[1,1],sorpresa:[1.35,1.5],confusión:[.8,.9],curiosidad:[1.15,1],risa:[.65,1.6],tristeza:[.8,.65],pensamiento:[.9,.8],entusiasmo:[1.25,1.3]}[expression]||[1,1];
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle='#171819';ctx.lineWidth=Math.max(3,Math.min(width,height)*.008);ctx.lineCap=ctx.lineJoin='round';
  strokes.forEach((line,i)=>{
    const group=face?.findIndex(g=>g.ids.includes(i))??-1, anchor=face?.[group], pupil=group>=0&&group<2&&anchor.ids[0]!==i;
    ctx.beginPath();
    line.forEach(([x,y],j)=>{
      if(anchor&&group<2){x+=look*(pupil?.008:.002);y=anchor.y+(y-anchor.y)*Math.max(.07,mood[0]*(1-blink*.94));}
      if(group===2){const bend=Math.max(0,1-Math.abs(x-anchor.x)/.13);y=anchor.y+(y-anchor.y)*(mood[1]+mouth*2)+mouth*bend*.024+(expression==='tristeza'?-.006:0)*bend;}
      if(j===0)ctx.moveTo(x*width,y*height);else ctx.lineTo(x*width,y*height);
    });
    if(line.length===1)ctx.lineTo(line[0][0]*width+.01,line[0][1]*height);
    ctx.stroke();
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function stop(){ticket++;audio.stop();busy=false;state();}
async function say(text){if(!face||!text)return;stop();const turn=ticket;busy=true;state();try{const provider=await audio.speak(text,volume);if(turn===ticket&&provider)link?.send({type:'provider',provider});}catch{link?.send({type:'provider',provider:'audio no disponible'});}finally{if(turn===ticket){busy=false;state();}}}
const offline=['offline-1','offline-2','offline-3'];
async function announcement(name){if(!face||busy)return;busy=true;state();const turn=++ticket;try{await audio.clip(name,volume);}catch{}finally{if(turn===ticket){busy=false;state();}}}
function receive(m){
  if(m.type==='peer'){sessionStorage.setItem('paired','1');if(pairing){pairing.remove();pairing=null;}state();}
  if(m.type==='end'){stop();link.close();sessionStorage.removeItem('board');sessionStorage.removeItem('paired');start().catch(console.error);}
  if(m.type==='reply'){last=m.answer;say(last);}
  if(m.type==='command'){
    switch(m.action){
      case 'clear':stop();clearTimeout(timer);active.clear();face=null;strokes=[];last='';saveBoard();state();break;
      case 'emotion':expression=m.value;break;
      case 'volume':volume=m.value;audio.volume(volume);break;
      case 'stop':stop();break;
      case 'repeat':say(last);break;
      case 'say':say(m.value);break;
      case 'snapshot':link.send({type:'snapshot',strokes});break;
      case 'restore':if(validStrokes(m.value)){stop();clearTimeout(timer);active.clear();strokes=m.value;face=recognize(strokes);saveBoard();state();}break;
      case 'correct':{
        const points=m.value;
        const boxes=strokes.map(bounds);
        const ids=points.map(([x,y])=>boxes.reduce((best,b,i)=>Math.hypot(b.x-x,b.y-y)<best.d?{i,d:Math.hypot(b.x-x,b.y-y)}:best,{i:-1,d:Infinity}).i);
        if(ids.every(i=>i>=0)&&new Set(ids).size===3){face=ids.map(i=>({x:boxes[i].x,y:boxes[i].y,ids:[i]}));state();}
        break;
      }
    }
  }
}
async function start(){
  let session=JSON.parse(sessionStorage.getItem('board')||'null');
  if(!session||session.expires<Date.now()||(!sessionStorage.getItem('paired')&&session.inviteUntil<Date.now())){
    const r=await fetch('/api/session',{method:'POST'});if(!r.ok)throw Error('No se pudo crear una sesión');
    session=await r.json();sessionStorage.setItem('board',JSON.stringify(session));
  }
  if(!sessionStorage.getItem('paired')){
  setTimeout(()=>{if(pairing&&link){pairing.remove();pairing=null;link.close();start().catch(console.error);}},Math.max(0,session.inviteUntil-Date.now()));
  pairing=document.createElement('aside');
  const url=new URL('/teacher.html',location.origin);url.hash=session.id+'.'+session.invite;
  pairing.innerHTML='<h1>Vincular celular</h1><canvas aria-label="Código QR"></canvas><p>Toca aquí para activar el audio y la pantalla completa.</p>';
  document.body.append(pairing);
  pairing.onclick=()=>{audio.unlock();document.documentElement.requestFullscreen?.().catch(()=>{});};
  await QRCode.toCanvas(pairing.querySelector('canvas'),url.href,{width:250});
  }
  let interruption;
  link=connect(session.id,session.token,receive,online=>{
    clearTimeout(interruption);
    if(online){state();if(disconnected){disconnected=false;announcement('online');}}
    else interruption=setTimeout(()=>{if(!disconnected){disconnected=true;stop();announcement(offline[Math.floor(Math.random()*offline.length)]);}},3500);
  });
}
start().catch(console.error);
navigator.serviceWorker?.register('/sw.js').catch(console.error);

