import {setTimeout as sleep} from 'node:timers/promises';
import {detailDOM} from './extract.js';

// Identify real image bytes even when an image host returns application/octet-stream.
export function imageExtension(body) {
  if (!Buffer.isBuffer(body) || body.length < 20) return null;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg';
  if (body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (/^GIF8[79]a$/.test(body.toString('ascii',0,6))) return 'gif';
  if (body.toString('ascii',0,4)==='RIFF' && body.toString('ascii',8,12)==='WEBP') return 'webp';
  if (body.toString('ascii',4,8)==='ftyp' && /avif|avis/.test(body.toString('ascii',8,40))) return 'avif';
  return null;
}

export async function downloadPhoto(request,url,referer,{attempts=3,pause=sleep}={}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    let response;
    try {
      response=await request.get(url,{timeout:45000,headers:referer?{Referer:referer}:{}});
      if(!response.ok()) {
        const error=new Error(`HTTP ${response.status()}`);
        error.retryable=[408,429,500,502,503,504].includes(response.status());
        throw error;
      }
      const body=await response.body();
      if(!imageExtension(body)) {
        const error=new Error('Response is not a supported image file');error.retryable=false;throw error;
      }
      return {body,type:response.headers()['content-type']};
    } catch(error) {
      if(error.retryable===false || attempt===attempts-1)throw error;
      await pause(500*2**attempt);
    } finally {await response?.dispose();}
  }
}

// Title renders before the photo uploader on some items. Allow the gallery's
// URLs to settle, including lazy-loaded images, before extracting the record.
export async function readDetail(page,{timeoutMs=15000,settleMs=1500,pollMs=300,expectedPhotos=0}={}) {
  const start=Date.now();let signature='',stableSince=start,latest;
  let scrolled=false,scrollAttempts=0;
  while(Date.now()-start<timeoutMs) {
    // Circle-Hand replaces the uploader during hydration. Scrolling only helps
    // lazy loading; failure must not abort extraction from the live DOM.
    if(!scrolled && scrollAttempts<2){
      const uploader=page.locator('main [data-slot="file-upload"]').first();
      if(await uploader.count()){
        scrollAttempts++;
        try{
          await uploader.scrollIntoViewIfNeeded({timeout:Math.max(1,Math.min(1000,timeoutMs-(Date.now()-start)))});
          scrolled=true;
        }catch{
          // Re-resolve the locator on the next poll. Even if both attempts fail,
          // keep reading URLs: downloading original images needs no scroll.
        }
      }
    }
    latest=await page.evaluate(detailDOM);
    const next=JSON.stringify(latest.imageCandidates);
    if(next!==signature){signature=next;stableSince=Date.now();}
    const target=Math.max(1,expectedPhotos);
    if(latest.imageCandidates.length>=target && Date.now()-stableSince>=settleMs)return latest;
    await sleep(pollMs);
  }
  latest=await page.evaluate(detailDOM);
  if(!latest.imageCandidates.length)latest.photoDiscoveryWarning='No photo URLs appeared before the gallery timeout.';
  else if(latest.imageCandidates.length<expectedPhotos)latest.photoDiscoveryWarning='Gallery returned fewer photos than the previous sync.';
  return latest;
}
