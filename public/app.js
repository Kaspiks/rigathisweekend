const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');api.headers=r.headers;return data;}
async function action(fn){try{$('#status').textContent='Working…';$('#status').className='';await fn();await load();$('#status').textContent='Done.';}catch(e){$('#status').textContent=e.message;$('#status').className='error';}}
const riga=t=>t?new Date(t).toLocaleString('en-GB',{timeZone:'Europe/Riga',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
let stamp=Date.now(), postizUrl=null, ejuz=false, renderConfigured=false, showPast=false, families=[], tones=[];
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

// Other days an event is also on, Monday to Sunday of the weekend's week. They only change the day tag on
// its slides: the event is still posted once, on its own day. Editable on drafts; shown as text once approved.
const weekday=d=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'});
function alsoRow(e,i){
  const x=e.data.events[i], set=x.alsoOn||[], days=e.tagDays||e.weekendDays, own=e.eventDates[i];
  if(e.approved) return set.length?`<div class="also">Also on ${set.map(weekday).join(', ')}</div>`:'';
  return `<div class="also">Also on:${days.map(d=>d===own?`<span class="also-own">${weekday(d)}</span>`:`<label${e.weekendDays.includes(d)?'':' class="weekday"'}><input type="checkbox" data-also="${e.id}" data-index="${i}" value="${d}"${set.includes(d)?' checked':''}> ${weekday(d)}</label>`).join('')}</div>`;
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
  // A card already used in a story, or left out of the weekend's posts, is greyed out and cannot be ticked.
  const cards=g.events.map(x=>`<label class="grid-pick${x.blocked?' used':''}" data-pick="${e.id}|${x.index}"${x.blocked?' data-always-blocked="1"':''}><input type="checkbox" data-grid="${key}" value="${x.index}"${picks.includes(x.index)&&!x.blocked?' checked':''}${busy||x.blocked?' disabled':''}><img ${lazy} src="${thumb(e,`feed-${x.index}.jpg`)}" alt=""><span>${esc(x.title)}<small>${esc(x.time)}</small>${x.blocked?`<small class="why">${esc(x.blocked)}</small>`:''}</span></label>`).join('');
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
    <h4>${esc(g.name)} · <span data-grid-count="${key}">${picks.length}</span> of ${GRID_MAX} cards · ${g.events.length} ${g.events.length===1?'event':'events'} ${g.date==='weekend'?'across the weekend':'that day'}</h4>
    <div class="grid-label">
      <label>Day <input value="${esc(g.day)}" disabled></label>
      <label>Kicker <input data-grid-kicker="${key}" maxlength="24" value="${esc(s?.kicker||'Overview')}"${busy?' disabled':''}></label>
      <label>Category <input data-grid-category="${key}" maxlength="32" value="${esc(s?.category||'Arts & Culture')}"${busy?' disabled':''}></label>
      <label>Hold (s) <input data-grid-hold="${key}" type="number" min="2" max="15" step="1" value="${s?.holdSeconds||6}"${busy?' disabled':''}></label>
      <label>Opener <select data-grid-style="${key}"${busy?' disabled':''}>${[['ticket','Event ticket'],['envelope','Envelope'],['leaves','Leaf gust'],['bag','Harvest bag'],['book','Pressed leaf'],['mark','Leave your mark'],['sketch','Sketchbook'],['pinboard','Pinboard']].map(([v,t])=>`<option value="${v}"${(s?.style||'ticket')===v?' selected':''}>${t}</option>`).join('')}</select></label>
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
    <p class="hint">Tick up to ${GRID_MAX} cards for a day and build its grid. Cards already used in a story, or left out of this weekend's posts, are greyed out. The video opens with the day's ticket (or the envelope), reveals the grid and holds it full screen with the day on top. Changing the opener needs a rebuild. ${e.approved?'Only events you approved are offered.':'Changing which events you publish later does not change a grid you already built.'}</p>
    ${e.grids.map(g=>gridBlock(e,g)).join('')}
  </details>`;
}

// Colours: the week has a family (shared accent, so the week reads as one group) and each day a tone of it
// (so the days tell apart). One tone per day, so every part of a split day changes together; fixed once approved.
const familyName=k=>families.find(f=>f.key===k)?.name||k, toneName=k=>tones.find(t=>t.key===k)?.name||k;
function palettePicker(e){
  if(e.approved) return `<p class="palette"><span class="theme-now">Week colours: ${esc(familyName(e.palette))}</span></p>`;
  return `<div class="palette"><span class="palette-label">Week colours</span><div class="themes" role="group" aria-label="Colour family for this week">${families.map(f=>`<button class="swatch swatch-family-${esc(f.key)}" data-palette="${esc(f.key)}" data-palette-edition="${e.id}" title="${esc(f.name)}" aria-label="${esc(f.name)}" aria-pressed="${f.key===e.palette}"></button>`).join('')}<span class="theme-now">${esc(familyName(e.palette))}${e.paletteChosen?'':' · this week’s default'}</span></div></div>`;
}
function themePicker(e,d){
  if(e.approved) return `<span class="theme-now">${esc(familyName(e.palette))} · ${esc(toneName(d.tone))}</span>`;
  if(d.part>1) return '';
  return `<div class="themes" role="group" aria-label="Tone for ${esc(d.name)}">${tones.map(t=>`<button class="swatch swatch-${esc(e.palette)}-${esc(t.key)}" data-tone="${esc(t.key)}" data-theme-edition="${e.id}" data-theme-date="${d.date}" title="${esc(t.name)}" aria-label="${esc(t.name)}" aria-pressed="${t.key===d.tone}"></button>`).join('')}<span class="theme-now">${esc(toneName(d.tone))}</span></div>`;
}
function edition(e){
  const missing=e.data.events.length-new Set([...e.uploads,...e.organiserPhotos]).size;
  const state=e.demo?'Demo content · fictional events':e.approved?'Approved · Instagram is in Postiz, WhatsApp is sent on demand':'Ready for your review';
  const posts=e.posts.map(d=>`<section class="day"><div class="day-head"><h4>${esc(d.name)} · ${d.indexes.length} ${d.indexes.length===1?'event':'events'} · one Instagram post</h4>${themePicker(e,d)}</div><div class="cards"><a class="cover" href="${media(e,`cover-${d.date}-${d.part}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`cover-${d.date}-${d.part}.jpg`)}" alt="${esc(d.name)} cover slide"></a>${d.indexes.map(i=>`<a href="${media(e,`feed-${i}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`feed-${i}.jpg`)}" alt="Slide for event ${i+1}"></a>`).join('')}</div><details><summary>Caption for this post</summary><pre>${esc(d.caption)}</pre></details></section>`).join('');
  const rows=e.data.events.map((x,i)=>`<li><label><input type="checkbox" data-edition="${e.id}" value="${i}"${(!e.approved||!e.selected||e.selected.includes(i))?' checked':''}${e.approved||e.demo?' disabled':''}><span><strong>${esc(x.title)}</strong><br>${esc(new Date(x.startsAt).toLocaleString('en-GB',{timeZone:'Europe/Riga',dateStyle:'medium',timeStyle:'short'}))} · ${esc(x.venue)} · ${esc(x.price)}<br>${esc(x.summary)}<br><a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>${e.shortLinks?.[i]?` · <span class="short">${esc(e.shortLinks[i].url)} · ${e.shortLinks[i].clicks} ${e.shortLinks[i].clicks===1?'click':'clicks'}</span>`:''}</span></label>${e.demo?'':alsoRow(e,i)+photoRow(e,i)}</li>`).join('');
  return `<article class="edition">
    <div class="edition-head"><div>${e.headline?`<span class="tag special">Special post</span>`:''}<h3>${e.headline?`${esc(e.headline)} · `:''}Weekend of ${esc(e.weekend)}</h3><p>${state} · ${e.data.events.length} picks</p></div>${!e.demo&&!e.approved?`<button data-approve="${e.id}">Approve & send to Postiz</button>`:''}</div>
    ${publishing(e)}
    ${e.demo?'':palettePicker(e)}
    ${posts}
    ${gridSection(e)}
    <details><summary>Story previews</summary><div class="cards">${e.data.events.map((_,i)=>`<a href="${media(e,`story-${i}.jpg`)}" target="_blank" rel="noopener"><img ${lazy} src="${thumb(e,`story-${i}.jpg`)}" alt="Event ${i+1} story image"></a>`).join('')}</div></details>
    <details ${e.approved||e.demo?'':'open'}><summary>${e.approved?'Events in this edition':'Choose what to publish'} · ${e.data.events.length} found${e.demo?'':` · ${missing} without a photo`}</summary>
      ${e.approved||e.demo?'':`<p class="hint">Untick events to leave them out. Tick Story to also get a story draft in Postiz for that event. Tick the other days an exhibition, festival or repeated show is also on, Monday to Sunday, so its day tag shows them. It is still posted only on its own day. Photos must be final before approving, because they go to Postiz then.${ejuz?' Caption links become ej.uz links when you approve.':''}</p>`}
      <ol class="event-list picks">${rows}</ol>
      ${e.approved||e.demo?'':`<div class="toolbar"><button class="secondary" data-all="${e.id}">Select all</button><button class="secondary" data-none="${e.id}">Clear</button><button class="secondary" data-special="${e.id}">Make a special post from the ticked events…</button></div>
      <p class="hint">A special post has your own heading (such as Researchers’ Night) on its cover, above the date, and goes out as a separate carousel at noon, alongside the regular post for that day. It appears as its own edition below, for you to approve. Untick those events here if they should not also be in the regular post.</p>`}
    </details>
    <div class="copy"><details><summary>WhatsApp digest preview</summary><pre>${esc(e.whatsapp)}</pre></details></div>
  </article>`;
}

async function load(){
  stamp=Date.now();
  const [status,editions]=await Promise.all([api('/api/status'),api(`/api/editions${showPast?'?scope=all':''}`)]);
  const past=Number(api.headers?.get('X-Past-Editions')||0);
  postizUrl=status.postizUrl; ejuz=status.ejuz; renderConfigured=status.renderConfigured; families=status.families||[]; tones=status.tones||[];
  $('#mode').textContent=status.live?'LIVE DELIVERY ENABLED':'PREVIEW MODE';
  $('#runs').textContent=status.runs.length?status.runs.map(r=>`${r.weekend} · ${r.status} · ${r.detail||''}`).join('\n'):'No scheduled research runs yet.';
  // Only the newest edition is open: older ones stay collapsed so their images are never fetched.
  $('#editions').innerHTML=editions.length?editions.map((e,i)=>i===0?edition(e):`<details class="older" data-open-key="edition-${e.id}"${openGrids.has(`edition-${e.id}`)?' open':''}><summary>${e.headline?`${esc(e.headline)} · `:''}Weekend of ${esc(e.weekend)} · ${e.data.events.length} picks${e.demo?' · demo':e.approved?' · approved':''}</summary>${edition(e)}</details>`).join(''):'<p class="empty">No editions yet. Find events, import your research, or run <code>docker compose run --rm app node src/cli.js demo</code> to see a sample.</p>';
  // Weekends that are over are kept on the server but not listed, so the page stays light.
  if(past||showPast) $('#editions').insertAdjacentHTML('beforeend',`<p class="empty past-note">${showPast?'Showing past weekends too.':`${past} past ${past===1?'weekend is':'weekends are'} hidden.`} <button class="secondary small" id="past">${showPast?'Hide past weekends':'Show past weekends'}</button></p>`);
  if(editions.some(e=>e.grids?.some(g=>g.saved?.status==='rendering'))) watchRenders();
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
  if(b.dataset.upload){
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.onchange=()=>{const f=input.files[0];if(!f)return;action(async()=>{const r=await fetch(`/api/editions/${b.dataset.upload}/events/${b.dataset.index}/photo`,{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream'},body:f});const d=await r.json();if(!r.ok)throw Error(d.error||'Upload failed');});};
    input.click();return;
  }
  if(b.dataset.unphoto){action(async()=>{const r=await fetch(`/api/editions/${b.dataset.unphoto}/events/${b.dataset.index}/photo`,{method:'DELETE'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not remove the photo');});return;}
  if(b.dataset.tone||b.dataset.palette){
    const row=b.closest('.themes');
    if(b.getAttribute('aria-pressed')==='true'||document.querySelector('.themes.busy')) return;
    // Show the choice at once: redrawing takes a few seconds for a day, longer for the whole week, and the page reloads after.
    row.querySelectorAll('.swatch').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    row.classList.add('busy'); row.querySelector('.theme-now').textContent=`${b.title} · redrawing${b.dataset.palette?' every day':''}…`;
    const call=b.dataset.palette?api(`/api/editions/${b.dataset.paletteEdition}/palette`,{palette:b.dataset.palette})
      :api(`/api/editions/${b.dataset.themeEdition}/themes/${b.dataset.themeDate}`,{tone:b.dataset.tone});
    action(()=>call).finally(()=>{row.classList.remove('busy');if($('#status').className==='error') load();});
    return;
  }
  if(b.dataset.special){
    const id=b.dataset.special;
    const picks=[...document.querySelectorAll(`input[data-edition="${id}"]:checked`)].map(x=>Number(x.value));
    if(!picks.length){$('#status').textContent='Tick the events that go in the special post.';$('#status').className='error';return;}
    const headline=(prompt(`Heading for the special post with ${picks.length} event${picks.length===1?'':'s'} (3–40 characters), for example: Researchers’ Night`)||'').trim();
    if(!headline) return;
    action(async()=>{const e=await api(`/api/editions/${id}/special`,{headline,events:picks});openGrids.add(`edition-${e.id}`);});
    return;
  }
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
  // Unticking an event for publishing greys its grid card at once: the server only learns the selection at approval.
  const pick=ev.target.closest('input[data-edition]');
  if(pick){
    const card=document.querySelector(`.grid-pick[data-pick="${CSS.escape(pick.dataset.edition+'|'+pick.value)}"]`);
    if(card&&!card.dataset.alwaysBlocked){
      const tick=card.querySelector('input');
      card.classList.toggle('used',!pick.checked);
      tick.disabled=!pick.checked;
      if(!pick.checked) tick.checked=false;
      const count=$(`[data-grid-count="${CSS.escape(tick.dataset.grid)}"]`);
      if(count) count.textContent=gridPicks(tick.dataset.grid).length;
      let why=card.querySelector('.why');
      if(!pick.checked&&!why){why=document.createElement('small');why.className='why';why.textContent='left out of this weekend’s posts';card.querySelector('span').append(why);}
      if(pick.checked&&why) why.remove();
    }
    return;
  }
  const box=ev.target.closest('input[data-also]');if(!box)return;
  const {also:id,index}=box.dataset;
  const dates=[...document.querySelectorAll(`input[data-also="${id}"][data-index="${index}"]:checked`)].map(x=>x.value);
  action(()=>api(`/api/editions/${id}/events/${index}/also-on`,{alsoOn:dates}));
});
load().catch(e=>{$('#status').textContent=e.message;});

// ---- Animations -------------------------------------------------------------------------------
// A separate panel with its own status line and its own poll loop: a clip render has nothing to do
// with an edition, and sharing load() would redraw every grid tick on the other tab while it runs.
const animStatus=(msg,bad)=>{const el=$('#anim-status');el.textContent=msg||'';el.className=bad?'error':'';};
async function animAction(fn){try{animStatus('Working…');await fn();await loadAnimations();animStatus('Done.');}catch(e){animStatus(e.message,true);}}
function animationCard(a){
  const src=`/media/animations/${a.id}.mp4?v=${stamp}`;
  const state=a.status==='ready'?'Ready':a.status==='rendering'?'Rendering…':a.status==='failed'?`Failed — ${a.error||'unknown error'}`:'Not rendered yet';
  const ready=a.status==='ready';
  return `<article class="anim">
    <div class="anim-head"><h3>${esc(a.name)}</h3><span class="tag">${esc(a.composition)}</span><span class="job-state">${esc(state)}</span></div>
    ${ready?`<video class="grid-video" src="${src}" controls preload="metadata" playsinline></video>`:''}
    ${a.caption?`<div class="copy"><details><summary>Caption</summary><pre>${esc(a.caption)}</pre></details></div>`:''}
    ${a.postiz?`<p class="hint">Sent to Postiz as a ${esc(a.postiz.kind)} draft${postizUrl?` — <a href="${esc(postizUrl)}" target="_blank" rel="noopener">open Postiz</a>`:''}. Nothing publishes until you schedule it there.</p>`:''}
    <div class="grid-send">
      <button data-anim-render="${esc(a.id)}"${a.status==='rendering'?' disabled':''}>${ready?'Render again':'Render'}</button>
      <button class="secondary" data-anim-postiz="${esc(a.id)}" data-kind="story"${ready?'':' disabled'}>Send as Story</button>
      <button class="secondary" data-anim-postiz="${esc(a.id)}" data-kind="reel"${ready?'':' disabled'}>Send as Reel</button>
      <button class="secondary small" data-anim-delete="${esc(a.id)}">Delete</button>
    </div>
  </article>`;
}
async function loadAnimations(){
  stamp=Date.now();
  const list=await api('/api/animations');
  if(!renderConfigured) animStatus('The render service is not configured (RENDER_URL); clips cannot be rendered here.',true);
  $('#animations').innerHTML=list.length?list.map(animationCard).join(''):'<p class="empty">No animations yet. Add one above — the composition must match an ID registered in <code>remotion/src/Root.tsx</code>, such as <code>PressStory</code>.</p>';
  if(list.some(a=>a.status==='rendering')) watchAnimations();
}
let animWatch=null;
function watchAnimations(){
  if(animWatch) return;
  animWatch=setInterval(async()=>{
    try{const l=await api('/api/animations');if(!l.some(a=>a.status==='rendering')){clearInterval(animWatch);animWatch=null;await loadAnimations();}}catch{}
  },4000);
}
function showPanel(name){
  for(const p of ['editions','animations']){
    document.getElementById(`panel-${p}`).hidden=p!==name;
    document.getElementById(`tab-btn-${p}`).setAttribute('aria-selected',String(p===name));
  }
  if(name==='animations') loadAnimations().catch(e=>animStatus(e.message,true));
}
document.querySelectorAll('.tab').forEach(b=>{b.onclick=()=>showPanel(b.dataset.panel);});
$('#anim-new').addEventListener('submit',ev=>{
  ev.preventDefault();
  animAction(async()=>{
    await api('/api/animations',{name:$('#anim-name').value.trim(),composition:$('#anim-comp').value.trim(),caption:$('#anim-caption').value,holdSeconds:Number($('#anim-hold').value)||5});
    $('#anim-name').value=''; $('#anim-caption').value='';
  });
});
document.addEventListener('click',ev=>{
  const b=ev.target.closest('button'); if(!b) return;
  if(b.dataset.animRender) return void animAction(()=>api(`/api/animations/${b.dataset.animRender}/render`,{}));
  if(b.dataset.animPostiz) return void animAction(()=>api(`/api/animations/${b.dataset.animPostiz}/postiz`,{kind:b.dataset.kind}));
  if(b.dataset.animDelete){
    if(!confirm('Delete this animation and its rendered file?')) return;
    return void animAction(async()=>{const r=await fetch(`/api/animations/${b.dataset.animDelete}`,{method:'DELETE'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Delete failed');});
  }
});
