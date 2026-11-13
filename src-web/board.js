import QRCode from 'qrcode';
import {recognize,validStrokes} from './face.js';
import {connect} from './link.js';
import {voice} from './voice.js';
const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
let pairingTimer, interruption, returning=false;
let mouthOpening=0, mouthRounding=0, speakingPose=0, lastFrame=0;
const gestures=['look','wink','brows','sniff','smile','surprise','squint'];
let gestureIndex=-1, gestureStart=0, nextGesture=0, gestureSide=1;
let strokes=loadBoard(),face=recognize(strokes), timer, link, width,height, pairing, last='', expression='alegría', busy=false, ticket=0,volume=.8, nextBlink=0,blinkStart=-1000, doubleBlink=false, disconnected=false;
const active=new Map();
const audio=voice();
let indexedFace, strokeGroups=[], speechToRetry='';
function loadBoard(){try{const lines=JSON.parse(localStorage.getItem('board-drawing'));return validStrokes(lines)?lines:[];}catch{return [];}}
function saveBoard(){try{localStorage.setItem('board-drawing',JSON.stringify(strokes));}catch{}}
function resize(){width=canvas.clientWidth;height=canvas.clientHeight;const d=Math.min(devicePixelRatio,2);canvas.width=width*d;canvas.height=height*d;ctx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',resize);resize();
function point(e){return [Math.min(1,Math.max(0,e.clientX/width)),Math.min(1,Math.max(0,e.clientY/height))];}
canvas.onpointerdown=e=>{
  audio.unlock();
  if(speechToRetry)say(speechToRetry);
  if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
  if(pairing||face||strokes.length>=100||e.button!==0||e.width>45||e.height>45)return;
  clearTimeout(timer);canvas.setPointerCapture(e.pointerId);
  const line=[point(e)];active.set(e.pointerId,line);strokes.push(line);
};
canvas.onpointermove=e=>{const line=active.get(e.pointerId);if(!line)return;for(const sample of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])if(line.length<500)line.push(point(sample));};
function finish(e){if(!active.delete(e.pointerId)||active.size)return;timer=setTimeout(()=>{face=recognize(strokes);saveBoard();state();},2200);}
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=finish;
function state(){link?.send({type:'state',ready:!!face,busy});}
const moods={alegría:[1,1],sorpresa:[1.35,1.5],confusión:[.8,.9],curiosidad:[1.15,1],risa:[.65,1.6],tristeza:[.8,.65],pensamiento:[.9,.8],entusiasmo:[1.25,1.3]};

function trace(line,transform){
  line.forEach((point,i)=>{
    const [x,y]=transform(point);
    if(i===0)ctx.moveTo(x*width,y*height);else ctx.lineTo(x*width,y*height);
    if(line.length===1)ctx.lineTo(x*width+.01,y*height);
  });
}

function curve(points,move){
  const [x,y]=points[0];
  if(move)ctx.moveTo(x*width,y*height);else ctx.lineTo(x*width,y*height);
  for(let i=1;i<points.length-1;i++){
    const [x,y]=points[i], [nextX,nextY]=points[i+1];
    ctx.quadraticCurveTo(x*width,y*height,(x+nextX)*width*.5,(y+nextY)*height*.5);
  }
  const [endX,endY]=points.at(-1);
  ctx.lineTo(endX*width,endY*height);
}

function openMouth(mouth,amount,lipWidth){
  const {top,bottom,width:span,height:depth}=mouth.profile;
  const opening=Math.min(span*.53,span*.26+depth*.35)*amount;
  const lipX=x=>mouth.x+(x-mouth.x)*lipWidth;
  const upper=top.map(([x,y],i)=>[lipX(x),y-opening*.24*Math.sin(Math.PI*i/(top.length-1))]);
  const lower=bottom.map(([x,y],i)=>[lipX(x),y+opening*.76*Math.sin(Math.PI*i/(bottom.length-1))]);
  ctx.beginPath();curve(upper,true);curve(lower.slice().reverse(),false);ctx.closePath();
  ctx.fillStyle='#3b202a';ctx.fill();
  const middle=upper.length>>1;
  const [x,y]=lower[middle];
  const interior=y-upper[middle][1];
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(x*width,(y-interior*.15)*height,span*width*.28*lipWidth,Math.max(0,interior)*height*.30,0,0,2*Math.PI);
  ctx.fillStyle='#f47c91';ctx.fill();
  ctx.restore();
  ctx.beginPath();curve(upper,true);curve(lower.slice().reverse(),false);ctx.closePath();ctx.stroke();
}

function frame(t){
  requestAnimationFrame(frame);
  const {playing,openness,rounding:roundTarget,emphasis:speech}=audio.speechFrame();
  if(t>nextBlink){
    blinkStart=t;
    doubleBlink=!playing&&Math.random()<.24;
    nextBlink=t+(playing?3200:1900)+Math.random()*(playing?2300:2800);
  }
  const blinkWave=offset=>Math.max(0,1-Math.abs(t-blinkStart-offset-75)/75);
  const blink=Math.max(blinkWave(0),doubleBlink?blinkWave(205):0);
  const dt=Math.min(45,t-lastFrame);
  lastFrame=t;
  speakingPose+=(Number(playing)-speakingPose)*(1-Math.exp(-dt/105));
  mouthRounding+=(roundTarget-mouthRounding)*(1-Math.exp(-dt/18));
  if(face&&t>nextGesture){
    gestureIndex=(gestureIndex+1)%gestures.length;
    gestureStart=t;
    nextGesture=t+(playing?1050:2300)+Math.random()*(playing?650:1300);
    gestureSide=Math.random()<.5?-1:1;
  }
  const gesture=gestures[gestureIndex];
  const progress=Math.min(1,(t-gestureStart)/900);
  const reaction=name=>gesture===name?Math.sin(progress*Math.PI)**2*(playing?.78:1):0;
  const look=reaction('look'), wink=reaction('wink'), brows=reaction('brows');
  const sniff=reaction('sniff'), grin=reaction('smile'), surprise=reaction('surprise'), squint=reaction('squint');
  const sniffMotion=sniff*Math.sin(progress*5*Math.PI);
  mouthOpening+=(openness-mouthOpening)*(1-Math.exp(-dt/(openness>mouthOpening?10:23)));
  const gaze=Math.tanh(Math.sin(t/1030)*2)*.7+Math.sin(t/473)*.13;
  const gazeUp=Math.sin(t/1570)*.45;
  const breath=Math.sin(t/620)*.5+Math.sin(t/1380)*.5;
  const smile=Math.pow(Math.max(0,Math.sin(t/1160)*Math.cos(t/1830)),3);
  const mood=moods[expression]||moods.alegría;
  const talking=playing||mouthOpening>.035;
  const opening=talking?mouthOpening*1.45:Math.max(surprise*.52,grin*.26);
  const lipWidth=talking?1+.19*opening-.46*mouthRounding:1-.32*surprise;
  const emphasis=speech;
  const eyeMotion=1-.77*speakingPose;
  const eyeLook=(gaze+look*gestureSide*.95)*eyeMotion;
  const eyeGazeUp=gazeUp*eyeMotion;
  const eyeMid=face?.[0]?.role==='eye'&&face?.[1]?.role==='eye'?(face[0].x+face[1].x)/2:face?.[0]?.x;
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle='#171819';ctx.lineWidth=Math.max(3,Math.min(width,height)*.008);ctx.lineCap=ctx.lineJoin='round';
  if(face!==indexedFace){
    indexedFace=face;
    strokeGroups=[];
    for(const group of face||[])for(const id of group.ids)strokeGroups[id]=group;
  }
  strokes.forEach((line,i)=>{
    const anchor=strokeGroups[i];
    const role=anchor?.role;
    const pupil=anchor?.pupils?.includes(i);
    if(role==='mouth'&&opening>.025){
      if(i===anchor.ids[0]){
        openMouth(anchor,opening,lipWidth);
        ctx.beginPath();
        for(const id of anchor.details)trace(strokes[id],([x,y])=>[anchor.x+(x-anchor.x)*lipWidth,y+anchor.profile.width*opening*.06]);
        ctx.stroke();
      }
      return;
    }
    const side=(anchor?.x??0)<eyeMid?-1:1;
    const closing=Math.max(blink,side===gestureSide?wink*(1-speakingPose):0);
    const eyeOpen=Math.max(.06,(mood[0]+(breath*.09+surprise*.5-squint*.6)*eyeMotion)*(1-closing*.96));
    const eyeX=(pupil?anchor.w*.13+.001:Math.min(.003,(anchor?.w||0)*.08));
    const transform=([x,y])=>{
      if(role==='eye'){
        x+=eyeLook*eyeX;
        y=anchor.y+(y-anchor.y+(pupil?eyeGazeUp*anchor.h*.13:0))*eyeOpen+eyeGazeUp*.003;
        y-=surprise*.004*eyeMotion;
      }
      if(role==='mouth'){
        const center=Math.max(0,1-Math.abs(x-anchor.x)/.13);
        x=anchor.x+(x-anchor.x)*(1+breath*.04+smile*.07);
        y=anchor.y+(y-anchor.y)*(1+breath*.1);
        y+=center*(smile*.007+grin*.014+(expression==='tristeza'?-.005:0));
      }
      if(role==='brow'){
        const arch=Math.max(0,1-2*Math.abs(x-anchor.x)/anchor.w);
        const lift=anchor.w*(.28*emphasis*(1+anchor.side*.35*Math.sin(t/240))+.08*breath+.24*surprise-.12*squint
          +brows*(anchor.side===gestureSide?.27:.08)+arch*.14*grin+(expression==='sorpresa'?.17:0));
        y-=lift+(x-anchor.x)*anchor.side*(gaze*.15+speech*.10);
      }
      if(role==='lash')y+=closing*.009;
      if(role==='nose'){
        x=anchor.x+(x-anchor.x)*(1+.19*sniff+.11*speech)+sniffMotion*.006+look*gestureSide*.002;
        y=anchor.y+(y-anchor.y)*(1-.22*sniff)+breath*.0015-emphasis*.005-sniff*.005;
      }
      if(role==='cheek'){y-=smile*.005+emphasis*.008;x+=anchor.side*(smile*.002+emphasis*.004);}
      if(role==='ear')x+=(x-anchor.x)*breath*.05;
      return [x,y];
    };
    ctx.beginPath();trace(line,transform);ctx.stroke();
    if(role==='eye'&&anchor.addPupil&&eyeOpen>.13){
      ctx.save();ctx.closePath();ctx.clip();
      const [x,y]=transform([anchor.x+eyeLook*anchor.w*.17,anchor.y+eyeGazeUp*anchor.h*.2]);
      ctx.beginPath();
      const radius=Math.min(anchor.w*width,anchor.h*height)*.115;
      ctx.ellipse(x*width,y*height,radius,Math.max(.35,radius*eyeOpen),0,0,2*Math.PI);
      ctx.fillStyle='#171819';ctx.fill();ctx.restore();
    }
  });
}
requestAnimationFrame(frame);
function stop(){ticket++;speechToRetry='';audio.stop();busy=false;state();}
async function say(text){
  if(!face||!text)return;
  ticket++;
  speechToRetry='';
  audio.stop();
  const turn=ticket;
  busy=true;
  state();
  const report=(provider,reason)=>{if(turn===ticket)link?.send({type:'provider',provider,reason});};
  try{await audio.speak(text,volume,report);}
  catch(error){
    console.warn('Reproducción:',error.message);
    if(turn===ticket&&error.message==='Audio bloqueado'){
      speechToRetry=text;
      report('audio no disponible','blocked');
    }else report('audio no disponible');
  }
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
      case 'say':if(m.value.trim()){last=m.value;say(last);}break;
      case 'snapshot':link.send({type:'snapshot',strokes});break;
      case 'restore':if(validStrokes(m.value)){stop();clearTimeout(timer);active.clear();strokes=m.value;face=recognize(strokes);saveBoard();state();}break;
      case 'correct':face=recognize(strokes,m.value)||face;state();break;
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

  link=connect(session.id,session.token,receive,(online,code)=>{
    clearTimeout(interruption);
    if(code===4000){stop();return;}
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
function prepareBoard(onReady){
  const startup=document.getElementById('startup');
  const status=document.getElementById('startup-status');
  const title=document.getElementById('startup-title');
  const actions=document.getElementById('startup-actions');
  const spinner=startup.querySelector('.startup-spinner');
  let opened=false;
  let attemptId=0;
  const open=()=>{
    if(opened)return;
    opened=true;
    startup.hidden=true;
    onReady();
  };
  async function load(){
    const attempt=++attemptId;
    title.textContent='Preparando la pizarra';
    status.textContent='Cargando la voz. La primera vez puede tardar más mientras se descargan sus archivos.';
    actions.hidden=true;
    spinner.hidden=false;
    const slow=setTimeout(()=>{
      if(attempt!==attemptId||opened)return;
      status.textContent='La voz sigue cargando. Puedes esperar o abrir la pizarra mientras termina.';
      document.getElementById('startup-retry').hidden=true;
      actions.hidden=false;
    },20000);
    try{await audio.prepare();if(attempt===attemptId)open();}
    catch{
      if(attempt!==attemptId||opened)return;
      title.textContent='La voz aún no está lista';
      status.textContent='Puedes reintentar la descarga o abrir la pizarra y preparar la voz después.';
      spinner.hidden=true;
      document.getElementById('startup-retry').hidden=false;
      actions.hidden=false;
    }finally{clearTimeout(slow);}
  }
  document.getElementById('startup-retry').onclick=load;
  document.getElementById('startup-continue').onclick=open;
  void load();
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
  home.style.visibility='hidden';
  const startup=document.getElementById('startup');
  home.onclick=returnToPairing;
  document.body.append(home);
  addEventListener('keydown',event=>{
    if(!startup.hidden)return;
    if(event.key.toLowerCase()!=='q'||!event.altKey||!event.shiftKey||event.repeat)return;
    event.preventDefault();
    returnToPairing();
  });
  prepareBoard(()=>{
    home.style.visibility='';
    begin();
  });
}

navigator.serviceWorker?.register('/sw.js').catch(console.error);


