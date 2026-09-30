import {cp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
await rm('www',{recursive:true,force:true});await mkdir('www');await cp('dist','www',{recursive:true});
await build({entryPoints:['dist/bootstrap.js'],bundle:true,format:'esm',platform:'browser',target:'safari18',outfile:'www/bootstrap.js',minify:false});
