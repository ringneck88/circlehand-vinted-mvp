import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'circlehand-test-'));process.env.INVENTORY_DIR=temp;
const {saveSource,items,writeItem,safe,photosDownloaded}=await import('../lib/store.js');
const stats=()=>({newItems:0,existingItemsUpdated:0,photosDownloaded:0,errors:[]});
const source={sourceId:'abc123',title:'Bag / purse',description:'Real description',imageCandidates:[['https://example.test/one.jpg']]};
const jpeg=(value=0)=>{const b=Buffer.alloc(40,value);b.set([255,216,255]);return b;};
const downloader=async()=>({body:jpeg(),type:'image/jpeg'});
test('sync preserves listed status, stable folder, unchanged photos and text fallback',async()=>{
 const first=await saveSource(source,downloader,stats());assert.equal(first.images[0],'01.jpg');
 const {folder,...stored}=first;stored.vintedListed=true;await writeItem(folder,stored);
 const secondStats=stats();const second=await saveSource({...source,title:'Updated bag'},async()=>{throw new Error('Existing photo should not be downloaded');},secondStats);
 assert.equal(second.vintedListed,true);assert.equal(second.folder,folder);assert.equal(secondStats.photosDownloaded,0);assert.equal(secondStats.existingItemsUpdated,1);
 assert.match(await fs.readFile(path.join(temp,folder,'item.txt'),'utf8'),/Updated bag/);
});
test('image error continues and does not prevent item or later photo saving',async()=>{
 const s=stats();const result=await saveSource({...source,sourceId:'other',imageCandidates:[['https://example.test/bad'],['https://example.test/good']]},async url=>{if(url.endsWith('/bad'))throw new Error('Bad image');return downloader();},s);
 assert.deepEqual(result.images,['02.jpg']);assert.equal(s.errors.length,1);assert.equal((await items()).length,2);
});
test('folder names are filesystem-safe',()=>{assert.equal(safe('../../A bag!?'),'A-bag');});
test.after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
test('inserting first image preserves unchanged photo bytes and ordering',async()=>{
 const base={...source,sourceId:'order',imageCandidates:[['https://example.test/old.jpg']]};
 await saveSource(base,async()=>({body:jpeg(1),type:'image/jpeg'}),stats());
 const s=stats();const result=await saveSource({...base,imageCandidates:[['https://example.test/new.jpg'],['https://example.test/old.jpg']]},async()=>({body:jpeg(2),type:'image/jpeg'}),s);
 assert.equal(s.photosDownloaded,1);assert.deepEqual(result.images,['01.jpg','02.jpg']);
 assert.equal((await fs.readFile(path.join(temp,result.folder,'01.jpg')))[3],2);assert.equal((await fs.readFile(path.join(temp,result.folder,'02.jpg')))[3],1);
});

test('empty gallery preserves previous photos and listed status',async()=>{
 const base={...source,sourceId:'empty'};
 const first=await saveSource(base,downloader,stats());const {folder,...stored}=first;stored.vintedListed=true;await writeItem(folder,stored);
 const s=stats();const result=await saveSource({...base,imageCandidates:[]},async()=>{throw new Error('Must reuse cached file');},s);
 assert.deepEqual(result.images,['01.jpg']);assert.equal(result.vintedListed,true);assert.equal(s.photosDownloaded,0);assert.equal(s.photoIssues.length,1);
});
test('valid JPEG with generic content type is saved and missing local file is repaired',async()=>{
 const base={...source,sourceId:'generic'};
 const first=await saveSource(base,async()=>({body:jpeg(),type:'application/octet-stream'}),stats());
 assert.deepEqual(first.images,['01.jpg']);await fs.unlink(path.join(temp,first.folder,'01.jpg'));
 const s=stats();await saveSource(base,downloader,s);assert.equal(s.photosDownloaded,1);
});
test('failed candidates are retained for later recovery without hiding good photos',async()=>{
 const base={...source,sourceId:'retry',imageCandidates:[['https://example.test/one.jpg'],['https://example.test/two.jpg']]};
 const first=await saveSource(base,downloader,stats());
 const s=stats();const result=await saveSource({...base,imageCandidates:[['https://example.test/unavailable.jpg']]},async()=>{throw new Error('HTTP 503');},s);
 assert.equal(result.images.length,2);assert.equal(result.photoSync.missing.length,1);assert.deepEqual(result.photoCandidates,[['https://example.test/unavailable.jpg']]);
 for(const image of result.images)assert((await fs.stat(path.join(temp,first.folder,image))).size>0);
});

test('completed photo sets are skipped, including original MVP exports',async()=>{
 const item=await saveSource({...source,sourceId:'skip-complete'},downloader,stats());
 assert.equal(await photosDownloaded(item),true);
 const {photoSync,photoCandidates,...legacy}=item;assert.equal(await photosDownloaded(legacy),true);
 assert.equal(await photosDownloaded({...item,vintedListed:true}),true);
});
test('missing, empty and damaged files are not skipped',async()=>{
 const item=await saveSource({...source,sourceId:'skip-missing'},downloader,stats());
 const file=path.join(temp,item.folder,item.images[0]);
 await fs.unlink(file);assert.equal(await photosDownloaded(item),false);
 await fs.writeFile(file,'');assert.equal(await photosDownloaded(item),false);
 await fs.writeFile(file,'<html>Error document masquerading as an image</html>');assert.equal(await photosDownloaded(item),false);
});
test('partial sets, pending errors and unknown empty galleries are not skipped',async()=>{
 const item=await saveSource({...source,sourceId:'skip-partial'},downloader,stats());
 assert.equal(await photosDownloaded(undefined),false);
 assert.equal(await photosDownloaded({...item,images:[]}),false);
 assert.equal(await photosDownloaded({...item,photoSync:{expected:2}}),false);
 assert.equal(await photosDownloaded({...item,photoSync:{missing:[{}]}}),false);
 assert.equal(await photosDownloaded({...item,photoSync:{warning:'Partial'}}),false);
 assert.equal(await photosDownloaded({...item,images:['02.jpg']}),false);
});
