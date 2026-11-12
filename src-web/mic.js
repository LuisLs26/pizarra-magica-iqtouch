export function wav(samples, rate){
  const ratio=rate/16000,count=Math.floor(samples.length/ratio),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
  const tag=(i,s)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));
  tag(0,'RIFF');v.setUint32(4,36+count*2,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){let sum=0,n=0;for(let j=Math.floor(i*ratio);j<Math.floor((i+1)*ratio);j++){sum+=samples[j];n++;}v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,n?sum/n:samples[Math.floor(i*ratio)]))*32767),true);}
  return new Uint8Array(buffer);
}
export async function microphone(allowed,submit,ended){
  const ctx=new AudioContext();
  let stream;
  try{
    await ctx.resume();
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    await ctx.audioWorklet.addModule('/capture.js');
    const node=new AudioWorkletNode(ctx,'capture');
    ctx.createMediaStreamSource(stream).connect(node).connect(ctx.destination);
    let frames=[],speech=0,silence=0,started=false,noise=.004,closed=false;
    const idleTimer=setTimeout(()=>{if(!started)finish();},12000);
    function close(){
      if(closed)return;
      closed=true;
      clearTimeout(idleTimer);
      node.port.onmessage=null;
      stream.getTracks().forEach(track=>track.stop());
      ctx.close().catch(()=>{});
    }
    function finish(){
      if(closed)return;
      const duration=(frames[0]?.length||1)/ctx.sampleRate;
      close();
      if(!allowed()||speech<.18){submit(null);return;}
      if(silence>.12)frames.length-=Math.min(frames.length-1,Math.floor((silence-.12)/duration));
      const all=new Float32Array(frames.reduce((total,frame)=>total+frame.length,0));
      let index=0;
      for(const frame of frames){all.set(frame,index);index+=frame.length;}
      const bytes=wav(all,ctx.sampleRate);
      let str='';
      for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192));
      submit(btoa(str));
    }
    node.port.onmessage=({data})=>{
      if(!allowed()){close();submit(null);return;}
      const duration=data.length/ctx.sampleRate;
      const rms=Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);
      const loud=rms>Math.max(.012,noise*3);
      if(!started&&!loud)noise=noise*.96+rms*.04;
      if(loud){speech+=duration;silence=0;if(speech>=.11)started=true;}
      else{silence+=duration;if(!started&&silence>.15)speech=0;}
      frames.push(data);
      if(!started){while(frames.length>Math.ceil(.25/duration))frames.shift();return;}
      if(silence>=.4||frames.length*duration>=8)finish();
    };
    stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(!closed){close();ended();}},{once:true}));
    return {close,finish};
  }catch(error){
    stream?.getTracks().forEach(track=>track.stop());
    ctx.close().catch(()=>{});
    throw error;
  }
}