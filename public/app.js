const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');api.headers=r.headers;return data;}
async function action(fn){try{$('#status').textContent='Working…';$('#status').className='';await fn();await load();$('#status').textContent='Done.';}catch(e){$('#status').textContent=e.message;$('#status').className='error';}}
const riga=t=>t?new Date(t).toLocaleString('en-GB',{timeZone:'Europe/Riga',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
let stamp=Date.now(), postizUrl=null, ejuz=false, renderConfigured=false, showPast=false;
const gridInfo=new Map(), openGrids=new Set();
const media=(e,file)=>`/media/${e.id}/${file}?v=${stamp}`;
// Thumbnails keep the review page light; every one links to the full-size image.
const thumb=(e,file)=>`/thumb/${e.id}/${file}?v=${stamp}`;
const lazy='loading="lazy" decoding="async"';

// Organiser images stay; an event with none gets flagged so you can add your own before approving.
function photoRow(e,i){
  const mine=e.uploads.includes(i), organiser=e.organiserPhotos.includes(i), locked=e.approved;
  const state=mine?'<span class="tag ok">Your photo</span>':organiser?'<span class="tag ok">Organiser photo</span>':'<span class="tag missing">No photo</span>';
  const add=locked?'':`<button class="secondary small" data-upload="${e.id}" data-index="${i}">${mine?'Replace my photo':organiser?'Use my own photo instead':'Add photo'}</button>`;
  const remove=mine&&!locked?`<button class="secondary small" data-unphoto="${e.id}" data-index="${i}">Remove my photo</button>`:'';
  const story=`<label class="story-tick"><input type="checkbox" data-story="${e.id}" value="${i}"${e.stories.includes(i)?' checked':''}${locked?' disabled':''}> Story</label>`;
  return `<div class="photo-row${!mine&&!organiser&&!locked?' needs':''}"><a href="${media(e,`feed-${i}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`feed-${i}.jpg`)}" alt="Slide for ${esc(e.data.events[i].title)}"></a>${state}${add}${remove}${story}</div>`;
}

// Other weekend days an event is also on. Editable on drafts; shown as text once approved.
const weekday=d=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'});
function alsoRow(e,i){
  const x=e.data.events[i], set=x.alsoOn||[], others=e.weekendDays.filter(d=>d!==e.eventDates[i]);
  if(e.approved) return set.length?`<div class="also">Also on ${set.map(weekday).join(' and ')}</div>`:'';
  return `<div class="also">Also on:${others.map(d=>`<label><input type="checkbox" data-also="${e.id}" data-index="${i}" value="${d}"${set.includes(d)?' checked':''}> ${weekday(d)}</label>`).join('')}</div>`;
}
function jobLabel(e,j){
  if(j.target.startsWith('instagram_feed:')){const [date,part]=j.target.slice(15).split('#');const p=e.posts.find(x=>x.date===date&&String(x.part)===part);return `Instagram post · ${esc(p?p.name:date)}`;}
  if(j.target==='instagram_feed') return 'Instagram post · whole weekend';
  if(j.target.startsWith('instagram_story:')){const i=Number(j.target.split(':')[1]);return `Story · ${esc(e.data.events[i]?.title||`event ${i+1}`)}`;}
  if(j.target.startsWith('instagram_reel:')) return `Reel · ${esc(j.target.slice(15).split('#')[0])}`;
  if(j.target.startsWith('instagram_grid_story:')) return `Story video · ${esc(j.target.slice(21).split('#')[0])}`;
  if(j.target.startsWith('whatsapp')) return 'WhatsApp digest';
  return esc(j.target);
}
function jobState(j){
  let r={};try{r=JSON.parse(j.result||'{}')||{};}catch{}
  const wa=j.target.startsWith('whatsapp');
  if(['queued','processing'].includes(j.status)) return wa?'Sending…':'Handing over to Postiz…';
  if(j.status==='sent'){
    if(r.postiz==='draft') return 'Draft in Postiz: schedule or delete it there';
    if(r.postiz==='scheduled') return `Scheduled in Postiz for ${riga(r.publishAt)}`;
    return j.finished_at?`Sent ${riga(j.finished_at)}`:'Sent';
  }
  if(j.status==='blocked') return `Held back: ${esc(r.error||'')}`;
  if(j.status==='uncertain') return `Needs checking: ${esc(r.error||'')}`;
  return esc(j.status);
}
function jobItem(e,j){
  const fix=['uncertain','blocked'].includes(j.status)?`<div><button class="secondary small" data-retry="${j.id}">Retry after checking</button><button class="secondary small" data-sent="${j.id}">Confirm it did go out</button></div>`:'';
  return `<li><strong>${jobLabel(e,j)}</strong><span class="job-state ${j.status}">${jobState(j)}</span>${fix}</li>`;
}

// After approval: Instagram lives in Postiz, WhatsApp waits for you.
function publishing(e){
  if(e.demo||!e.approved) return '';
  const insta=e.jobs.filter(j=>!j.target.startsWith('whatsapp')), sends=e.jobs.filter(j=>j.target.startsWith('whatsapp'));
  const last=sends[sends.length-1], busy=last&&['queued','processing'].includes(last.status), sent=last?.status==='sent';
  const calendar=postizUrl?`<a class="button-link" href="${esc(postizUrl)}/launches" target="_blank" rel="noopener">Open Postiz calendar</a>`:'';
  const button=busy?'<button disabled>Sending…</button>':`<button data-whatsapp="${e.id}"${sent?' data-resend="1" class="secondary"':''}>${sent?'Send the digest again':'Send WhatsApp digest now'}</button>`;
  return `<section class="publishing">
    <div class="publishing-head"><h4>Instagram, in Postiz</h4>${calendar}</div>
    <p>Carousels are scheduled for the times below and stories wait as drafts. To change a time, or to schedule or delete a story, open the post in Postiz. Times shown here are the ones first scheduled.</p>
    <ul class="jobs">${insta.map(j=>jobItem(e,j)).join('')||'<li>Nothing handed over yet.</li>'}</ul>
    <div class="publishing-head"><h4>WhatsApp</h4>${button}</div>
    <p>Sent to the group only when you press the button. It lists the chosen events that have not started yet.</p>
    ${sends.length?`<ul class="jobs">${sends.map(j=>jobItem(e,j)).join('')}</ul>`:''}
  </section>`;
}

// Story grids: pick up to six cards per day, build the sheet, then render the envelope video on demand.
const GRID_MAX=6;
function gridState(g){
  const s=g.saved;
  if(!s) return 'Not built yet. The ticks are a suggestion: earliest events with a real photo first.';
  if(s.status==='rendering') return 'Rendering the video… this takes about a minute. The page updates when it is done.';
  if(s.status==='failed') return `Render failed: ${esc(s.error||'unknown error')}`;
  if(g.video) return 'Video ready.';
  return renderConfigured?'Grid built. Render the video when you are happy with it.':'Grid built. The render service is not configured (RENDER_URL), so videos cannot be made here yet.';
}
function gridBlock(e,g){
  const key=`${e.id}|${g.date}`, s=g.saved, picks=s?s.picks:g.suggested, busy=s?.status==='rendering';
  gridInfo.set(key,g);
  const cards=g.events.map(x=>`<label class="grid-pick"><input type="checkbox" data-grid="${key}" value="${x.index}"${picks.includes(x.index)?' checked':''}${busy?' disabled':''}><img ${lazy} src="${thumb(e,`feed-${x.index}.jpg`)}" alt=""><span>${esc(x.title)}<small>${esc(x.time)}</small></span></label>`).join('');
  const preview=g.collage?`<a href="${media(e,`grid-${g.date}.png`)}" target="_blank" rel="noopener"><img ${lazy} class="grid-preview" src="${thumb(e,`grid-${g.date}.png`)}" alt="Grid for ${esc(g.name)}"></a>`:'';
  const sendState=k=>{
    const j=(g.posts||[]).filter(x=>x.kind===k).pop();
    if(!j) return '';
    return `<span class="job-state ${j.status}">${jobState(j)}</span>`;
  };
  const sent=k=>(g.posts||[]).some(x=>x.kind===k&&x.status==='sent');
  const sendable=g.video&&!busy&&s?.status==='ready';
  const send=sendable?`<div class="grid-send">
      <button class="secondary small" data-grid-send="${key}" data-kind="reel"${sent('reel')?' data-resend="1"':''}>${sent('reel')?'Send Reel again':'Send as Reel draft'}</button>${sendState('reel')}
      <button class="secondary small" data-grid-send="${key}" data-kind="story"${sent('story')?' data-resend="1"':''}>${sent('story')?'Send Story again':'Send as Story draft'}</button>${sendState('story')}
    </div>`:'';
  const video=g.video&&!busy?`<div class="grid-video"><video controls playsinline preload="none" src="${media(e,`grid-${g.date}.mp4`)}"></video><a class="button-link" href="${media(e,`grid-${g.date}.mp4`)}" download="story-${g.date}.mp4">Download MP4</a></div>`:'';
  return `<section class="grid-day">
    <h4>${esc(g.name)} · <span data-grid-count="${key}">${picks.length}</span> of ${GRID_MAX} cards · ${g.events.length} ${g.events.length===1?'event':'events'} that day</h4>
    <div class="grid-label">
      <label>Day <input value="${esc(g.day)}" disabled></label>
      <label>Kicker <input data-grid-kicker="${key}" maxlength="24" value="${esc(s?.kicker||'Overview')}"${busy?' disabled':''}></label>
      <label>Category <input data-grid-category="${key}" maxlength="32" value="${esc(s?.category||'Arts & Culture')}"${busy?' disabled':''}></label>
      <label>Hold (s) <input data-grid-hold="${key}" type="number" min="2" max="15" step="1" value="${s?.holdSeconds||6}"${busy?' disabled':''}></label>
      <label>Opener <select data-grid-style="${key}"${busy?' disabled':''}>${[['ticket','Event ticket'],['envelope','Envelope']].map(([v,t])=>`<option value="${v}"${(s?.style||'ticket')===v?' selected':''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="grid-picks">${cards}</div>
    <div class="toolbar">
      <button class="secondary small" data-grid-suggest="${key}"${busy?' disabled':''}>Use suggestion</button>
      <button class="small" data-grid-build="${key}"${busy?' disabled':''}>${g.collage?'Rebuild grid':'Build grid'}</button>
      <button class="small" data-grid-render="${key}"${!g.collage||busy||!renderConfigured?' disabled':''}>${busy?'Rendering…':g.video?'Render video again':'Render story video'}</button>
    </div>
    <p class="hint${s?.status==='failed'?' error':''}">${gridState(g)}</p>
    <div class="grid-output">${preview}${video}</div>
    ${send}
  </section>`;
}
function gridSection(e){
  if(!e.grids?.length) return '';
  return `<details class="grids" data-open-key="grids-${e.id}"${openGrids.has(`grids-${e.id}`)?' open':''}><summary>Story grids · story video per day</summary>
    <p class="hint">Tick up to ${GRID_MAX} cards for a day and build its grid. The video opens with the day's ticket (or the envelope), reveals the grid and holds it full screen with the day on top. Changing the opener needs a rebuild. ${e.approved?'Only events you approved are offered.':'Changing which events you publish later does not change a grid you already built.'}</p>
    ${e.grids.map(g=>gridBlock(e,g)).join('')}
  </details>`;
}

function edition(e){
  const missing=e.data.events.length-new Set([...e.uploads,...e.organiserPhotos]).size;
  const state=e.demo?'Demo content · fictional events':e.approved?'Approved · Instagram is in Postiz, WhatsApp is sent on demand':'Ready for your review';
  const posts=e.posts.map(d=>`<section class="day"><h4>${esc(d.name)} · ${d.indexes.length} ${d.indexes.length===1?'event':'events'} · one Instagram post</h4><div class="cards"><a class="cover" href="${media(e,`cover-${d.date}-${d.part}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`cover-${d.date}-${d.part}.jpg`)}" alt="${esc(d.name)} cover slide"></a>${d.indexes.map(i=>`<a href="${media(e,`feed-${i}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`feed-${i}.jpg`)}" alt="Slide for event ${i+1}"></a>`).join('')}</div><details><summary>Caption for this post</summary><pre>${esc(d.caption)}</pre></details></section>`).join('');
  const rows=e.data.events.map((x,i)=>`<li><label><input type="checkbox" data-edition="${e.id}" value="${i}"${(!e.approved||!e.selected||e.selected.includes(i))?' checked':''}${e.approved||e.demo?' disabled':''}><span><strong>${esc(x.title)}</strong><br>${esc(new Date(x.startsAt).toLocaleString('en-GB',{timeZone:'Europe/Riga',dateStyle:'medium',timeStyle:'short'}))} · ${esc(x.venue)} · ${esc(x.price)}<br>${esc(x.summary)}<br><a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>${e.shortLinks?.[i]?` · <span class="short">${esc(e.shortLinks[i].url)} · ${e.shortLinks[i].clicks} ${e.shortLinks[i].clicks===1?'click':'clicks'}</span>`:''}</span></label>${e.demo?'':alsoRow(e,i)+photoRow(e,i)}</li>`).join('');
  return `<article class="edition">
    <div class="edition-head"><div><h3>Weekend of ${esc(e.weekend)}</h3><p>${state} · ${e.data.events.length} picks</p></div>${!e.demo&&!e.approved?`<button data-approve="${e.id}">Approve & send to Postiz</button>`:''}</div>
    ${publishing(e)}
    ${posts}
    ${gridSection(e)}
    <details><summary>Story previews</summary><div class="cards">${e.data.events.map((_,i)=>`<a href="${media(e,`story-${i}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`story-${i}.jpg`)}" alt="Event ${i+1} story image"></a>`).join('')}</div></details>
    <details ${e.approved||e.demo?'':'open'}><summary>${e.approved?'Events in this edition':'Choose what to publish'} · ${e.data.events.length} found${e.demo?'':` · ${missing} without a photo`}</summary>
      ${e.approved||e.demo?'':`<p class="hint">Untick events to leave them out. Tick Story to also get a story draft in Postiz for that event. Tick the other days an exhibition, festival or repeated show is also on, so its day tag shows them. Photos must be final before approving, because they go to Postiz then.${ejuz?' Caption links become ej.uz links when you approve.':''}</p>`}
      <ol class="event-list picks">${rows}</ol>
      ${e.approved||e.demo?'':`<div class="toolbar"><button class="secondary" data-all="${e.id}">Select all</button><button class="secondary" data-none="${e.id}">Clear</button></div>`}
    </details>
    <div class="copy"><details><summary>WhatsApp digest preview</summary><pre>${esc(e.whatsapp)}</pre></details></div>
  </article>`;
}

async function load(){
  stamp=Date.now();
  const [status,editions]=await Promise.all([api('/api/status'),api(`/api/editions${showPast?'?scope=all':''}`)]);
  const past=Number(api.headers?.get('X-Past-Editions')||0);
  postizUrl=status.postizUrl; ejuz=status.ejuz; renderConfigured=status.renderConfigured;
  $('#mode').textContent=status.live?'LIVE DELIVERY ENABLED':'PREVIEW MODE';
  $('#runs').textContent=status.runs.length?status.runs.map(r=>`${r.weekend} · ${r.status} · ${r.detail||''}`).join('\n'):'No scheduled research runs yet.';
  // Only the newest edition is open: older ones stay collapsed so their images are never fetched.
  $('#editions').innerHTML=editions.length?editions.map((e,i)=>i===0?edition(e):`<details class="older" data-open-key="edition-${e.id}"${openGrids.has(`edition-${e.id}`)?' open':''}><summary>Weekend of ${esc(e.weekend)} · ${e.data.events.length} picks${e.demo?' · demo':e.approved?' · approved':''}</summary>${edition(e)}</details>`).join(''):'<p class="empty">No editions yet. Find events, import your research, or run <code>docker compose run --rm app node src/cli.js demo</code> to see a sample.</p>';
  // Weekends that are over are kept on the server but not listed, so the page stays light.
  if(past||showPast) $('#editions').insertAdjacentHTML('beforeend',`<p class="empty past-note">${showPast?'Showing past weekends too.':`${past} past ${past===1?'weekend is':'weekends are'} hidden.`} <button class="secondary small" id="past">${showPast?'Hide past weekends':'Show past weekends'}</button></p>`);
  if(editions.some(e=>e.grids?.some(g=>g.saved?.status==='rendering'))) watchRenders();
  await loadFootage().catch(e=>{$('#clips').innerHTML=`<p class="empty error">${esc(e.message)}</p>`;});
}
// While a story renders, check quietly and only redraw the page once it has finished, so ticks
// you are changing on another day are not reset every few seconds.
let watching=null;
function watchRenders(){
  if(watching) return;
  watching=setInterval(async()=>{
    try{
      const editions=await api('/api/editions');
      if(!editions.some(e=>e.grids?.some(g=>g.saved?.status==='rendering'))){clearInterval(watching);watching=null;await load();}
    }catch{}
  },5000);
}
const gridKey=key=>{const [id,date]=key.split('|');return {id,date};};
const gridPicks=key=>[...document.querySelectorAll(`input[data-grid="${CSS.escape(key)}"]:checked`)].map(x=>Number(x.value));

$('#refresh').onclick=()=>action(load);
$('#research').onclick=()=>action(async()=>{const b=$('#research');b.disabled=true;try{await api('/api/research',{});}finally{b.disabled=false;}});
$('#import').onclick=()=>action(()=>api('/api/editions',JSON.parse($('#json').value)));
document.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(footageClick(b)) return;
  if(b.dataset.upload){
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.onchange=()=>{const f=input.files[0];if(!f)return;action(async()=>{const r=await fetch(`/api/editions/${b.dataset.upload}/events/${b.dataset.index}/photo`,{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream'},body:f});const d=await r.json();if(!r.ok)throw Error(d.error||'Upload failed');});};
    input.click();return;
  }
  if(b.dataset.unphoto){action(async()=>{const r=await fetch(`/api/editions/${b.dataset.unphoto}/events/${b.dataset.index}/photo`,{method:'DELETE'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not remove the photo');});return;}
  if(b.dataset.all||b.dataset.none){const on=!!b.dataset.all;document.querySelectorAll(`input[data-edition="${b.dataset.all||b.dataset.none}"]`).forEach(x=>{x.checked=on;});return;}
  if(b.dataset.approve){
    const id=b.dataset.approve;
    const picks=[...document.querySelectorAll(`input[data-edition="${id}"]:checked`)].map(x=>Number(x.value));
    if(!picks.length){$('#status').textContent='Tick at least one event to publish.';$('#status').className='error';return;}
    const stories=[...document.querySelectorAll(`input[data-story="${id}"]:checked`)].map(x=>Number(x.value)).filter(i=>picks.includes(i));
    const msg=`Send ${picks.length} event${picks.length===1?'':'s'} to Postiz?\n\nCarousels are scheduled at their default times, and you can move them in Postiz.\n${stories.length?`${stories.length} ${stories.length===1?'story is':'stories are'} added as drafts for you to schedule.`:'No stories are ticked.'}\nWhatsApp is not sent until you press its button.\n\nPhotos can no longer be changed here after this.`;
    if(confirm(msg)) action(()=>api(`/api/editions/${id}/approve`,{events:picks,stories}));
    return;
  }
  if(b.dataset.whatsapp){
    const resend=!!b.dataset.resend;
    if(confirm(resend?'The digest was already sent to the WhatsApp group. Send it again?':'Send the WhatsApp digest to the group now?')) action(()=>api(`/api/editions/${b.dataset.whatsapp}/whatsapp`,{resend}));
    return;
  }
  if(b.id==='past'){showPast=!showPast;action(load);return;}
  if(b.dataset.gridSuggest){
    const g=gridInfo.get(b.dataset.gridSuggest);
    document.querySelectorAll(`input[data-grid="${CSS.escape(b.dataset.gridSuggest)}"]`).forEach(x=>{x.checked=g.suggested.includes(Number(x.value));});
    $(`[data-grid-count="${CSS.escape(b.dataset.gridSuggest)}"]`).textContent=g.suggested.length;
    return;
  }
  if(b.dataset.gridBuild){
    const key=b.dataset.gridBuild, {id,date}=gridKey(key), picks=gridPicks(key), q=s=>$(`[data-grid-${s}="${CSS.escape(key)}"]`);
    if(!picks.length){$('#status').textContent='Tick at least one card for the grid.';$('#status').className='error';return;}
    openGrids.add(`grids-${id}`);
    action(()=>api(`/api/editions/${id}/grids/${date}`,{events:picks,kicker:q('kicker').value,category:q('category').value,holdSeconds:Number(q('hold').value)||6,style:q('style').value}));
    return;
  }
  if(b.dataset.gridSend){
    const {id,date}=gridKey(b.dataset.gridSend), kind=b.dataset.kind, resend=!!b.dataset.resend;
    const what=kind==='reel'?'Reel':'Story';
    if(!confirm(`${resend?`Send this ${what} to Postiz again? A second draft will be created.`:`Send this ${what} to Postiz?`}\n\nIt arrives as a DRAFT: watch it in Postiz and schedule it there. Nothing publishes by itself.`)) return;
    openGrids.add(`grids-${id}`);
    action(()=>api(`/api/editions/${id}/grids/${date}/postiz`,{kind,resend}));
    return;
  }
  if(b.dataset.gridRender){
    const {id,date}=gridKey(b.dataset.gridRender);
    openGrids.add(`grids-${id}`);
    action(()=>api(`/api/editions/${id}/grids/${date}/render`,{}));
    return;
  }
  if(b.dataset.retry&&confirm('Have you checked Postiz or WhatsApp and confirmed this did NOT go out? Retrying can create a duplicate.'))action(()=>api(`/api/jobs/${b.dataset.retry}/resolve`,{action:'retry'}));
  if(b.dataset.sent)action(()=>api(`/api/jobs/${b.dataset.sent}/resolve`,{action:'confirm_sent'}));
});
document.addEventListener('toggle',ev=>{const d=ev.target;if(d.dataset?.openKey){if(d.open)openGrids.add(d.dataset.openKey);else openGrids.delete(d.dataset.openKey);}},true);
document.addEventListener('change',ev=>{
  const tick=ev.target.closest('input[data-grid]');
  if(tick){
    const key=tick.dataset.grid, picks=gridPicks(key);
    if(picks.length>GRID_MAX){tick.checked=false;$('#status').textContent=`A grid holds at most ${GRID_MAX} cards.`;$('#status').className='error';return;}
    $(`[data-grid-count="${CSS.escape(key)}"]`).textContent=picks.length;
    return;
  }
  const box=ev.target.closest('input[data-also]');if(!box)return;
  const {also:id,index}=box.dataset;
  const dates=[...document.querySelectorAll(`input[data-also="${id}"][data-index="${index}"]:checked`)].map(x=>x.value);
  action(()=>api(`/api/editions/${id}/events/${index}/also-on`,{alsoOn:dates}));
});
// Your footage: clips ChatGPT animates through the app's MCP tools. The page shows each clip, the pictures an
// edit can use, and what has been rendered, for you to watch and download.
let footageRenderable=false, footageSig='', footageWatch=null;
const depthBusy=c=>['queued','running'].includes(c.depthJob?.status);
const clipBusy=c=>['uploading','processing'].includes(c.status)||depthBusy(c), renderBusy=r=>['queued','rendering'].includes(r.status);
const clipFile=(c,file)=>`/footage/${c.id}/${file}`;
function renderRow(c,r){
  const what=r.kind==='stills'?`Preview stills · edit v${r.version}`:`${r.requested?.quality==='final'?'Video':'Draft video, half size'} · edit v${r.version}`;
  const state=r.status==='queued'?'Waiting for the renderer…':r.status==='rendering'?'Rendering…':r.status==='failed'?`<span class="error">Failed: ${esc(r.error||'')}</span>`:esc(riga(r.updated));
  const file=r.status==='ready'&&r.file;
  const media=!file?'':r.kind==='stills'
    ?`<a href="${clipFile(c,`renders/${file}`)}" target="_blank" rel="noopener"><img loading="lazy" src="${clipFile(c,`renders/${file}`)}" alt="Preview stills"></a>`
    :`<video controls playsinline preload="none" src="${clipFile(c,`renders/${file}`)}"></video>${r.sheet?`<a href="${clipFile(c,`renders/${r.sheet}`)}" target="_blank" rel="noopener"><img loading="lazy" src="${clipFile(c,`renders/${r.sheet}`)}" alt="Frames from this video"></a>`:''}<a class="button-link" href="${clipFile(c,`renders/${file}`)}" download="${esc(c.name.replace(/\.[^.]+$/,''))}-v${r.version}.mp4">Download MP4</a>`;
  return `<li><strong>${what}</strong><span class="job-state ${r.status}">${state}</span>${media}</li>`;
}
function clipCard(c){
  const busy=c.renders.some(renderBusy), last=c.edits[c.edits.length-1], ready=c.status==='ready';
  const state=ready?'':c.status==='failed'?`<span class="tag missing">Failed</span> ${esc(c.error||'')}`:`<span class="tag ok">${c.status==='uploading'?'Uploading':'Processing'}${c.progress?` ${Math.round(c.progress*100)}%`:'…'}</span>`;
  const meta=ready?`${c.blank?'Animation · ':''}${c.seconds.toFixed(1)} s · ${c.width}×${c.height} · ${c.frames} frames at 30 fps${c.audio?' · with sound':''}${c.source?.hdr?' · HDR, converted':''}`:'';
  const poster=c.blank?`<div class="blank canvas"><span>${c.width}×${c.height}</span></div>`
    :ready?`<a href="${clipFile(c,'work.mp4')}" target="_blank" rel="noopener"><img src="${clipFile(c,'poster.jpg')}" alt="${esc(c.name)}"></a>`:'<div class="blank"></div>';
  const edit=last?`Edit version ${last.version}${last.note?` · ${esc(last.note)}`:''} · saved ${esc(riga(last.created))}`
    :c.blank?'No edit yet. In ChatGPT, ask it to make the animation.':'No edit yet. In ChatGPT, ask it to animate this clip.';
  // Every version kept, newest first, so you can see how an animation got to where it is.
  const history=c.edits.length>1?`<details class="versions"><summary>${c.edits.length} versions</summary><ol reversed>${c.edits.slice().reverse().map(v=>`<li><strong>v${v.version}</strong> · ${esc(riga(v.created))}${v.note?`<br><span class="hint">${esc(v.note)}</span>`:''}</li>`).join('')}</ol></details>`:'';
  const pictures=c.assets.map(a=>`<figure><a href="${clipFile(c,`assets/${a.name}.png`)}?v=${stamp}" target="_blank" rel="noopener"><img loading="lazy" src="${clipFile(c,`assets/${a.name}.png`)}?v=${stamp}" alt="${esc(a.name)}"></a><span>${esc(a.name)} · ${a.width}×${a.height}</span><button class="secondary small" data-unasset="${c.id}" data-name="${esc(a.name)}">Remove</button></figure>`).join('');
  const models=(c.models||[]).map(m=>`<li><strong>${esc(m.name)}</strong> · ${m.animations.length?`animations: ${m.animations.map(a=>esc(a.name)).join(', ')}`:'no animations'} · ${m.mb} MB <button class="secondary small" data-unmodel="${c.id}" data-name="${esc(m.name)}">Remove</button></li>`).join('');
  const sounds=(c.sounds||[]).map(x=>`<li><strong>${esc(x.name)}</strong> · ${x.seconds.toFixed(1)} s <audio controls preload="none" src="${clipFile(c,`sounds/${x.name}.wav`)}?v=${stamp}"></audio> <button class="secondary small" data-unsound="${c.id}" data-name="${esc(x.name)}">Remove</button></li>`).join('');
  const job=c.depthJob, mid=c.depth?String(Math.floor(c.depth.frames/2)).padStart(5,'0'):null;
  const depthState=depthBusy(c)?`<span class="tag ok">${job.status==='queued'?'Waiting to make depth…':`Making depth… ${Math.round((job.progress||0)*100)}%`}</span> about ${Math.max(1,Math.round(job.estimateSeconds/60))} min in all`
    :job?.status==='failed'?`<span class="tag missing">Depth failed</span> ${esc(job.error||'')}`:'';
  const depth=`${c.depth?`<div class="pictures"><figure><a href="${clipFile(c,`depth/${mid}.jpg`)}?v=${stamp}" target="_blank" rel="noopener"><img loading="lazy" src="${clipFile(c,`depth/${mid}.jpg`)}?v=${stamp}" alt="Depth of frame ${Number(mid)}"></a><span>Depth for all ${c.depth.frames} frames · ${c.depth.source==='server'?'made here':'uploaded'}</span></figure></div>`:''}
      ${depthState?`<p class="hint">${depthState}</p>`:''}<button class="secondary small" data-depth="${c.id}"${depthBusy(c)?' disabled':''}>${c.depth?'Make depth again':'Make depth'}</button>`;
  const off=!last||!footageRenderable||busy?' disabled':'';
  return `<article class="clip">
    <div class="clip-poster">${poster}</div>
    <div>
      <h3>${esc(c.name)}</h3>
      <p class="meta">${meta} ${state}</p>
      <div class="id">Clip id ${c.id}</div>
      ${ready?`<h4>Edit</h4><p class="hint">${edit}</p>${history}
      <div class="toolbar"><button class="small" data-clip-render="${c.id}" data-quality="final"${off}>Render video</button><button class="secondary small" data-clip-render="${c.id}" data-quality="draft"${off}>Quick draft (half size)</button></div>
      ${footageRenderable?'':'<p class="hint">The render service is not configured (RENDER_URL), so edits cannot be rendered here yet.</p>'}
      <h4>Pictures</h4><p class="hint">Images an edit can use by name: an illustrated frame to line up over the footage, a logo, a drawing. PNG keeps transparency.</p>
      <div class="pictures">${pictures}<button class="secondary small" data-asset="${c.id}">Add picture</button></div>
      <h4>3D models</h4><p class="hint">Animated models (.glb, textures embedded) an edit can place in the shot, e.g. a cat that walks and sits.</p>
      ${models?`<ul class="models">${models}</ul>`:''}<button class="secondary small" data-model="${c.id}">Add 3D model</button>
      <h4>Sounds</h4><p class="hint">Sound effects and music an edit can place on exact frames: steps, a whoosh, a poof. MP3, WAV, OGG, FLAC or M4A, up to 3 minutes.</p>
      ${sounds?`<ul class="models sounds">${sounds}</ul>`:''}<button class="secondary small" data-sound="${c.id}">Add sound</button>
      ${c.blank?'':`<h4>Depth</h4><p class="hint">How far away each part of the shot is (near is white), so animations can pass behind things and edits can blur or fog by distance. Made on this server in a few minutes.</p>
      ${depth}`}`:''}
      ${c.renders.length?`<h4>Renders</h4><ul class="renders">${c.renders.map(r=>renderRow(c,r)).join('')}</ul>`:''}
      <div class="toolbar">${c.status==='failed'?`<button class="secondary small" data-clip-retry="${c.id}">Retry processing</button>`:''}<button class="secondary small" data-clip-delete="${c.id}"${busy||clipBusy(c)?' disabled':''}>Delete ${c.blank?'animation':'clip'}</button></div>
    </div>
  </article>`;
}
// Redraw only when something changed, so a video you are watching is not reset by the refresh.
// Everything ever rendered, newest first, whatever it came from. Separate from the cards above, which
// only show a clip's own recent renders.
let renderSig='';
function historyRow(r){
  const what=r.kind==='stills'?`Preview stills · edit v${r.version}`:`${r.requested?.quality==='final'?'Video':'Draft video, half size'} · edit v${r.version}`;
  const from=r.gone?'<span class="tag missing">deleted</span>':`${esc(r.name||r.footage)}${r.blank?' <span class="tag ok">animation</span>':''}`;
  const state=r.status==='queued'?'Waiting for the renderer…':r.status==='rendering'?'Rendering…':r.status==='failed'?`<span class="error">Failed: ${esc(r.error||'')}</span>`:esc(riga(r.updated));
  const file=r.status==='ready'&&r.file&&!r.gone?`/footage/${r.footage}/renders/${r.file}`:null;
  const open=!file?'':r.kind==='stills'
    ?`<a href="${file}" target="_blank" rel="noopener">Open stills</a>`
    :`<a href="${file}" target="_blank" rel="noopener">Watch</a> <a href="${file}" download="${esc((r.name||'render').replace(/\.[^.]+$/,''))}-v${r.version}.mp4">Download</a>`;
  return `<tr><td>${esc(riga(r.created))}</td><td>${from}</td><td>${what}</td><td class="job-state ${r.status}">${state}</td><td>${open}</td></tr>`;
}

async function loadRenders(){
  const d=await api('/api/renders?limit=200');
  const sig=JSON.stringify(d.renders.map(r=>[r.render,r.status]));
  if(sig===renderSig) return d;
  renderSig=sig;
  $('#renders').innerHTML=d.renders.length
    ?`<table class="history-table"><thead><tr><th>Made</th><th>From</th><th>What</th><th>How it went</th><th></th></tr></thead><tbody>${d.renders.map(historyRow).join('')}</tbody></table>`
    :'<p class="empty">Nothing has been rendered yet.</p>';
  return d;
}

function showFootage(d){
  footageRenderable=d.renderConfigured;
  const sig=JSON.stringify(d.footage.map(c=>[c.id,c.status,c.progress,c.name,c.edits.length,c.assets,c.models,c.sounds,c.depth,c.depthJob,c.renders.map(r=>[r.render,r.status])]));
  if(sig===footageSig) return;
  footageSig=sig;
  $('#clips').innerHTML=d.footage.length?d.footage.map(clipCard).join(''):`<p class="empty">No footage yet. Upload a clip (up to ${d.limits.mb} MB and ${Math.round(d.limits.seconds/60)} minutes) to start.</p>`;
}
async function loadFootage(){
  footageSig='';
  const d=await api('/api/footage'); showFootage(d);
  loadRenders().catch(()=>{});
  if(d.footage.some(c=>clipBusy(c)||c.renders.some(renderBusy))) watchFootage();
}
function watchFootage(){
  if(footageWatch) return;
  footageWatch=setInterval(async()=>{
    try{const d=await api('/api/footage');showFootage(d);if(!d.footage.some(c=>clipBusy(c)||c.renders.some(renderBusy))){clearInterval(footageWatch);footageWatch=null;}}catch{}
  },4000);
}
const pickFile=accept=>new Promise(ok=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.onchange=()=>ok(input.files[0]||null);input.click();});
// Uploads stream to the server, so a large clip shows its progress instead of a frozen page.
function sendFile(url,file){
  return new Promise((ok,fail)=>{
    const x=new XMLHttpRequest();x.open('POST',url);x.setRequestHeader('Content-Type',file.type||'application/octet-stream');
    x.upload.onprogress=e=>{if(e.lengthComputable)$('#status').textContent=`Uploading ${file.name}… ${Math.round((e.loaded/e.total)*100)}%`;};
    x.onload=()=>{let d={};try{d=JSON.parse(x.responseText);}catch{}if(x.status<300)ok(d);else fail(Error(d.error||`Upload failed (HTTP ${x.status})`));};
    x.onerror=()=>fail(Error('Upload failed: the connection dropped'));
    x.send(file);
  });
}
const removeAt=async url=>{const r=await fetch(url,{method:'DELETE'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not remove it');};
function footageClick(b){
  if(b.id==='upload-footage'){pickFile('video/*').then(f=>{if(f)action(()=>sendFile(`/api/footage?name=${encodeURIComponent(f.name)}`,f));});return true;}
  // An animation with no clip behind it: ChatGPT fills it in afterwards, like any other edit.
  if(b.id==='new-animation'){
    const name=prompt('What is this animation? (a name for the dashboard)','Animation');
    if(!name)return true;
    const format=prompt('Shape: vertical, portrait, square or landscape','vertical');
    if(!format)return true;
    const seconds=Number(prompt('How many seconds?','6'));
    action(()=>api('/api/animations',{name:name.trim(),format:format.trim(),seconds:seconds>0?seconds:6}));
    return true;
  }
  if(b.dataset.asset){
    pickFile('image/png,image/jpeg,image/webp').then(f=>{
      if(!f)return;
      const suggested=f.name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'picture';
      const name=prompt('Name for this picture (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',suggested);
      if(name) action(()=>sendFile(`/api/footage/${b.dataset.asset}/assets/${encodeURIComponent(name.trim())}`,f));
    });
    return true;
  }
  if(b.dataset.model){
    pickFile('.glb,model/gltf-binary').then(f=>{
      if(!f)return;
      const suggested=f.name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'model';
      const name=prompt('Name for this model (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',suggested);
      if(name) action(()=>sendFile(`/api/footage/${b.dataset.model}/models/${encodeURIComponent(name.trim())}`,f));
    });
    return true;
  }
  if(b.dataset.sound){
    pickFile('audio/*,.mp3,.wav,.ogg,.flac,.m4a').then(f=>{
      if(!f)return;
      const suggested=f.name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'sound';
      const name=prompt('Name for this sound (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',suggested);
      if(name) action(()=>sendFile(`/api/footage/${b.dataset.sound}/sounds/${encodeURIComponent(name.trim())}`,f));
    });
    return true;
  }
  if(b.dataset.unsound){if(confirm(`Remove the sound "${b.dataset.name}"? Edits that use it will not render until it is back.`))action(()=>removeAt(`/api/footage/${b.dataset.unsound}/sounds/${b.dataset.name}`));return true;}
  if(b.dataset.unmodel){if(confirm(`Remove the model "${b.dataset.name}"? Edits that use it will not render until it is back.`))action(()=>removeAt(`/api/footage/${b.dataset.unmodel}/models/${b.dataset.name}`));return true;}
  if(b.dataset.unasset){if(confirm(`Remove the picture "${b.dataset.name}"? Edits that use it will not render until it is back.`))action(()=>removeAt(`/api/footage/${b.dataset.unasset}/assets/${b.dataset.name}`));return true;}
  if(b.dataset.depth){action(async()=>{await api(`/api/footage/${b.dataset.depth}/depth`,{});watchFootage();});return true;}
  if(b.dataset.clipRender){action(()=>api(`/api/footage/${b.dataset.clipRender}/renders`,{quality:b.dataset.quality}));return true;}
  if(b.dataset.clipRetry){action(()=>api(`/api/footage/${b.dataset.clipRetry}/retry`,{}));return true;}
  if(b.dataset.clipDelete){if(confirm('Delete this clip with its edits, pictures, models, sounds and renders? Download anything you want to keep first.'))action(()=>removeAt(`/api/footage/${b.dataset.clipDelete}`));return true;}
  return false;
}
load().catch(e=>{$('#status').textContent=e.message;});
