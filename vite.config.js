import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const piperRuntime=()=>({name:'piper-bundled-runtime',enforce:'pre',transform(code,id){
  if(!id.includes('piper-tts-web'))return;
  const cdn=/(['"])https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/onnxruntime-web\/1\.18\.0\/\1/g;
  const bundled=code.replace(cdn,'undefined');
  if(bundled!==code)return bundled;
}});
export default {
  root:'src-web',
  build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:{board:'src-web/index.html',teacher:'src-web/teacher.html'}}},
  worker:{format:'es',plugins:()=>[piperRuntime()]},
  plugins:[piperRuntime(),{name:'offline-cache',apply:'build',closeBundle(){
    const worker=readFileSync('dist/sw.js','utf8');
    const files=['/','/teacher','/capture.js',...readdirSync('dist/assets').map(f=>'/assets/'+f),...readdirSync('dist/audio').map(f=>'/audio/'+f)];
    const version=createHash('sha256').update(JSON.stringify(files)).update(worker).digest('hex').slice(0,16);
    writeFileSync('dist/sw.js','self.PIZARRA_VERSION='+JSON.stringify(version)+';self.PIZARRA_FILES='+JSON.stringify(files)+';\n'+worker);
  }}]
};

