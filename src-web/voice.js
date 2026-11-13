export function voice(){
  let context, analyser, gain, source, resolve, serial=0, model, warmup;
  const samples=new Uint8Array(512);
  const speech={level:0,brightness:0};
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
    resolve?.();resolve=null;
  }
  function play(buffer,volume,rate,onStart){
    return new Promise((done,reject)=>{
      if(context?.state!=='running'){reject(Error('Audio bloqueado'));return;}
      resolve=done;gain.gain.value=volume;source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;
      source.connect(analyser);source.onended=()=>{source=null;resolve=null;done();};source.start();onStart?.();
    });
  }
  prepare();
  return {unlock,stop,volume(v){if(gain)gain.gain.value=v;},speechFrame(){
    let energy=0, highEnergy=0, previous=0;
    if(source){
      analyser.getByteTimeDomainData(samples);
      for(const byte of samples){
        const sample=(byte-128)/128;
        energy+=sample*sample;
        highEnergy+=(sample-previous)**2;
        previous=sample;
      }
    }
    speech.level=Math.sqrt(energy/samples.length);
    speech.brightness=energy>0?Math.min(1,Math.sqrt(highEnergy/energy)*1.7):0;
    return speech;
  },async clip(name,volume){const id=serial;const data=await fetch('/audio/'+name+'.wav').then(r=>{if(!r.ok)throw Error('Audio');return r.arrayBuffer();});if(!context||id!==serial)return;const decoded=await context.decodeAudioData(data);if(id===serial)await play(decoded,volume,1);},
  async speak(text,volume,onStart){
    const id=serial;
    try{
      if(context?.state!=='running')throw Error('Audio bloqueado');
      let timeout;
      const words=text.trim().split(/\s+/);
      let parts=[text];
      if(words.length>10){
        const boundary=words.slice(0,9).findIndex((word,index)=>index>=3&&/[,.!?;:]$/.test(word));
        const split=boundary<0?8:boundary+1;
        parts=[words.slice(0,split).join(' '),words.slice(split).join(' ')];
      }
      const synthesize=part=>getPiper().then(async piper=>{
        const blob=await piper.predict({text:part,voiceId});
        return context.decodeAudioData(await blob.arrayBuffer());
      });
      const prediction=Promise.resolve(warmup).then(()=>id===serial?synthesize(parts[0]):null);
      const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Piper tardó en cargar')),18000);});
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
      throw error;
    }
  }};
}


