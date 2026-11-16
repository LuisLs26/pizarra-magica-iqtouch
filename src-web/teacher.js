import {connect} from './link.js';
import {validStrokes} from './face.js';
const $=id=>document.getElementById(id);
let session,link,connected=false,peer=false,ready=false,busy=false,pending,blocked=false,snapshotAction,points=[];
let drawn=false,needsCorrection=false;
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let recognition,stopping=false,dictationTimer;
const load=key=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
let drawings=load('characters'), history=load('history');
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{$('connection').textContent='Almacenamiento local lleno o no disponible';return false;}}
function controls(){
  const canAsk=peer&&ready&&!blocked&&!busy&&!pending;
  $('animate').disabled=!peer||!drawn||ready;
  $('animation-status').textContent=!peer?'':needsCorrection
    ?'No se reconoció el rostro. Completa el dibujo o usa Corregir rostro.'
    :ready?'El personaje está vivo.':drawn?'Pulsa Dar vida cuando termines de dibujar.':'Dibuja el personaje en la pizarra.';
  $('mic').disabled=!SpeechRecognition||stopping||(!recognition&&!canAsk);
  $('mic').textContent=recognition?'Terminar dictado':'Toca para hablar';
  $('question').readOnly=!!recognition;
  $('send-question').disabled=!canAsk||!!recognition||!$('question').value.trim();
  for(const button of document.querySelectorAll('[data-action],#save,#correct,#speech button,#end'))button.disabled=!peer;
}
function finishDictation(instance){
  if(recognition!==instance)return false;
  clearTimeout(dictationTimer);
  recognition=null;
  stopping=false;
  controls();
  return true;
}
function halt(){
  const instance=recognition;
  if(instance&&finishDictation(instance))instance.abort();
  pending?.abort();
  pending=null;
  controls();
}
function losePeer(){
  const interrupted=recognition||pending;
  peer=false;ready=false;busy=false;drawn=false;needsCorrection=false;
  halt();
  if(interrupted)$('ai').textContent='Se interrumpió la conexión. Tu texto sigue aquí para enviarlo cuando vuelva.';
}
function command(action,value){return peer&&link.send({type:'command',action,value});}
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
  if(m.type==='peer-left'){losePeer();$('connection').textContent='Pizarra desconectada. Esperando reconexión…';}
  if(m.type==='state'){ready=m.ready;busy=m.busy;drawn=m.drawn;needsCorrection=m.needsCorrection;}
  if(m.type==='provider'){
    $('voice').textContent=m.reason==='blocked'
      ?'Toca la pantalla de la pizarra para activar el audio y escuchar la respuesta.'
      :m.provider==='audio no disponible'
        ?'La pizarra no pudo reproducir la voz. Toca Repetir para intentarlo de nuevo.'
        :'Voz de la pizarra · '+m.provider;
  }
  if(m.type==='end'){halt();link.close();peer=false;ready=false;busy=false;sessionStorage.removeItem('teacher');$('connection').textContent='Sesión finalizada. Escanea un nuevo QR.';}
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
function startDictation(){
  const instance=new SpeechRecognition();
  recognition=instance;
  stopping=false;
  const field=$('question');
  const prefix=field.value.trim();
  instance.lang='es-PE';
  instance.continuous=true;
  instance.interimResults=true;
  instance.onresult=event=>{
    if(recognition!==instance)return;
    const transcript=Array.from(event.results,result=>result[0]?.transcript.trim()).filter(Boolean).join(' ');
    field.value=[prefix,transcript].filter(Boolean).join(' ').slice(0,field.maxLength);
  };
  instance.onstart=()=>{if(recognition===instance)$('ai').textContent='Escuchando. Tu pregunta todavía no se ha enviado.';};
  instance.onend=()=>{
    if(!finishDictation(instance))return;
    $('ai').textContent=field.value.trim()?'Revisa el texto y pulsa Enviar a Gemma.':'No se reconoció voz. Intenta de nuevo o escribe la pregunta.';
  };
  instance.onerror=event=>{
    if(!finishDictation(instance))return;
    $('ai').textContent=event.error==='not-allowed'
      ?'Permite el micrófono en Chrome o escribe la pregunta.'
      :event.error==='network'
        ?'El dictado no pudo conectarse. Puedes escribir la pregunta.'
        :'El dictado se interrumpió. Puedes editar el texto o volver a dictar.';
  };
  try{
    instance.start();
    $('ai').textContent='Activando el micrófono…';
    controls();
  }catch{
    finishDictation(instance);
    $('ai').textContent='No se pudo iniciar el dictado. Puedes escribir la pregunta.';
  }
}
$('mic').onclick=()=>{
  if(stopping)return;
  if(recognition){
    const instance=recognition;
    stopping=true;controls();
    dictationTimer=setTimeout(()=>{
      if(!finishDictation(instance))return;
      instance.abort();
      $('ai').textContent='Revisa el texto y pulsa Enviar a Gemma.';
    },3500);
    try{instance.stop();}catch{if(finishDictation(instance))$('ai').textContent='Revisa el texto y pulsa Enviar a Gemma.';}
  }else if(SpeechRecognition&&peer&&ready&&!busy&&!pending&&!blocked)startDictation();
};
$('question').oninput=controls;
$('send-question').onclick=async()=>{
  const field=$('question');
  const draft=field.value;
  const question=draft.trim();
  if(!question||recognition||pending||!peer||!ready||busy||blocked)return;
  const request=new AbortController();
  pending=request;controls();
  $('ai').textContent='Gemma está preparando la respuesta…';
  try{
    const response=await fetch('/api/question/'+session.id,{
      method:'POST',signal:request.signal,
      headers:{'Content-Type':'application/json','X-Pizarra-Send':'manual',Authorization:'Bearer '+session.token},
      body:JSON.stringify({
        question,intensity:$('intensity').value,
        context:history.filter(t=>t.session===session.id).slice(-3).map(({question,answer})=>({question,answer}))
      })
    });
    const data=await response.json();
    if(request.signal.aborted)return;
    if(!response.ok){
      if(response.status===429&&/cuota|diario/i.test(data.error))blocked=true;
      throw Error(data.error);
    }
    if(!peer||!link.send({type:'reply',answer:data.answer}))throw Error('La pizarra se desconectó antes de recibir la respuesta.');
    if(field.value===draft)field.value='';
    const next=[...history,{question,answer:data.answer,date:Date.now(),session:session.id}].slice(-300);
    if(persist('history',next)){history=next;render();}
    $('ai').textContent='Respuesta enviada a la pizarra.';
  }catch(error){if(!request.signal.aborted)$('ai').textContent=error.message;}
  finally{if(pending===request){pending=null;controls();}}
};
$('animate').onclick=()=>{if(drawn&&!ready)command('animate');};
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>{if(['stop','clear'].includes(b.dataset.action)){halt();}command(b.dataset.action);};
$('emotion').onchange=e=>command('emotion',e.target.value.toLowerCase());
$('volume').oninput=e=>command('volume',Number(e.target.value));
$('speech').onsubmit=e=>{
  e.preventDefault();
  const text=$('words').value.trim();
  if(!text)return;
  if(!ready){$('voice').textContent='Dibuja un rostro en la pizarra antes de enviar el texto.';return;}
  $('voice').textContent=command('say',text)
    ?'Texto enviado. Preparando la voz…'
    :'Se perdió la conexión con la pizarra. Vuelve a enviar el texto.';
};
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
  if(id&&invite){
    const response=await fetch('/api/claim/'+encodeURIComponent(id),{method:'POST',headers:{'X-Invite':invite}});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    session={id,...data};sessionStorage.setItem('teacher',JSON.stringify(session));
  }
  if(id)window.history.replaceState(null,'',location.pathname+location.search);
  if(!session||session.expires<Date.now())throw Error('Escanea el QR que aparece en la pizarra.');
  link=connect(session.id,session.token,receive,(online,code)=>{
    connected=online;
    if(!online)losePeer();
    if(code===4000){
      sessionStorage.removeItem('teacher');
      $('connection').textContent='El control pasó a otro dispositivo. Escanea el mismo QR para recuperarlo.';
      return;
    }
    $('connection').textContent=connected?'Esperando a la pizarra…':'Reconectando…';controls();
  });
}
addEventListener('hashchange',()=>{if(location.hash)location.reload();});
if(!SpeechRecognition)$('ai').textContent='El dictado no está disponible en este navegador. Abre el panel en Chrome o escribe tu pregunta.';
render();controls();start().catch(e=>{$('connection').textContent=e.message;});
navigator.serviceWorker?.register('/sw.js').catch(console.error);
