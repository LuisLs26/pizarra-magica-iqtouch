import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {recognize,validStrokes} from '../src-web/face.js';
import {wav} from '../src-web/mic.js';
import worker,{Room} from '../worker.js';
const eyes=[[[.25,.27],[.28,.24],[.33,.27],[.29,.31],[.25,.27]],[[.63,.25],[.69,.26],[.67,.32],[.63,.25]]];
const mouth=[[.36,.48],[.44,.53],[.53,.54],[.61,.48]];
test('clasifica una cara aunque la boca se dibuje primero',()=>{
  assert.deepEqual(recognize([mouth,...eyes]).map(g=>g.ids),[[1],[2],[0]]);
});
test('asocia la pupila con su contorno',()=>{
  assert.deepEqual(recognize([...eyes,mouth,[[.28,.27]]])[0].ids,[0,3]);
});
test('prioriza la línea inferior frente a una nariz más centrada',()=>{
  const nose=[[.42,.48],[.46,.51],[.51,.48]];
  const lowerLine=[[.48,.67],[.56,.67]];
  for(const [first,second,mouthId,noseId] of [[nose,lowerLine,3,2],[lowerLine,nose,2,3]]){
    const face=recognize([...eyes,first,second]);
    assert.deepEqual(face.find(group=>group.role==='mouth').ids,[mouthId]);
    assert.deepEqual(face.find(group=>group.role==='nose').ids,[noseId]);
  }
});
test('rechaza formas sin ojos y boca',()=>{
  assert.equal(recognize([mouth]),null);
  assert.equal(recognize([...eyes,[[.4,.13],[.6,.14]]]),null);
});
const oval=(x,y,w,h)=>Array.from({length:17},(_,i)=>{
  const angle=i*Math.PI/8;
  return [x+Math.cos(angle)*w/2,y+Math.sin(angle)*h/2];
});
test('mantiene los dos ojos aunque uno esté más abajo y haya cejas y pupilas',()=>{
  const left=oval(.32,.28,.12,.10), right=oval(.65,.41,.11,.095);
  const line=[[.43,.61],[.55,.63]];
  const brow=[[.60,.31],[.66,.29],[.71,.32]];
  const drawing=[brow,right,[[.65,.41]],line,left,[[.32,.28]]];
  assert.deepEqual(recognize(drawing).slice(0,3).map(group=>group.ids),[[4,5],[1,2],[3]]);
  assert.equal(recognize(drawing.filter(stroke=>stroke!==line)),null);
});
test('anima cejas, pupilas dibujadas y detalles sin confundirlos con ojos o boca',()=>{
  const strokes=[
    oval(.50,.44,.70,.75), [[.27,.20],[.31,.18],[.37,.20]], oval(.68,.31,.12,.09),
    [[.31,.30]], mouth, oval(.32,.30,.13,.12), [[.64,.21],[.68,.19],[.73,.22]],
    [[.50,.34],[.48,.41],[.52,.42]], [[.27,.39],[.32,.41]], oval(.89,.34,.08,.11)
  ];
  const face=recognize(strokes);
  assert.deepEqual(face.slice(0,3).map(group=>group.ids),[[5,3],[2],[4]]);
  assert.equal(face[1].addPupil,true);
  assert.deepEqual(face.slice(3).map(group=>group.role),['brow','brow','nose','cheek','ear']);
  assert.deepEqual(recognize(strokes,[[.68,.31],[.31,.30],[.49,.52]]).slice(0,3).map(group=>group.ids),[[5,3],[2],[4]]);
});
test('reconoce ojos de punto, rostros inclinados y un perfil con contorno',()=>{
  const dots=[[[.33,.30]],[[.65,.30]],mouth];
  assert.deepEqual(recognize(dots).map(group=>group.role),['eye','eye','mouth']);
  const tilt=([x,y])=>[.5+(x-.5)*.94-(y-.4)*.34,.4+(x-.5)*.34+(y-.4)*.94];
  assert.deepEqual(recognize([...eyes,mouth].map(line=>line.map(tilt))).map(group=>group.role),['eye','eye','mouth']);
  const profile=[oval(.49,.46,.54,.70),oval(.62,.31,.10,.08),[[.57,.53],[.62,.55],[.70,.53]]];
  assert.deepEqual(recognize(profile).map(group=>group.role),['eye','mouth']);
});
test('genera perfiles de labios para una línea, dos trazos y una boca ovalada',()=>{
  const lips=[[.37,.57],[.46,.59],[.55,.59],[.60,.56]];
  const single=recognize([...eyes,mouth])[2].profile;
  assert.deepEqual(single.top,single.bottom);
  const double=recognize([...eyes,mouth,lips])[2];
  assert.equal(double.ids.length,2);
  assert.ok(double.profile.bottom[12][1]>double.profile.top[12][1]);
  const ovalMouth=recognize([...eyes,oval(.49,.52,.11,.18)])[2].profile;
  assert.ok(ovalMouth.bottom[12][1]-ovalMouth.top[12][1]>.15);
});
test('valida límites e integridad de dibujos importados',()=>{
  assert.equal(validStrokes(eyes),true);
  for(const invalid of [null,[[]],[[[0,Infinity]]],[[[-.1,.2]]],[[['.2',.1]]]])assert.equal(validStrokes(invalid),false);
});
test('convierte audio a WAV PCM mono 16 kHz',()=>{
  const bytes=wav(Float32Array.from({length:4800},()=>.25),48000),v=new DataView(bytes.buffer);
  assert.equal(Buffer.from(bytes).subarray(0,4).toString(),'RIFF');
  assert.equal(v.getUint32(24,true),16000);
  assert.equal(v.getUint32(40,true),3200);
  assert.equal(v.getInt16(44,true),8192);
});
test('hay cuatro clips WAV de emergencia con datos',async()=>{
  for(const id of ['offline-1','offline-2','offline-3','online']){
    const data=await readFile(new URL('../src-web/public/audio/'+id+'.wav',import.meta.url));
    assert.equal(data.toString('ascii',0,4),'RIFF');assert.ok(data.length>10000);
  }
});
test('la API bloquea orígenes externos',async()=>{
  const r=await worker.fetch(new Request('https://board.test/api/session',{method:'POST',headers:{Origin:'https://elsewhere.test'}}),{});
  assert.equal(r.status,403);
});
test('un token ajeno no puede iniciar inferencias',async()=>{
  const room=new Room({storage:{get:async()=>({teacher:'authorized',expires:Date.now()+10000})}},{});
  const r=await room.fetch(new Request('https://board.test/api/audio/id',{method:'POST',headers:{Authorization:'Bearer unauthorized'}}));
  assert.equal(r.status,403);
});
test('el mismo QR transfiere el control y desactiva el teléfono anterior',async()=>{
  let stored={invite:'qr-original',teacher:'anterior',expires:Date.now()+10000,inviteUntil:0};
  const revoked=[];
  const phone={deserializeAttachment:()=>({token:'anterior'}),close:code=>revoked.push(code)};
  const storage={
    get:async()=>structuredClone(stored),
    put:async(_key,room)=>{stored=structuredClone(room);},
    transaction:callback=>callback(storage)
  };
  const room=new Room({storage,getWebSockets:role=>role==='teacher'?[phone]:[]},{});
  const claim=invite=>room.fetch(new Request('https://board.test/api/claim/id',{method:'POST',headers:{'X-Invite':invite}}));
  assert.equal((await claim('otro-qr')).status,403);
  assert.equal(stored.teacher,'anterior');
  const first=await (await claim('qr-original')).json();
  const second=await (await claim('qr-original')).json();
  assert.notEqual(first.token,second.token);
  assert.equal(second.token,stored.teacher);
  assert.equal(stored.invite,'qr-original');
  assert.equal(second.expires,first.expires);
  assert.ok(revoked.every(code=>code===4000)&&revoked.length>0);
  const response=await room.fetch(new Request('https://board.test/api/audio/id',{method:'POST',headers:{Authorization:'Bearer '+first.token}}));
  assert.equal(response.status,403);
  stored.expires=0;
  assert.equal((await claim('qr-original')).status,410);
});
test('la casita y una recarga recuperan el mismo QR sin crear otra sesión',async()=>{
  const source=await readFile(new URL('../src-web/board.js',import.meta.url),'utf8');
  const functions=source.slice(source.indexOf('function hidePairing()'),source.indexOf('function prepareBoard'));
  const stored=new Map();
  const shown=[];
  let created=0;
  let now=100;
  const globals={
    sessionStorage:{
      getItem:key=>stored.get(key),
      setItem:(key,value)=>stored.set(key,value),
      removeItem:key=>stored.delete(key)
    },
    Date:{now:()=>now},URL,location:{origin:'https://board.test'},
    document:{createElement:()=>({querySelector:()=>({}),remove(){}}),body:{append(){}}},
    QRCode:{toCanvas:async(_canvas,url)=>shown.push(url)},
    fetch:async()=>{
      created++;
      return Response.json({id:'room',token:'board',invite:'reusable',expires:1000,inviteUntil:120});
    },
    connect:()=>({close(){}}),receive(){},stop(){},
    setTimeout:()=>1,clearTimeout(){}
  };
  const makeBoard=()=>runInNewContext(
    'let session,pairing,sessionTimer,interruption,link;\n'+functions+'\n({start,hidePairing,returnToPairing})',{...globals}
  );
  const board=makeBoard();
  await board.start();
  stored.set('paired','1');
  board.hidePairing();
  board.returnToPairing();
  now=500;
  const reloaded=makeBoard();
  await reloaded.start();
  reloaded.returnToPairing();
  assert.equal(created,1);
  assert.deepEqual(shown,Array(3).fill('https://board.test/teacher?mic=dictado-v3#room.reusable'));
});
test('el dictado confirmado llega como texto a Gemma y elimina la pregunta de cierre',async()=>{
  const modelCalls=[];
  const room=new Room({
    storage:{get:async()=>({teacher:'authorized',expires:Date.now()+10000})},
    getWebSockets:()=>[{deserializeAttachment:()=>({ready:true})}]
  },{
    BUDGET:{getByName:()=>({fetch:async()=>new Response()})},
    AI:{run:async(model,input)=>{
      modelCalls.push({model,input});
      return {response:'Un gato duerme mucho. Trabaja de inspector de almohadas. ¿Quieres saber algo más?'};
    }}
  });
  const send=body=>room.fetch(new Request('https://board.test/api/question/id',{
    method:'POST',body,
    headers:{Authorization:'Bearer authorized','X-Pizarra-Send':'manual','Content-Length':Buffer.byteLength(body)}
  }));
  assert.equal((await send('{"audio":"UklGR"}')).status,400);
  const response=await send(JSON.stringify({question:'¿Por qué duerme tanto mi gato?',intensity:'alta'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).answer,'Un gato duerme mucho. Trabaja de inspector de almohadas.');
  assert.equal(modelCalls.length,1);
  assert.match(modelCalls[0].model,/gemma/);
  assert.match(modelCalls[0].input.messages[0].content,/Jamás cierres con una pregunta/);
  assert.equal(modelCalls[0].input.messages.at(-1).content,'¿Por qué duerme tanto mi gato?');
});
test('activar, transcribir y terminar el dictado no envían una pregunta',async()=>{
  const source=await readFile(new URL('../src-web/teacher.js',import.meta.url),'utf8');
  const fields=new Map();
  const requests=[],messages=[];
  let service,receive;
  const field=id=>{
    if(!fields.has(id))fields.set(id,{value:'',maxLength:2000,replaceChildren(){}});
    return fields.get(id);
  };
  runInNewContext(source.replace(/^import .*\r?\n/gm,''),{
    frejolitoScript:[],
    window:{webkitSpeechRecognition:class{
      constructor(){service=this;}
      start(){this.onstart();}
      stop(){this.onend();}
      abort(){}
    }},
    document:{getElementById:field,querySelectorAll:()=>[]},
    location:{hash:''},navigator:{},addEventListener(){},
    localStorage:{getItem:()=>null,setItem(){throw Error('almacenamiento no disponible')}},
    sessionStorage:{getItem:()=>JSON.stringify({id:'room',token:'token',expires:Date.now()+10000})},
    connect(_id,_token,handler){receive=handler;return {send:message=>messages.push(message)};},
    AbortController,setTimeout,clearTimeout,
    fetch:async(url,options)=>{
      requests.push({url,body:JSON.parse(options.body)});
      return Response.json({answer:'Un gato tiene sueño de campeón.'});
    }
  });
  receive({type:'peer'});
  receive({type:'state',ready:true,busy:false});
  field('mic').onclick();
  assert.equal(field('send-question').disabled,true);
  service.onresult({results:[[{transcript:'Qué hace mi gato'}]]});
  assert.equal(field('question').value,'Qué hace mi gato');
  assert.equal(requests.length,0);
  service.onend();
  assert.equal(field('send-question').disabled,false);
  assert.equal(requests.length,0);
  field('question').value='¿Qué hace mi gato?';
  await field('send-question').onclick();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/question/room');
  assert.equal(requests[0].body.question,'¿Qué hace mi gato?');
  assert.equal(messages.at(-1).answer,'Un gato tiene sueño de campeón.');
});
test('solo el control activa el dibujo y permite preguntar',async()=>{
  const source=await readFile(new URL('../src-web/board.js',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('const canvas='),source.indexOf('const moods='));
  const stop=source.slice(source.indexOf('function stop()'),source.indexOf('async function say('));
  const handler=source.slice(source.indexOf('function receive('),source.indexOf('function hidePairing('));
  const events=[];
  const saved=new Map();
  const canvas={clientWidth:1000,clientHeight:1000,setPointerCapture(){},getContext:()=>({setTransform(){}})};
  const remote=runInNewContext(snippet+stop+handler+
    '\nlink={send:state=>events.push(state)}; ({receive,canvas,state});',{
    recognize,validStrokes,events,devicePixelRatio:1,addEventListener(){},
    window:{},document:{querySelector:()=>canvas,fullscreenElement:true},
    localStorage:{getItem:key=>key==='board-drawing'?JSON.stringify([...eyes,mouth]):null,setItem:(key,value)=>saved.set(key,JSON.parse(value))},
    voice:()=>({unlock(){},stop(){}})
  });
  const command=(action,value)=>remote.receive({type:'command',action,value});
  remote.state();
  assert.equal(events.at(-1).ready,false);
  assert.equal(events.at(-1).drawn,true);
  const pointer={pointerId:1,clientX:450,clientY:300,button:0,width:1,height:1};
  remote.canvas.onpointerdown(pointer);
  command('animate');
  assert.equal(events.at(-1).ready,false);
  remote.canvas.onpointerup(pointer);
  assert.equal(events.at(-1).ready,false);
  command('animate');
  assert.equal(events.at(-1).ready,true);
  const drawing=JSON.stringify(saved.get('board-drawing'));
  remote.canvas.onpointerdown({...pointer,pointerId:2,clientX:850});
  remote.canvas.onpointermove({...pointer,pointerId:2,clientX:900});
  remote.canvas.onpointerup({pointerId:2});
  assert.equal(events.at(-1).ready,true);
  assert.equal(JSON.stringify(saved.get('board-drawing')),drawing);
  assert.equal(saved.get('board-notes').length,1);
  command('clear-notes');
  assert.equal(saved.get('board-notes').length,0);
  assert.equal(events.at(-1).ready,true);
  command('restore',[...eyes,mouth]);
  assert.equal(events.at(-1).ready,false);
  command('clear');
  assert.equal(events.at(-1).drawn,false);
});
