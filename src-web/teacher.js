import {connect} from './link.js';
import {encodeWav,microphone} from './mic.js';
import {validStrokes} from './face.js';
const $=id=>document.getElementById(id);
let session,link,connected=false,peer=false,ready=false,busy=false,speaking=false,capture,pending,blocked=false,enableId=0,cooldown=0,snapshotAction,points=[];
const audioQueue=[];
let queueTimer;
let openingMic=false;
const load=key=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
let drawings=load('characters'), history=load('history');
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{$('connection').textContent='Almacenamiento local lleno o no disponible';return false;}}
function controls(){
  $('mic').disabled=openingMic||(!capture&&(!peer||!ready||blocked||busy||!!pending||audioQueue.length>0));
  $('mic').textContent=capture?'Toca para enviar':'Toca para hablar';
  for(const button of document.querySelectorAll('[data-action],#save,#correct,#speech button,#end'))button.disabled=!peer;
}
function clearAudioQueue(){clearTimeout(queueTimer);audioQueue.length=0;}
function halt(){clearAudioQueue();enableId++;openingMic=false;capture?.close();capture=null;pending?.abort();pending=null;controls();}
function command(action,value){if(peer)link.send({type:'command',action,value});}
function render(){
  $('drawings').replaceChildren(...drawings.map((drawing,index)=>{
    const li=document.createElement('li');li.append(drawing.name,' ');
    for(const [label,run] of [['Cargar',()=>command('restore',drawing.strokes)],['Exportar',()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(drawing)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='personaje.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }],['Eliminar',()=>{const next=drawings.filter((_,i)=>i!==index);if(persist('characters',next)){drawings=next;render();}}]]){
      const b=document.createElement('button');b.textContent=label;b.onclick=run;li.append(b);
    }
    return li;
  }));
  $('history').replaceChildren(...history.slice().reverse().map(turn=>{
    const li=document.createElement('li');li.textContent=new Date(turn.date).toLocaleString()+' · '+turn.question+' → '+turn.answer;return li;
  }));
}
function receive(m){
  if(m.type==='peer'){peer=true;$('connection').textContent='Pizarra conectada';}
  if(m.type==='peer-left'){peer=false;ready=false;busy=false;speaking=false;$('connection').textContent='Pizarra desconectada. Esperando reconexión…';}
  if(m.type==='state'){ready=m.ready;if(busy&&!m.busy){cooldown=performance.now()+250;speaking=false;}busy=m.busy;drainAudio();}
  if(m.type==='provider'){
    speaking=m.provider==='Piper'||m.provider==='Voz del navegador';
    $('voice').textContent=m.reason==='blocked'
      ?'Toca la pantalla de la pizarra para activar el audio y escuchar la respuesta.'
      :m.provider==='audio no disponible'
        ?'La pizarra no pudo reproducir la voz. Toca Repetir para intentarlo de nuevo.'
        :'Voz de la pizarra · '+m.provider;
  }
  if(m.type==='end'){halt();link.close();peer=false;ready=false;busy=false;speaking=false;sessionStorage.removeItem('teacher');$('connection').textContent='Sesión finalizada. Escanea un nuevo QR.';}
  if(m.type==='snapshot'&&snapshotAction){
    const action=snapshotAction;snapshotAction=null;
    if(action==='save'&&m.strokes.length){
      const name=prompt('Nombre del personaje');
      if(name?.trim()){const next=[...drawings,{name:name.trim().slice(0,80),strokes:m.strokes}];if(persist('characters',next)){drawings=next;render();}}
    }
    if(action==='correct')preview(m.strokes);
  }
  controls();
}
function preview(strokes){
  const canvas=$('preview'),c=canvas.getContext('2d');canvas.hidden=false;points=[];
  c.clearRect(0,0,canvas.width,canvas.height);c.lineWidth=4;c.lineCap='round';
  for(const line of strokes){c.beginPath();line.forEach(([x,y],i)=>i?c.lineTo(x*640,y*360):c.moveTo(x*640,y*360));c.stroke();}
  $('correction').textContent='Toca el ojo izquierdo, el ojo derecho y la boca.';
  canvas.onpointerdown=e=>{
    const r=canvas.getBoundingClientRect();points.push([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);
    $('correction').textContent=['','Ahora toca el ojo derecho.','Ahora toca la boca.','Corrección enviada.'][points.length];
    if(points.length===3){command('correct',points);canvas.hidden=true;}
  };
}
function enqueueAudio(clips){
  if(!peer||!ready||blocked)return;
  if(audioQueue.length===2)audioQueue.shift();
  audioQueue.push({clips,expires:performance.now()+15000});
  drainAudio();
}

function drainAudio(){
  clearTimeout(queueTimer);
  if(!peer||!ready||blocked||pending||busy)return;
  const wait=cooldown-performance.now();
  if(wait>0){queueTimer=setTimeout(drainAudio,wait);return;}
  while(audioQueue[0]?.expires<=performance.now())audioQueue.shift();
  const clip=audioQueue.shift();
  if(clip)submit(clip);
}

async function submit(clip){
  const request=new AbortController();pending=request;controls();
  $('ai').textContent='Whisper está transcribiendo y Gemma está preparando una respuesta…';
  try{
    const send=(route,input)=>fetch('/api/'+route+'/'+session.id,{
      method:'POST',signal:request.signal,
      headers:{'Content-Type':'application/json','X-Pizarra-Send':'manual',Authorization:'Bearer '+session.token},
      body:JSON.stringify(input)
    });
    let input={};
    if(clip.clips.length===1){
      input.audio=encodeWav(clip.clips[0]);
    }else{
      const parts=clip.parts??=[];
      while(parts.length<clip.clips.length){
        const start=parts.length;
        const batch=await Promise.all(clip.clips.slice(start,start+3).map(async wav=>{
          const response=await send('transcribe',{audio:encodeWav(wav)});
          const result=await response.json();
          if(!response.ok){
            if(response.status===429&&/cuota|diario/i.test(result.error)){blocked=true;clearAudioQueue();}
            throw Error(result.error);
          }
          return result.question;
        }));
        parts.push(...batch);
      }
      input.question=parts.filter(Boolean).join(' ');
      if(!input.question){$('ai').textContent='No se detectaron palabras claras.';return;}
    }
    const response=await send('audio',{
      ...input,intensity:$('intensity').value,
      context:history.filter(t=>t.session===session.id).slice(-3).map(({question,answer})=>({question,answer}))
    });
    const m=await response.json();
    if(response.status===409){
      if(!request.signal.aborted&&clip.expires>performance.now()){
        if(audioQueue.length===2)audioQueue.pop();
        audioQueue.unshift(clip);
        cooldown=performance.now()+250;
      }
      return;
    }
    if(!response.ok){
      if(response.status===429&&/cuota|diario/i.test(m.error)){blocked=true;clearAudioQueue();}
      throw Error(m.error);
    }
    if(request.signal.aborted)return;
    if(m.silent){$('ai').textContent='Escuchando. No se detectaron palabras claras.';return;}
    const next=[...history,{question:m.question,answer:m.answer,date:Date.now(),session:session.id}].slice(-300);
    if(persist('history',next)){history=next;render();}
    if(!peer||!link.send({type:'reply',answer:m.answer}))throw Error('La pizarra se desconectó antes de recibir la respuesta');
    cooldown=performance.now()+900;
    $('ai').textContent='Whisper y Gemma respondieron correctamente.';
  }catch(e){if(!request.signal.aborted)$('ai').textContent=e.message;}finally{if(pending===request){pending=null;drainAudio();controls();}}
}
$('mic').onclick=async()=>{
  if(openingMic)return;
  if(capture){
    const clips=capture.finish();
    capture=null;
    if(clips?.length&&peer&&ready)enqueueAudio(clips);
    else if(clips?.length)$('ai').textContent='La pizarra está desconectada. Vuelve a vincularla para enviar otra pregunta.';
    else $('ai').textContent='No se detectó voz. Toca para hablar de nuevo.';
    controls();
    return;
  }
  const id=++enableId;openingMic=true;controls();
  try{
    const recording=await microphone(()=>!speaking,()=>{
      halt();
      $('ai').textContent='El sistema cerró el micrófono. Vuelve a activarlo.';
    });
    if(id!==enableId){recording.close();return;}
    capture=recording;$('ai').textContent='Micrófono activo.';
  }catch(e){if(id===enableId)$('ai').textContent='No se pudo activar el micrófono. Revisa los permisos del navegador.';}
  finally{if(id===enableId){openingMic=false;controls();}}
};
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>{if(['stop','clear'].includes(b.dataset.action)){clearAudioQueue();pending?.abort();pending=null;}command(b.dataset.action);};
$('emotion').onchange=e=>command('emotion',e.target.value.toLowerCase());
$('volume').oninput=e=>command('volume',Number(e.target.value));
$('speech').onsubmit=e=>{e.preventDefault();command('say',$('words').value.trim());};
$('save').onclick=()=>{snapshotAction='save';command('snapshot');};
$('correct').onclick=()=>{snapshotAction='correct';command('snapshot');};
$('erase').onclick=()=>{if(confirm('¿Eliminar el historial de este dispositivo?')&&persist('history',[])){history=[];render();}};
$('import').onchange=async e=>{
  try{
    const file=e.target.files[0];if(!file||file.size>1600000)throw Error();
    const {name,strokes}=JSON.parse(await file.text());
    if(typeof name!=='string'||!name.trim()||!validStrokes(strokes)||!strokes.length)throw Error();
    const next=[...drawings,{name:name.slice(0,80),strokes}];if(persist('characters',next)){drawings=next;render();}
  }catch{$('correction').textContent='Archivo de personaje inválido.';}finally{e.target.value='';}
};
$('end').onclick=()=>{halt();link?.send({type:'end'});};
async function start(){
  const [id,invite]=location.hash.slice(1).split('.');
  session=JSON.parse(sessionStorage.getItem('teacher')||'null');
  if(id&&invite&&session?.id!==id){
    const response=await fetch('/api/claim/'+encodeURIComponent(id),{method:'POST',headers:{'X-Invite':invite}});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    session={id,...data};sessionStorage.setItem('teacher',JSON.stringify(session));
  }
  if(id)window.history.replaceState(null,'',location.pathname);
  if(!session||session.expires<Date.now())throw Error('Escanea el QR que aparece en la pizarra.');
  link=connect(session.id,session.token,receive,online=>{
    connected=online;
    if(!online){peer=false;ready=false;busy=false;speaking=false;pending?.abort();}
    $('connection').textContent=connected?'Esperando a la pizarra…':'Reconectando…';controls();
  });
}
render();controls();start().catch(e=>{$('connection').textContent=e.message;});
navigator.serviceWorker?.register('/sw.js').catch(console.error);
