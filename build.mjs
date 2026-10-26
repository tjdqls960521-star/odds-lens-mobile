import {build} from 'esbuild';
import {access,mkdir,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['src/worker.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:sockets'],outfile:'dist/server/index.js'});
await cp('public','dist/client',{recursive:true});
try {
  await access('.openai/hosting.json');
  await mkdir('dist/.openai',{recursive:true});
  await cp('.openai/hosting.json','dist/.openai/hosting.json');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
