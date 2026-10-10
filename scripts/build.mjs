import {build} from 'esbuild';
import {mkdir,copyFile,readdir} from 'node:fs/promises';
await mkdir('dist/public',{recursive:true});await mkdir('dist/extension',{recursive:true});await mkdir('dist/server',{recursive:true});
await build({entryPoints:['web/main.tsx'],bundle:true,outfile:'dist/public/app.js',platform:'browser',target:'firefox140',jsx:'automatic',minify:true,sourcemap:false,define:{'process.env.NODE_ENV':'"production"'}});
await copyFile('web/index.html','dist/public/index.html');
await copyFile('web/favicon.svg','dist/public/favicon.svg');
await build({entryPoints:['server/index.ts'],bundle:true,outfile:'dist/server/index.js',platform:'node',target:'node24',format:'esm',packages:'external'});
for(const file of ['background','content','options','reader'])await build({entryPoints:[`extension/${file}.ts`],bundle:true,outfile:`dist/extension/${file}.js`,platform:'browser',target:'firefox140',format:'iife',minify:false,sourcemap:false});
for(const file of await readdir('extension'))if(/\.(json|html|css|svg)$/.test(file))await copyFile(`extension/${file}`,`dist/extension/${file}`);
// Identical reader code in the portal and Firefox. Extension requests use a scoped background relay.
await copyFile('dist/public/app.js','dist/extension/app.js');
await copyFile('dist/public/app.css','dist/extension/app.css');
await copyFile('web/favicon.svg','dist/extension/favicon.svg');
await copyFile('THIRD-PARTY-NOTICES.txt','dist/extension/THIRD-PARTY-NOTICES.txt');
console.log('Built portal, local service and Firefox extension.');
