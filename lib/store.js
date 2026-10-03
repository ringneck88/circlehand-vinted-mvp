import fs from 'node:fs/promises';
import path from 'node:path';
import {imageExtension} from './photos.js';
export const root=path.resolve(process.env.INVENTORY_DIR||'inventory');
export function safe(s){return String(s).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75)||'item';}
export async function atomic(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,data);await fs.rename(temp,file);}
export async function items(){await fs.mkdir(root,{recursive:true});const found=[];for(const ent of await fs.readdir(root,{withFileTypes:true})){if(!ent.isDirectory())continue;try{const item=JSON.parse(await fs.readFile(path.join(root,ent.name,'item.json'),'utf8'));found.push({...item,folder:ent.name});}catch(e){if(e.code!=='ENOENT')console.warn('Cannot read item:',ent.name,e.message);}}return found;}
export function text(item){return Object.entries(item).filter(([k,v])=>!['images','imageSources','additionalFields','folder','imageCandidates','photoCandidates','photoSync','photoDiscoveryWarning'].includes(k)&&v!=null&&v!=='').map(([k,v])=>`${k.replace(/([A-Z])/g,' $1').toUpperCase()}\n${v}`).concat(Object.entries(item.additionalFields||{}).map(([k,v])=>`${k.toUpperCase()}\n${v}`)).join('\n\n')+'\n';}
export async function writeItem(folder,item){await atomic(path.join(root,folder,'item.json'),JSON.stringify(item,null,2)+'\n');await atomic(path.join(root,folder,'item.txt'),text(item));}
export async function saveSource(source,download,stats){
  const old=(await items()).find(i=>i.sourceId===source.sourceId);
  const folder=old?.folder||`${safe(source.sourceId)}-${safe(source.title)}`;
  await fs.mkdir(path.join(root,folder),{recursive:true});
  const images=[],imageSources=[],missing=[];
  const previousCandidates=old?.photoCandidates||old?.imageSources?.map(p=>[p.url])||[];
  const candidatesList=source.imageCandidates?.length?source.imageCandidates:previousCandidates;
  let warning=source.photoDiscoveryWarning;
  if(!source.imageCandidates?.length)warning=warning||'No photo URLs found in Circle-Hand; previous photo URLs retained when available.';
  // Cache prior bytes before changing numbered files; inserted/reordered photos
  // must not overwrite an unchanged photo that appears later in the sequence.
  const cached=new Map();
  for(const prior of old?.imageSources||[]){try{const body=await fs.readFile(path.join(root,folder,prior.file));if(imageExtension(body))cached.set(prior.url,{...prior,body});}catch{}}
  for(const [index,candidates]of candidatesList.entries()){
    let saved=false,lastError;
    for(const url of candidates){
      const prior=cached.get(url);
      if(prior){
        const file=`${String(index+1).padStart(2,'0')}${path.extname(prior.file)}`;
        if(file!==prior.file || !await fs.readFile(path.join(root,folder,file)).then(b=>b.equals(prior.body)).catch(()=>false))await atomic(path.join(root,folder,file),prior.body);
        images.push(file);imageSources.push({url,file});saved=true;break;
      }
      try{
        const {body,type}=await download(url);
        const extension=imageExtension(body);
        if(!extension||body.length<20)throw new Error('Response is not a supported image');
        const file=`${String(index+1).padStart(2,'0')}.${extension}`;
        await atomic(path.join(root,folder,file),body);images.push(file);imageSources.push({url,file});stats.photosDownloaded++;saved=true;break;
      }catch(e){lastError=e.message;}
    }
    if(!saved){
      const issue={sourceId:source.sourceId,photo:index+1,imageUrls:candidates,error:lastError||'No usable image URL'};
      missing.push(issue);stats.errors.push(issue);console.warn('Photo unavailable:',source.sourceId,index+1);
    }
  }
  // Do not hide previously downloaded photos after a partial/empty gallery or
  // failed download. Re-number cached bytes after new photos without collisions.
  if(warning || missing.length){
    const used=new Set(imageSources.map(p=>p.url));let next=candidatesList.length+1;
    for(const prior of cached.values()){
      if(used.has(prior.url))continue;
      const file=`${String(next++).padStart(2,'0')}.${imageExtension(prior.body)}`;
      await atomic(path.join(root,folder,file),prior.body);images.push(file);imageSources.push({url:prior.url,file});used.add(prior.url);
    }
  }
  const {imageCandidates,photoDiscoveryWarning,...data}=source;
  const photoSync={expected:candidatesList.length,saved:images.length,missing,...(warning?{warning}:{} )};
  if(missing.length || warning){
    stats.photoIssues??=[];stats.photoIssues.push({sourceId:source.sourceId,title:source.title,sourceUrl:source.sourceUrl,...photoSync});
  }
  // Read status again after downloads so a simultaneous app change is preserved.
  let current=old;try{current=JSON.parse(await fs.readFile(path.join(root,folder,'item.json'),'utf8'));}catch{}
  const item={...data,source:'circlehand',images,imageSources,photoCandidates:candidatesList,photoSync,vintedListed:current?.vintedListed===true,syncedAt:new Date().toISOString()};
  await writeItem(folder,item);stats[old?'existingItemsUpdated':'newItems']++;return {...item,folder};
}

// Fast local check before any item-detail navigation. Older exports have no
// photoSync metadata, so also check numbering and the files themselves.
export async function photosDownloaded(item) {
  if(!item?.folder || !Array.isArray(item.images) || !item.images.length)return false;
  if(item.photoSync?.warning || item.photoSync?.missing?.length)return false;
  const expected=Math.max(item.photoSync?.expected||0,item.photoCandidates?.length||0,item.imageSources?.length||0);
  if(expected>item.images.length || new Set(item.images).size!==item.images.length)return false;
  for(const [index,file] of item.images.entries()){
    if(typeof file!=='string' || path.basename(file)!==file || Number(file.split('.')[0])!==index+1)return false;
    let handle;
    try{
      handle=await fs.open(path.join(root,item.folder,file),'r');
      const header=Buffer.alloc(64);const {bytesRead}=await handle.read(header,0,64,0);
      if(!imageExtension(header.subarray(0,bytesRead)))return false;
    }catch{return false;}finally{await handle?.close();}
  }
  return true;
}
