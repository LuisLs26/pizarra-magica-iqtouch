import test from 'node:test';
import assert from 'node:assert/strict';
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
test('rechaza formas sin ojos y boca',()=>{
  assert.equal(recognize([mouth]),null);
  assert.equal(recognize([...eyes,[[.4,.13],[.6,.14]]]),null);
});
const oval=(x,y,w,h)=>Array.from({length:17},(_,i)=>{
  const angle=i*Math.PI/8;
  return [x+Math.cos(angle)*w/2,y+Math.sin(angle)*h/2];
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
