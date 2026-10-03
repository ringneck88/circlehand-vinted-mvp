import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadPhoto,readDetail,imageExtension} from '../lib/photos.js';
const jpeg=Buffer.alloc(30);jpeg.set([255,216,255]);
const response=(status,body=jpeg)=>({ok:()=>status===200,status:()=>status,body:async()=>body,headers:()=>({'content-type':'application/octet-stream'}),dispose:async()=>{}});
test('temporary download errors retry; server rejection does not loop',async()=>{
 let calls=0;const request={get:async()=>response(++calls<3?503:200)};
 assert.equal(imageExtension((await downloadPhoto(request,'https://example.test/image',null,{pause:async()=>{}})).body),'jpg');assert.equal(calls,3);
 calls=0;await assert.rejects(downloadPhoto({get:async()=>{calls++;return response(403);}},'https://example.test/image',null,{pause:async()=>{}}),/403/);assert.equal(calls,1);
});
test('HTML error pages are rejected even if mislabeled as images',async()=>{
 await assert.rejects(downloadPhoto({get:async()=>response(200,Buffer.from('<html>This is an error document</html>'))},'https://example.test/image'),/supported image/);
});
test('gallery reader waits through empty gallery and late additional photos',async()=>{
 let count=0;const page={locator:()=>({first:()=>({count:async()=>0})}),evaluate:async()=>({title:'Sample',imageCandidates:++count<3?[]:count<5?[['one']]:[['one'],['two']]})};
 const item=await readDetail(page,{timeoutMs:250,settleMs:30,pollMs:10});assert.equal(item.imageCandidates.length,2);assert(!item.photoDiscoveryWarning);
});
test('gallery timeout reports zero photos for review',async()=>{
 const page={locator:()=>({first:()=>({count:async()=>0})}),evaluate:async()=>({title:'Sample',imageCandidates:[]})};
 const item=await readDetail(page,{timeoutMs:30,pollMs:5});assert.match(item.photoDiscoveryWarning,/No photo URLs/);
});

test('detached uploader does not abort an item and re-resolves on the next poll',async()=>{
 let locators=0,scrolls=0,reads=0;
 const page={locator:()=>{locators++;return {first:()=>({count:async()=>1,scrollIntoViewIfNeeded:async({timeout})=>{assert(timeout<=1000);scrolls++;if(scrolls===1)throw new Error('locator.scrollIntoViewIfNeeded: Element is not attached to the DOM');}})};},evaluate:async()=>{reads++;return {title:'Recovered item',imageCandidates:[['https://example.test/photo.jpg']]};}};
 const item=await readDetail(page,{timeoutMs:150,settleMs:20,pollMs:5});
 assert.equal(scrolls,2);assert.equal(locators,2);assert(reads>1);assert.equal(item.imageCandidates.length,1);assert(!item.photoDiscoveryWarning);
});
test('persistently unstable uploader gets only two scroll attempts, then extracts normally',async()=>{
 let attempts=0;
 const page={locator:()=>({first:()=>({count:async()=>1,scrollIntoViewIfNeeded:async()=>{attempts++;throw new Error('locator.scrollIntoViewIfNeeded: Timeout exceeded; element is not stable');}})}),evaluate:async()=>({title:'Unstable item',imageCandidates:[['https://example.test/photo.jpg']]})};
 const item=await readDetail(page,{timeoutMs:150,settleMs:20,pollMs:5});
 assert.equal(attempts,2);assert.equal(item.imageCandidates.length,1);assert(!item.photoDiscoveryWarning);
});
test('real extraction failures remain visible after a scroll failure',async()=>{
 const page={locator:()=>({first:()=>({count:async()=>1,scrollIntoViewIfNeeded:async()=>{throw new Error('Detached');}})}),evaluate:async()=>{throw new Error('Target page has been closed');}};
 await assert.rejects(readDetail(page,{timeoutMs:150}),/Target page has been closed/);
});
