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
