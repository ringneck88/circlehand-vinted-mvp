// Controlled browser regression: delayed gallery + a temporarily failing image host.
import {chromium} from 'playwright';
import http from 'node:http';
import {sampleImage as photo} from './fixture-image.js';
import assert from 'node:assert/strict';
import {readDetail,downloadPhoto,imageExtension} from '../lib/photos.js';
let requests=0;
const server=http.createServer((req,res)=>{
 if(req.url==='/photo.png'){
  requests++;res.writeHead(requests<3?503:200,{'Content-Type':'application/octet-stream'});res.end(requests<3?'Try again':photo);return;
 }
 const origin=`http://${req.headers.host}`;
 res.writeHead(200,{'Content-Type':'text/html'});
 res.end(`<main><input name="title" value="Delayed gallery"><div data-slot="field"><label>Images</label><div data-slot="file-upload"></div></div></main><script>
 setTimeout(()=>{document.querySelector('[data-slot="file-upload"]').innerHTML='<img src="${origin}/photo.png" alt="${origin}/photo.png">';},300);
 setTimeout(()=>{document.querySelector('[data-slot="file-upload"]').insertAdjacentHTML('beforeend','<img src="${origin}/second.jpg" alt="${origin}/second.jpg">');},1000);
 </script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
 const origin=`http://127.0.0.1:${server.address().port}`;
 await page.goto(origin);const detail=await readDetail(page,{timeoutMs:6000});assert.equal(detail.imageCandidates.length,2);assert(!detail.photoDiscoveryWarning);
 requests=0;const downloaded=await downloadPhoto(context.request,origin+'/photo.png',origin,{pause:async()=>{}});
 assert.equal(requests,3);assert.equal(imageExtension(downloaded.body),'png');assert(downloaded.body.equals(photo));
 console.log('PASS: real Chromium waits for late photo URLs; real HTTP retries twice and accepts a PNG served as application/octet-stream.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
