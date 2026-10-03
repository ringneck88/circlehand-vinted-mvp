import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleImage} from './fixture-image.js';
const fixtureRoot=await fs.mkdtemp(path.join(os.tmpdir(),'circlehand-ui-'));
for(const [id,title,description,count] of [
 ['demo-bag','Demo Canvas Bag','Canvas shoulder bag with two pockets.',6],
 ['demo-shoes','Demo Trainers','Lightweight everyday shoes.',1],
 ['demo-shirt','Demo Shirt','Short sleeve shirt.',1],
]){
 const folder=path.join(fixtureRoot,id);await fs.mkdir(folder);
 const images=[];for(let i=1;i<=count;i++){const file=`${String(i).padStart(2,'0')}.png`;images.push(file);await fs.writeFile(path.join(folder,file),sampleImage);}
 await fs.writeFile(path.join(folder,'item.json'),JSON.stringify({source:'circlehand',sourceId:id,title,description,brand:'Demo',size:'M',price:'15.00',status:'In Stock',images,vintedListed:false}));
}
process.env.INVENTORY_DIR=fixtureRoot;
const {server}=await import('../server.js');
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const browser=await chromium.launch({headless:true});const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
await page.goto('http://localhost:3000');await page.locator('.card').first().waitFor();
const before=await page.evaluate(()=>fetch('/api/items').then(r=>r.json()));assert(before.length>=3);
await page.locator('.card').filter({hasText:'Demo Canvas Bag'}).click();await page.getByRole('button',{name:'Copy Title',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),before.find(i=>i.title.includes('Demo Canvas Bag')).title);
await page.getByRole('button',{name:'Copy Description',exact:true}).click();assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('two pockets'));
await page.getByRole('button',{name:'COPY ALL',exact:true}).click();assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('DESCRIPTION\n'));
assert.equal(await page.locator('#photos img').count(),6);for(const image of await page.locator('#photos img').all()){await image.evaluate(e=>e.decode());assert(await image.evaluate(e=>e.naturalWidth>0));}
await page.getByRole('button',{name:'OPEN PHOTO FOLDER'}).click();await page.locator('#folder-help').waitFor({state:'visible'});assert((await page.locator('#folder-help').innerText()).includes(fixtureRoot));
await page.getByRole('button',{name:'MARK LISTED ON VINTED',exact:true}).click();await page.getByRole('button',{name:'MARK NOT LISTED',exact:true}).waitFor();await page.reload();await page.locator('.card').first().waitFor();
await page.locator('#filter').selectOption('listed');assert.equal(await page.locator('.card').count(),1);await page.locator('.card').click();
await page.getByRole('button',{name:'MARK NOT LISTED',exact:true}).click();await page.getByRole('button',{name:'MARK LISTED ON VINTED',exact:true}).waitFor();
await page.getByRole('button',{name:'← Inventory',exact:true}).click();await page.locator('#filter').selectOption('unlisted');await page.getByRole('searchbox').fill('Demo Trainers');assert.equal(await page.locator('.card').count(),1);await page.getByRole('searchbox').fill('');
await fs.mkdir('test-results',{recursive:true});for(const img of await page.locator('.card img').all())await img.evaluate(e=>e.decode());
await page.screenshot({path:'test-results/inventory.png',fullPage:true});
await page.locator('.card').filter({hasText:'Demo Canvas Bag'}).click();
for(const img of await page.locator('#photos img').all())await img.evaluate(e=>e.decode());
await page.screenshot({path:'test-results/item.png',fullPage:true});
const final=await page.evaluate(()=>fetch('/api/items').then(r=>r.json()));assert(final.every(i=>i.vintedListed===false));
const bad=await context.request.post('http://localhost:3000/api/items/'+before[0].sourceId+'/status',{headers:{Origin:'https://untrusted.example'},data:{vintedListed:true}});assert.equal(bad.status(),403);
console.log('PASS: fixture photo rendering, copy title/description/all, folder fallback, listed/unlisted persistence, filters, search, origin protection.');await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(fixtureRoot,{recursive:true,force:true});
