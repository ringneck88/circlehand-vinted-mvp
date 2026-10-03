import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import {dashboardDOM} from './lib/extract.js';
import {saveSource,atomic,root,items,photosDownloaded} from './lib/store.js';
import {readDetail,downloadPhoto} from './lib/photos.js';
let localConfig={};
try{localConfig=JSON.parse(await fs.readFile('circlehand.config.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const dashboard=process.env.CIRCLEHAND_URL||localConfig.dashboardUrl;
if(!dashboard)throw new Error('Set CIRCLEHAND_URL or copy circlehand.config.example.json to circlehand.config.json and enter your dashboardUrl.');
const origin=new URL(dashboard).origin;
const profile=path.resolve('.chromium-profile');
const limitArg=process.argv.find(a=>a.startsWith('--limit='));const limit=limitArg?Number(limitArg.split('=')[1]):Infinity;
const force=process.argv.includes('--force');
const stats={itemsSkipped:0,dashboardPages:0,itemsFound:0,newItems:0,existingItemsUpdated:0,photosDownloaded:0,errors:[]};
const lock=path.join(root,'.sync.lock');await fs.mkdir(root,{recursive:true});let handle;
try{handle=await fs.open(lock,'wx');}catch{throw new Error('Another sync is running. If a previous sync crashed, remove inventory/.sync.lock.');}
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADLESS==='1',...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),acceptDownloads:true});
 const page=context.pages()[0]||await context.newPage();
 await page.goto(dashboard,{waitUntil:'domcontentloaded'});
 async function ready(){await Promise.race([page.locator('main table').waitFor({timeout:45000}),page.getByPlaceholder('Enter your email address').waitFor({timeout:45000})]);}
 await ready();
 if(await page.getByPlaceholder('Enter your email address').isVisible()||process.argv.includes('--login')){
  if(process.env.HEADLESS==='1')throw new Error('Login required. Run npm run login in visible Chromium first.');
  console.log('Sign in manually in Chromium. Do not send credentials to this program.');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});await rl.question('After the inventory dashboard is visible, press Enter here: ');rl.close();
  await page.goto(dashboard,{waitUntil:'domcontentloaded'});await page.locator('main table').waitFor({timeout:45000});
 }
 if(process.argv.includes('--login')){console.log('Authenticated profile ready. Run npm run sync.');}
 else{
 const rows=new Map(),visited=new Set();let next=dashboard;
 while(next){
  if(visited.has(next))throw new Error('Pagination loop detected');visited.add(next);
  if(new URL(next).origin!==origin)throw new Error('Unexpected pagination origin');
  await page.goto(next,{waitUntil:'domcontentloaded'});await page.locator('main table tbody tr a[href$="/edit"]').first().waitFor({timeout:45000}).catch(async e=>{if(!(await page.locator('main table').count()))throw e;});
  const result=await page.evaluate(dashboardDOM);stats.dashboardPages++;
  if(result.rows.length && result.rows.every(r=>rows.has(r.sourceId)))throw new Error('Pagination repeated a previously seen page');
  for(const row of result.rows)rows.set(row.sourceId,row);
  console.log(`Dashboard page ${stats.dashboardPages}: ${result.rows.length} items`);next=result.next;
 }
 stats.itemsFound=rows.size;
 const existing=new Map((await items()).map(i=>[i.sourceId,i]));
 const previousFailures=new Set();
 try{
  const report=JSON.parse(await fs.readFile(path.join(root,'sync-report.json'),'utf8'));
  for(const entry of [...(report.errors||[]),...(report.photoIssues||[])])if(entry.sourceId)previousFailures.add(entry.sourceId);
 }catch{}
 for(const [i,row]of [...rows.values()].slice(0,limit).entries()){
  console.log(`[${i+1}/${Math.min(rows.size,limit)}] ${row.title}`);
  try{
   const old=existing.get(row.sourceId);
   if(!force && !previousFailures.has(row.sourceId) && await photosDownloaded(old)){
    stats.itemsSkipped++;console.log('  Skipped: photos already downloaded.');continue;
   }
   if(new URL(row.sourceUrl).origin!==origin)throw new Error('Unexpected item origin');
   await page.goto(row.sourceUrl,{waitUntil:'domcontentloaded'});await page.locator('main input[name="title"]').waitFor({timeout:45000});
   let detail=await readDetail(page,{expectedPhotos:Math.max(old?.photoCandidates?.length||0,old?.images?.length||0)});
   if(detail.photoDiscoveryWarning){
    console.log('Photo gallery incomplete; reloading item once.');
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('main input[name="title"]').waitFor({timeout:45000});
    const retry=await readDetail(page,{expectedPhotos:Math.max(old?.photoCandidates?.length||0,old?.images?.length||0)});
    if(retry.imageCandidates.length>=detail.imageCandidates.length)detail=retry;
   }
   await saveSource({...row,...detail},url=>downloadPhoto(context.request,url,row.sourceUrl),stats);
  }catch(e){stats.errors.push({sourceId:row.sourceId,error:e.message});console.error('Item failed:',e.message);}
 }
 await atomic(path.join(root,'photo-issues.json'),JSON.stringify(stats.photoIssues||[],null,2));
 await atomic(path.join(root,'sync-report.json'),JSON.stringify(stats,null,2));
 console.log(`\nCircle-Hand Sync Complete\nDashboard pages: ${stats.dashboardPages}\nItems found: ${stats.itemsFound}\nItems skipped (photos already downloaded): ${stats.itemsSkipped}\nNew items: ${stats.newItems}\nExisting items updated: ${stats.existingItemsUpdated}\nPhotos downloaded: ${stats.photosDownloaded}\nErrors: ${stats.errors.length}\nItems needing photo review: ${stats.photoIssues?.length||0}`);
 }
}finally{await context?.close();await handle.close();await fs.unlink(lock);}
