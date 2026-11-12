import QRCode from 'qrcode';
import {recognize,validStrokes,bounds} from './face.js';
import {connect} from './link.js';
import {voice} from './voice.js';
const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
let pairingTimer, interruption, returning=false;
let strokes=loadBoard(),face=recognize(strokes), timer, link, width,height, pairing, last='', expression='alegría', busy=false, ticket=0,volume=.8, nextBlink=0,blinkStart=-1000, doubleBlink=false, disconnected=false;
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
const moods={alegría:[1,1],sorpresa:[1.35,1.5],confusión:[.8,.9],curiosidad:[1.15,1],risa:[.65,1.6],tristeza:[.8,.65],pensamiento:[.9,.8],entusiasmo:[1.25,1.3]};
function frame(t){
  if(t>nextBlink){
    blinkStart=t;
    doubleBlink=Math.random()<.24;
    nextBlink=t+(busy?1200:1900)+Math.random()*2800;
  }
  const blinkWave=offset=>Math.max(0,1-Math.abs(t-blinkStart-offset-75)/75);
  const blink=Math.max(blinkWave(0),doubleBlink?blinkWave(205):0);
  const voiceLevel=audio.level();
  const speech=Math.min(1,voiceLevel*3);
  const gaze=Math.tanh(Math.sin(t/1030)*2)*.7+Math.sin(t/473)*.13;
  const gazeUp=Math.sin(t/1570)*.45;
  const glance=Math.sin(t/315)*speech*.22;
  const breath=Math.sin(t/620)*.5+Math.sin(t/1380)*.5;
  const smile=Math.pow(Math.max(0,Math.sin(t/1160)*Math.cos(t/1830)),3);
  const mood=moods[expression]||moods.alegría;
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle='#171819';ctx.lineWidth=Math.max(3,Math.min(width,height)*.008);ctx.lineCap=ctx.lineJoin='round';
  strokes.forEach((line,i)=>{
    const group=face?.findIndex(g=>g.ids.includes(i))??-1, anchor=face?.[group], pupil=group>=0&&group<2&&anchor.ids[0]!==i;
    ctx.beginPath();
    line.forEach(([x,y],j)=>{
      if(anchor&&group<2){
        const open=Math.max(.06,(mood[0]+breath*.09+speech*.22)*(1-blink*.96));
        x+=(gaze+glance)*(pupil?.013:.003);
        y=anchor.y+(y-anchor.y+(pupil?gazeUp*.011:0))*open+gazeUp*.003;
      }
      if(group===2){
        const center=Math.max(0,1-Math.abs(x-anchor.x)/.13);
        const idle=1-speech;
        x=anchor.x+(x-anchor.x)*(1+idle*(breath*.04+smile*.07));
        y=anchor.y+(y-anchor.y)*(mood[1]+voiceLevel*2+idle*breath*.1);
        y+=center*(voiceLevel*.024+idle*smile*.008+(expression==='tristeza'?-.006:0));
      }
      if(j===0)ctx.moveTo(x*width,y*height);else ctx.lineTo(x*width,y*height);
      if(line.length===1)ctx.lineTo(x*width+.01,y*height);
    });
    ctx.stroke();
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function stop(){ticket++;audio.stop();busy=false;state();}
async function say(text){
  if(!face||!text)return;
  stop();
  const turn=ticket;
  busy=true;
  state();
  const report=provider=>{if(turn===ticket)link?.send({type:'provider',provider});};
  try{await audio.speak(text,volume,report);}
  catch(error){console.warn('Reproducción:',error.message);report('audio no disponible');}
  finally{if(turn===ticket){busy=false;state();}}
}
const offline=['offline-1','offline-2','offline-3'];
async function announcement(name){if(!face||busy)return;busy=true;state();const turn=++ticket;try{await audio.clip(name,volume);}catch{}finally{if(turn===ticket){busy=false;state();}}}
function receive(m){
  if(m.type==='peer'){clearTimeout(pairingTimer);sessionStorage.setItem('paired','1');if(pairing){pairing.remove();pairing=null;}state();}
  if(m.type==='end'){if(returning){location.reload();return;} resetPairing();}
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
    sessionStorage.removeItem('paired');
    const r=await fetch('/api/session',{method:'POST'});if(!r.ok)throw Error('No se pudo crear una sesión');
    session=await r.json();sessionStorage.setItem('board',JSON.stringify(session));
  }
  if(!sessionStorage.getItem('paired')){
  pairingTimer=setTimeout(resetPairing,Math.max(0,session.inviteUntil-Date.now()));
  pairing=document.createElement('aside');
  const url=new URL('/teacher?mic=manual-v2',location.origin);url.hash=session.id+'.'+session.invite;
  pairing.innerHTML='<h1>Vincular celular</h1><canvas aria-label="Código QR"></canvas><p>Toca aquí para activar el audio y la pantalla completa.</p>';
  document.body.append(pairing);
  pairing.onclick=()=>{audio.unlock();document.documentElement.requestFullscreen?.().catch(()=>{});};
  await QRCode.toCanvas(pairing.querySelector('canvas'),url.href,{width:250});
  }

  link=connect(session.id,session.token,receive,online=>{
    clearTimeout(interruption);
    if(online){state();if(disconnected){disconnected=false;announcement('online');}}
    else interruption=setTimeout(()=>{if(!disconnected){disconnected=true;stop();announcement(offline[Math.floor(Math.random()*offline.length)]);}},3500);
  });
}
function begin(){
  start().catch(error=>{
    console.error(error);
    if(sessionStorage.getItem('paired'))return;
    pairing?.remove();
    pairing=document.createElement('aside');
    pairing.textContent='No se pudo generar el QR. Toca para reintentar.';
    pairing.onclick=()=>{pairing.remove();pairing=null;begin();};
    document.body.append(pairing);
  });
}
function resetPairing(){
  clearTimeout(pairingTimer);
  link?.close();
  clearTimeout(interruption);
  link=null;
  pairing?.remove();
  pairing=null;
  stop();
  sessionStorage.removeItem('board');
  sessionStorage.removeItem('paired');
  begin();
}
function returnToPairing(){
  if(returning)return;
  returning=true;
  if(!link?.send({type:'end'})){returning=false;resetPairing();return;}
  sessionStorage.removeItem('board');
  sessionStorage.removeItem('paired');
  setTimeout(()=>location.reload(),1200);
}
if(location.hostname==='pizarramagica-1xg.pages.dev'){
  location.replace('https://pizarra-magica-iqtouch.luisnurenagonzales.workers.dev/');
}else{
  const home=document.createElement('button');
  home.type='button';
  home.setAttribute('aria-label','Volver al código QR');
  home.title='Volver al código QR';
  home.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></svg>';
  home.style.cssText='position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2;display:grid;place-items:center;width:48px;height:48px;border:1px solid #dce7ee;border-radius:14px;background:#fffdf6;color:#25394c;cursor:pointer;touch-action:manipulation';
  home.onclick=returnToPairing;
  document.body.append(home);
  addEventListener('keydown',event=>{
    if(event.key.toLowerCase()!=='q'||!event.altKey||!event.shiftKey||event.repeat)return;
    event.preventDefault();
    returnToPairing();
  });
  begin();
}

navigator.serviceWorker?.register('/sw.js').catch(console.error);
