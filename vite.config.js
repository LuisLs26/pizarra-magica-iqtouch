import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export default {
  root:'src-web',
  build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:{board:'src-web/index.html',teacher:'src-web/teacher.html'}}},
  plugins:[{name:'offline-cache',apply:'build',closeBundle(){
    const worker=readFileSync('dist/sw.js','utf8');
    const files=['/','/teacher','/teacher.html','/capture.js',...readdirSync('dist/assets').map(f=>'/assets/'+f),...readdirSync('dist/audio').map(f=>'/audio/'+f)];
    const version=createHash('sha256').update(JSON.stringify(files)).update(worker).digest('hex').slice(0,16);
    writeFileSync('dist/sw.js','self.PIZARRA_VERSION='+JSON.stringify(version)+';self.PIZARRA_FILES='+JSON.stringify(files)+';\n'+worker);
  }}]
};
