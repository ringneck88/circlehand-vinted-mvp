import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {items,root,writeItem} from './lib/store.js';
const publicRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const port=Number(process.env.PORT||3000);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.txt':'text/plain; charset=utf-8'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function openFolder(folder){return new Promise((resolve,reject)=>{const child=spawn('xdg-open',[folder],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error.trim()||'File manager could not open')));});}
export const server=http.createServer(async(req,res)=>{
 try{
  const host=req.headers.host;if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(host)){json(res,403,{error:'Local connections only'});return;}
  const url=new URL(req.url,`http://${host}`),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(req.method==='GET'&&url.pathname==='/api/items'){json(res,200,await items());return;}
  if(req.method==='POST'){
   if(req.headers.origin&&req.headers.origin!==`http://${host}`){json(res,403,{error:'Origin not allowed'});return;}
   if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'JSON required'});return;}
   if(parts[0]!=='api'||parts[1]!=='items'||parts.length!==4){json(res,404,{error:'Unknown endpoint'});return;}
   const item=(await items()).find(i=>i.sourceId===parts[2]);if(!item){json(res,404,{error:'Item not found'});return;}
   if(parts[3]==='folder'){
    const folder=path.join(root,item.folder);try{await openFolder(folder);json(res,200,{path:folder,opened:true});}catch(e){json(res,200,{path:folder,opened:false,error:e.message});}return;
   }
   if(parts[3]==='status'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1024){json(res,413,{error:'Request too large'});return;}}
    const data=JSON.parse(body);if(typeof data.vintedListed!=='boolean'){json(res,400,{error:'vintedListed must be boolean'});return;}
    const {folder,...stored}=item;stored.vintedListed=data.vintedListed;await writeItem(folder,stored);json(res,200,{vintedListed:stored.vintedListed});return;
   }
   json(res,404,{error:'Unknown endpoint'});return;
  }
  if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
  let file;
  if(parts[0]==='photos'){
   const item=(await items()).find(i=>i.sourceId===parts[1]);if(!item||parts.length!==3||!item.images.includes(parts[2])){json(res,404,{error:'Photo not found'});return;}
   file=path.join(root,item.folder,parts[2]);
  }else{
   file=path.resolve(publicRoot,url.pathname==='/'?'index.html':'.'+url.pathname);
   if(!file.startsWith(publicRoot+path.sep)){json(res,403,{error:'Invalid path'});return;}
  }
  const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(bytes);
 }catch(e){json(res,e.code==='ENOENT'?404:500,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Inventory app: http://localhost:${port}`));
