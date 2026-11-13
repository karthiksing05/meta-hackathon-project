import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const arcade = fileURLToPath(new URL('./', import.meta.url));
const runtime = fileURLToPath(new URL('../../FacebookClone/Bubbles/Runtime/web/', import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const lan = process.argv.includes('--lan');
const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json'};
const files = new Map();
const add = (url, path) => files.set(url, path);

for (const name of ['index.html','arcade.css','arcade.js','tabletop.js','action.js','muse-player.html','muse-player.js']) {
  add('/'+name,join(arcade,name));
}
for (const name of ['bubble-glow.css','bubble-runtime.js','bubble-kit-common.js','bubble-kit-microgame-engine.js','bubble-kit-microgame.js']) {
  add('/runtime/'+name,join(runtime,name));
}
add('/',join(arcade,'index.html'));

createServer(async (req,res)=>{
  const url = req.url?.split('?')[0];
  const manifest = /^\/muse\/([a-z]+(?:-updated)?\.json)$/.exec(url);
  const path = files.get(url) ?? (manifest && join(arcade,'muse',manifest[1]));
  if (!path || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const {size} = await stat(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]+'; charset=utf-8','Content-Length':size,'Cache-Control':'no-store'});
    if (req.method === 'HEAD') res.end();
    else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{
  console.log('Prompt Arcade: http://localhost:'+port+'/');
  if (lan) {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const {address, family, internal} of addresses ?? []) {
        if (!internal && family === 'IPv4' && !address.startsWith('169.254.')) {
          console.log('Same Wi-Fi: http://'+address+':'+port+'/');
        }
      }
    }
  }
});
