export function voice(){
  let context, analyser, gain, source, resolve, serial=0, utterance, browserLevel=0, target=0, model;
  const samples=new Uint8Array(512);
  function unlock(){
    context??=new AudioContext();
    if(!analyser){analyser=context.createAnalyser();analyser.fftSize=512;gain=context.createGain();analyser.connect(gain).connect(context.destination);}
    context.resume().catch(()=>{});
  }
  function stop(){
    serial++;if(source){source.onended=null;try{source.stop();}catch{}source=null;}
    if(utterance){utterance.onend=utterance.onerror=null;speechSynthesis.cancel();utterance=null;}
    target=0;resolve?.();resolve=null;
  }
  function play(buffer,volume,rate){
    return new Promise((done,reject)=>{
      if(context?.state!=='running'){reject(Error('Audio bloqueado'));return;}
      resolve=done;gain.gain.value=volume;source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;
      source.connect(analyser);source.onended=()=>{source=null;resolve=null;done();};source.start();
    });
  }
  return {unlock,stop,volume(v){if(gain)gain.gain.value=v;},level(){
    if(source){analyser.getByteTimeDomainData(samples);return Math.min(1,Math.sqrt(samples.reduce((s,n)=>s+((n-128)/128)**2,0)/samples.length)*5);}
    browserLevel+=((performance.now()<target?.until?target.amount:0)-browserLevel)*.19;return browserLevel;
  },async clip(name,volume){const id=serial;const data=await fetch('/audio/'+name+'.wav').then(r=>{if(!r.ok)throw Error('Audio');return r.arrayBuffer();});if(!context||id!==serial)return;const decoded=await context.decodeAudioData(data);if(id===serial)await play(decoded,volume,1);},
  async speak(text,volume){
    const id=serial;
    try{
      if(context?.state!=='running')throw Error('Audio bloqueado');
      model??=import('@mintplex-labs/piper-tts-web');
      const piper=await model;
      let timeout;
      const prediction=piper.predict({text,voiceId:'es_ES-davefx-medium'});
      const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Piper tardó en cargar')),18000);});
      const blob=await Promise.race([prediction,deadline]).finally(()=>clearTimeout(timeout));
      if(id!==serial)return;
      const decoded=await context.decodeAudioData(await blob.arrayBuffer());
      if(id!==serial)return;
      await play(decoded,volume,1.13);return 'Piper';
    }catch{
      if(id!==serial)return;
      if(!globalThis.speechSynthesis)throw Error('Sin síntesis disponible');
      await new Promise((done,reject)=>{
        resolve=done;utterance=new SpeechSynthesisUtterance(text);utterance.lang='es-PE';
        utterance.voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('es'))||null;
        utterance.pitch=1.3;utterance.rate=1.1;utterance.volume=volume;
        utterance.onboundary=e=>{target={until:performance.now()+Math.min(400,120+(e.charLength||1)*27),amount:.35};};
        utterance.onend=()=>{resolve=null;utterance=null;done();};
        utterance.onerror=()=>{resolve=null;utterance=null;reject(Error('Síntesis del navegador'));};
        speechSynthesis.speak(utterance);
      });return 'Voz del navegador';
    }
  }};
}


