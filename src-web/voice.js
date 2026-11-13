const frameSeconds=.012;
const silentFrame=Object.freeze({playing:false,openness:0,rounding:0,emphasis:0});

export function analyzeSpeech(buffer){
  const samples=buffer.getChannelData(0);
  const step=Math.max(1,Math.round(buffer.sampleRate*frameSeconds));
  const levels=new Float32Array(Math.ceil(samples.length/step));
  const brightness=new Float32Array(levels.length);
  for(let i=0;i<levels.length;i++){
    const start=i*step,end=Math.min(start+step,samples.length);
    let energy=0,difference=0,previous=samples[start];
    for(let j=start;j<end;j++){
      const sample=samples[j];
      energy+=sample*sample;
      difference+=(sample-previous)**2;
      previous=sample;
    }
    levels[i]=Math.sqrt(energy/(end-start));
    brightness[i]=energy?Math.min(1,Math.sqrt(difference/energy)*1.9):0;
  }
  const audible=Array.from(levels).filter(level=>level>.001).sort((a,b)=>a-b);
  const reference=Math.max(.004,audible[Math.floor(audible.length*.9)]||0);
  const floor=Math.max(.001,reference*.065);
  return {levels,brightness,reference,floor,stepSeconds:step/buffer.sampleRate,duration:buffer.duration};
}

export function sampleSpeech(track,seconds){
  if(seconds<0||seconds>=track.duration)return silentFrame;
  const position=Math.max(0,seconds/track.stepSeconds-.5);
  const index=Math.floor(position), mix=position-index;
  const interpolate=values=>{
    const first=values[index]||0;
    return first+((values[index+1]??first)-first)*mix;
  };
  const power=Math.min(1,Math.max(0,(interpolate(track.levels)-track.floor)/track.reference));
  const brightness=interpolate(track.brightness);
  return {
    playing:true,
    openness:power**.72*(.96-.42*brightness),
    rounding:Math.sqrt(power)*(1-brightness),
    emphasis:Math.sqrt(power)
  };
}

export function voice(){
  let context, gain, playback, articulation, serial=0, model, warmup;
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
    if(!gain){gain=context.createGain();gain.connect(context.destination);}
    context.resume().catch(()=>{});
  }
  function stop(){
    serial++;
    articulation=null;
    if(!playback)return;
    const {source,done}=playback;
    playback=null;
    source.onended=null;
    try{source.stop();}catch{}
    source.disconnect();
    done();
  }
  function play(buffer,volume,rate,onStart){
    return new Promise((done,reject)=>{
      if(context?.state!=='running'){reject(Error('Audio bloqueado'));return;}
      const track=analyzeSpeech(buffer);
      const source=context.createBufferSource();
      gain.gain.value=volume;
      source.buffer=buffer;
      source.playbackRate.value=rate;
      source.connect(gain);
      const started=context.currentTime+.015;
      source.onended=()=>{
        if(playback?.source===source)playback=null;
        source.disconnect();
        done();
      };
      source.start(started);
      playback={source,done};
      articulation={track,started,rate};
      onStart?.();
    });
  }
  prepare();
  return {unlock,stop,volume(v){if(gain)gain.gain.value=v;},speechFrame(){
    if(!articulation||context.state!=='running')return silentFrame;
    const stamp=context.getOutputTimestamp?.();
    const time=stamp?.performanceTime>0
      ?Math.min(context.currentTime,stamp.contextTime+(performance.now()-stamp.performanceTime)/1000)
      :context.currentTime;
    const {track,started,rate}=articulation;
    const seconds=(time-started)*rate;
    if(seconds>=track.duration)articulation=null;
    return sampleSpeech(track,seconds);
  },async clip(name,volume){const id=serial;const data=await fetch('/audio/'+name+'.wav').then(r=>{if(!r.ok)throw Error('Audio');return r.arrayBuffer();});if(!context||id!==serial)return;const decoded=await context.decodeAudioData(data);if(id===serial)await play(decoded,volume,1);},
  async speak(text,volume,onStart){
    const id=serial;
    try{
      if(context?.state!=='running')throw Error('Audio bloqueado');
      let timeout;
      const prediction=Promise.resolve(warmup).then(async ()=>{
        if(id!==serial)return null;
        const piper=await getPiper();
        if(id!==serial)return null;
        const blob=await piper.predict({text,voiceId});
        return context.decodeAudioData(await blob.arrayBuffer());
      });
      const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Piper tardó en cargar')),18000);});
      const buffer=await Promise.race([prediction,deadline]).finally(()=>clearTimeout(timeout));
      if(id!==serial)return;
      await play(buffer,volume,1.31,()=>onStart?.('Piper'));
    }catch(error){
      if(id!==serial)return;
      throw error;
    }
  }};
}


