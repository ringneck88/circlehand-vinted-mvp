// Selectors grounded in the authenticated Hazel Rows portal inspected October 3, 2026.
export function dashboardDOM() {
  const table = [...document.querySelectorAll('main table')].find(t => t.innerText.includes('Barcode'));
  if (!table) throw new Error('Inventory table not found; sign-in or portal layout may have changed.');
  const headers = [...table.querySelectorAll('thead tr:first-child th')].map(e=>e.innerText.trim());
  const rows = [...table.querySelectorAll('tbody tr')].flatMap(row=>{
    const link = row.querySelector('a[href*="/items/"][href$="/edit"]');
    if(!link) return [];
    const cells = [...row.querySelectorAll('td')];
    const fields = Object.fromEntries(headers.map((h,i)=>[h,cells[i]?.innerText.trim()||'']));
    const img=row.querySelector('img');
    return [{sourceId:link.pathname.split('/').at(-2),sourceUrl:link.href,title:img?.alt||fields.Title,status:fields.Status,dashboardPrice:fields.Price,sku:fields.Barcode,quantity:fields.Quantity,dateSold:fields['Date Sold']}];
  });
  const next=document.querySelector('a[aria-label="Go to next page"]');
  return {rows,next:next && next.getAttribute('aria-disabled')!=='true' && !next.hasAttribute('disabled')?next.href:null};
}
export function detailDOM() {
  const title=document.querySelector('main input[name="title"]');
  if(!title || !title.value.trim()) throw new Error('Loaded item title not found.');
  const fields={};
  for(const label of document.querySelectorAll('main [data-slot="field"] > label')){
    const group=label.parentElement, key=label.innerText.replace(/\*/g,'').trim();
    if(key==='Images')continue;
    const input=group.querySelector('input:not([type="hidden"]):not([type="file"]),textarea');
    const editor=group.querySelector('[contenteditable="true"]');
    const button=group.querySelector('button[data-slot="popover-trigger"]');
    let value=input?.value ?? editor?.innerText ?? button?.innerText;
    if(value){value=value.replace(/Clear selection/g,'').trim(); if(!/^Select\b/i.test(value)) fields[key]=value;}
  }
  const mappings={Title:'title',Price:'price',Description:'description',Brand:'brand',Size:'size',Condition:'condition',Category:'category',Color:'color','Color or Pattern':'color',Quantity:'quantity','Hand-in Date':'handInDate',Material:'material'};
  const item={additionalFields:{}};
  for(const [key,value] of Object.entries(fields)) if(mappings[key])item[mappings[key]]=value;else item.additionalFields[key]=value;
  const editor=document.querySelector('main [contenteditable="true"]');
  if(editor)item.description=editor.innerText.trim();
  const imageField=[...document.querySelectorAll('main [data-slot="field"]')].find(e=>e.querySelector('label')?.innerText.trim()==='Images');
  item.imageCandidates=[...(imageField?.querySelectorAll('img')||[])].map(img=>{
    const candidates=[];
    const add=(url,rank)=>{if(url){try{const u=new URL(url,location.href);if(['http:','https:'].includes(u.protocol))candidates.push({url:u.href,rank});}catch{}}};
    const anchor=img.closest('a[href]'); if(anchor)add(anchor.href,100000);
    add(img.dataset.original,100000);add(img.dataset.src,5000);
    for(const entry of (img.srcset||'').split(',')){const [url,size]=entry.trim().split(/\s+/);if(url)add(url,parseFloat(size)||0);}
    add(img.currentSrc,100);add(img.src,50);
    // Circle-Hand's image alt is the observed original product-image URL.
    if(/^https?:\/\//.test(img.alt))add(img.alt,200000);
    return [...new Map(candidates.sort((a,b)=>b.rank-a.rank).map(c=>[c.url,c])).values()].map(c=>c.url);
  }).filter(c=>c.length);
  item.imageCandidates=item.imageCandidates.filter((c,i,a)=>a.findIndex(x=>x[0]===c[0])===i);
  return item;
}
