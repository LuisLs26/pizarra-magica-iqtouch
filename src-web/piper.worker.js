import {predict} from '@mintplex-labs/piper-tts-web';

const voiceId='es_ES-davefx-medium';
let queue=Promise.resolve();

self.onmessage=({data:{id,text,warmup}})=>{
  // Piper keeps a shared inference session for this voice.
  queue=queue.then(async ()=>{
    try{
      const blob=await predict({text,voiceId});
      const audio=warmup?null:await blob.arrayBuffer();
      self.postMessage({id,audio},audio?[audio]:[]);
    }catch(error){
      self.postMessage({id,error:error instanceof Error?error.message:String(error)});
    }
  });
};
