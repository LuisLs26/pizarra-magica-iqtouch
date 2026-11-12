export function voice(){
  let context, analyser, gain, source, resolve, serial=0, utterance, browserLevel=0, target=0, model, warmup;
  const samples=new Uint8Array(512);
  const voiceId='es_ES-davefx-medium';
  function getPiper(){
    model??=import('@mintplex-labs/piper-tts-web').catch(error=>{
      model=null;
      throw error;
    });
    return model;
  }
  function prepare(){
    warmup??=getPiper().then(piper=>piper.predict({text:'Hola.',voiceId})).then(()=>{},()=>{
      warmup=null;
    });
  }
  function unlock(){
    prepare();
    context??=new AudioContext();
    if(!analyser){analyser=context.createAnalyser();analyser.fftSize=512;gain=context.createGain();analyser.connect(gain).connect(context.destination);}
    context.resume().catch(()=>{});
  }
  function stop(){
    serial++;if(source){source.onended=null;try{source.stop();}catch{}source=null;}
    if(utterance){utterance.onend=utterance.onerror=null;speechSynthesis.cancel();utterance=null;}
    target=0;resolve?.();resolve=null;
  }
  function play(buffer,volume,rate,onStart){
    return new Promise((done,reject)=>{
      if(context?.state!=='running'){reject(Error('Audio bloqueado'));return;}
      resolve=done;gain.gain.value=volume;source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;
      source.connect(analyser);source.onended=()=>{source=null;resolve=null;done();};source.start();onStart?.();
    });
  }
  prepare();
  return {unlock,stop,volume(v){if(gain)gain.gain.value=v;},level(){
    if(source){analyser.getByteTimeDomainData(samples);return Math.min(1,Math.sqrt(samples.reduce((s,n)=>s+((n-128)/128)**2,0)/samples.length)*5);}
    browserLevel+=((performance.now()<target?.until?target.amount:0)-browserLevel)*.19;return browserLevel;
  },async clip(name,volume){const id=serial;const data=await fetch('/audio/'+name+'.wav').then(r=>{if(!r.ok)throw Error('Audio');return r.arrayBuffer();});if(!context||id!==serial)return;const decoded=await context.decodeAudioData(data);if(id===serial)await play(decoded,volume,1);},
  async speak(text,volume,onStart){
    const id=serial;
    try{
      if(context?.state!=='running')throw Error('Audio bloqueado');
      const localVoice=globalThis.speechSynthesis?.getVoices().find(v=>v.localService&&/^es(?:-|$)/i.test(v.lang));
      const waitForPiper=localVoice?700:18000;
      let timeout;
      const words=text.trim().split(/\s+/);
      let parts=[text];
      if(words.length>13){
        const boundary=words.slice(0,12).findIndex((word,index)=>index>=3&&/[,.!?;:]$/.test(word));
        const split=boundary<0?10:boundary+1;
        parts=[words.slice(0,split).join(' '),words.slice(split).join(' ')];
      }
      const synthesize=part=>getPiper().then(async piper=>{
        const blob=await piper.predict({text:part,voiceId});
        return context.decodeAudioData(await blob.arrayBuffer());
      });
      const prediction=Promise.resolve(warmup).then(()=>id===serial?synthesize(parts[0]):null);
      const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Piper tardó en cargar')),waitForPiper);});
      const first=await Promise.race([prediction,deadline]).finally(()=>clearTimeout(timeout));
      if(id!==serial)return;
      const firstPlayback=play(first,volume,1.31,()=>onStart('Piper'));
      const rest=parts[1]?synthesize(parts[1]).catch(()=>null):null;
      await firstPlayback;
      if(rest&&id===serial){
        const second=await rest;
        if(second&&id===serial)await play(second,volume,1.31);
      }
      return;
    }catch(error){
      if(id!==serial)return;
      console.warn('Piper:',error.message);
      if(!globalThis.speechSynthesis)throw Error('Sin síntesis disponible');
      await new Promise((done,reject)=>{
        const watchdog=setTimeout(()=>{resolve=null;stop();reject(Error('La voz del navegador no se inició'));},8000);
        resolve=()=>{clearTimeout(watchdog);done();};utterance=new SpeechSynthesisUtterance(text);utterance.lang='es-PE';
        utterance.voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('es'))||null;
        utterance.pitch=1.65;utterance.rate=1.1;utterance.volume=volume;
        utterance.onstart=()=>{clearTimeout(watchdog);onStart('Voz del navegador');};
        utterance.onboundary=e=>{target={until:performance.now()+Math.min(400,120+(e.charLength||1)*27),amount:.35};};
        utterance.onend=()=>{clearTimeout(watchdog);resolve=null;utterance=null;done();};
        utterance.onerror=()=>{clearTimeout(watchdog);resolve=null;utterance=null;reject(Error('Síntesis del navegador'));};
        speechSynthesis.speak(utterance);
      });return 'Voz del navegador';
    }
  }};
}


