import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { caption, postCaption, postOn, escapeHtml, whatsappText, chosen, eventsByDay, dayName, eventTime } from './domain.js';
import { captionLinker } from './shortlinks.js';

export async function request(url,options={},fetcher=fetch) {
  const res=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!res.ok) {const err=new Error(`Provider returned HTTP ${res.status}`);err.status=res.status;throw err;}
  return res.json();
}
export const isWhatsApp=target=>target==='whatsapp'||target.startsWith('whatsapp#');
// Story videos rendered from a day's grid: one Reel or one Story per day, sent on demand.
// Targets look like instagram_reel:<date> or instagram_grid_story:<date>, with #2 on a re-send.
export const GRID_KINDS={reel:'instagram_reel',story:'instagram_grid_story'};
export const gridVideo=target=>{
  const entry=Object.entries(GRID_KINDS).find(([, prefix])=>target.startsWith(`${prefix}:`));
  if(!entry) return null;
  const [date]=target.slice(target.indexOf(':')+1).split('#');
  return {kind:entry[0], date};
};
// Postiz needs a moment of lead time, and a slot that has already passed still lands in the
// calendar a few minutes out, so there is time to move it before it publishes.
export const MIN_LEAD_MINUTES=10;
export function preflight(target,env=process.env) {
  if(env.LIVE_PUBLISH!=='true') throw new Error('LIVE_PUBLISH is not enabled');
  const wa=isWhatsApp(target);
  const keys=wa?['WAHA_URL','WAHA_API_KEY','WAHA_CHAT_ID']:['POSTIZ_API_URL','POSTIZ_API_KEY','INSTAGRAM_INTEGRATION_ID'];
  for(const key of keys) if(!env[key]) throw new Error(`Missing ${key}`);
  if(wa&&!/@(g\.us|newsletter)$/.test(env.WAHA_CHAT_ID)) throw new Error('WAHA_CHAT_ID must be a group or channel ID');
  if(!wa&&!['instagram','instagram-standalone'].includes(env.INSTAGRAM_PROVIDER||'instagram-standalone')) throw new Error('Invalid INSTAGRAM_PROVIDER');
}
// A digest sent mid-weekend only lists what is still to come.
const upcoming=(data,selected,now=Date.now())=>chosen(data,selected).filter(x=>Date.parse(x.event.startsAt)>now).map(x=>x.index);
export async function deliver(job,edition,dir,env=process.env,fetcher=fetch,link=null) {
  preflight(job.target,env);
  if(isWhatsApp(job.target)) {
    const result=await request(`${env.WAHA_URL.replace(/\/$/,'')}/api/sendText`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':env.WAHA_API_KEY},body:JSON.stringify({session:env.WAHA_SESSION||'default',chatId:env.WAHA_CHAT_ID,text:whatsappText(edition.data,upcoming(edition.data,edition.selected))})},fetcher);
    if(!result.id) throw new Error('WAHA returned no message ID; verify delivery');
    return result;
  }
  const base=env.POSTIZ_API_URL.replace(/\/$/,''); const headers={Authorization:env.POSTIZ_API_KEY};
  const video=gridVideo(job.target);
  if(video) {
    // One rendered story video: a single video post is a Reel on Instagram, or a Story when asked for.
    const filename=`grid-${video.date}.mp4`;
    const file=await readFile(join(dir,'media',edition.id,filename));
    const body=new FormData(); body.append('file',new Blob([file],{type:'video/mp4'}),filename);
    const uploaded=await request(`${base}/upload`,{method:'POST',headers,body},fetcher);
    if(!uploaded.id||!uploaded.path) throw new Error('Postiz upload returned no media ID/path for the video');
    const caption=video.kind==='reel'?gridCaption(edition,video.date,link):'';
    // Drafts: you watch it in Postiz and schedule it there, so nothing goes out unseen.
    const payload={type:'draft',date:new Date(Date.now()+MIN_LEAD_MINUTES*60000).toISOString(),shortLink:false,tags:[],
      posts:[{integration:{id:env.INSTAGRAM_INTEGRATION_ID},value:[{content:caption,image:[{id:uploaded.id,path:uploaded.path}]}],
        settings:{__type:env.INSTAGRAM_PROVIDER||'instagram-standalone',post_type:video.kind==='story'?'story':'post'}}]};
    const result=await request(`${base}/posts`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
    if(!Array.isArray(result)||!result[0]?.postId) throw new Error('Postiz returned no post ID; verify delivery');
    return {postiz:'draft',kind:video.kind,postId:result[0].postId,posts:result};
  }
  const {files,text}=slides(job,edition.data,edition.selected,link);
  const story=job.target.startsWith('instagram_story:');
  const images=[];
  for(const filename of files) {
    const file=await readFile(join(dir,'media',edition.id,filename));
    const body=new FormData(); body.append('file',new Blob([file],{type:'image/jpeg'}),filename);
    const uploaded=await request(`${base}/upload`,{method:'POST',headers,body},fetcher);
    if(!uploaded.id||!uploaded.path) throw new Error('Postiz upload returned no media ID/path');
    images.push({id:uploaded.id,path:uploaded.path});
  }
  const content=story?'':text.split('\n').map(s=>`<p>${escapeHtml(s)}</p>`).join('');
  // Carousels are scheduled in Postiz for their planned time; stories arrive as drafts for you to
  // schedule or delete there. Either way Postiz, not this server, now decides when it publishes.
  const earliest=Date.now()+MIN_LEAD_MINUTES*60000;
  const date=new Date(Math.max(Date.parse(job.publish_at||0)||0,earliest)).toISOString();
  const type=story?'draft':'schedule';
  const payload={type,date,shortLink:false,tags:[],posts:[{integration:{id:env.INSTAGRAM_INTEGRATION_ID},value:[{content,image:images}],settings:{__type:env.INSTAGRAM_PROVIDER||'instagram-standalone',post_type:story?'story':'post'}}]};
  const result=await request(`${base}/posts`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  if(!Array.isArray(result)||!result[0]?.postId) throw new Error('Postiz returned no post ID; verify delivery');
  return {postiz:type==='draft'?'draft':'scheduled',publishAt:date,postId:result[0].postId,posts:result};
}
// A Reel caption lists the day's events with their links, the same short links the carousels use.
// A standalone clip, uploaded straight to Postiz as a draft. It takes the same route as a grid video
// but carries no edition, so it cannot use deliver(): everything that function reads - the day's
// events, the caption builder, the job row - assumes one exists.
export async function deliverAnimation(dir,animation,kind,env=process.env,fetcher=fetch) {
  preflight('instagram_reel:standalone',env);
  const base=env.POSTIZ_API_URL.replace(/\/$/,''); const headers={Authorization:env.POSTIZ_API_KEY};
  const filename=`${animation.id}.mp4`;
  const file=await readFile(join(dir,'media','animations',filename));
  const body=new FormData(); body.append('file',new Blob([file],{type:'video/mp4'}),filename);
  const uploaded=await request(`${base}/upload`,{method:'POST',headers,body},fetcher);
  if(!uploaded.id||!uploaded.path) throw new Error('Postiz upload returned no media ID/path for the video');
  // A draft, like every other path here: it lands in Postiz for you to look at and schedule.
  const payload={type:'draft',date:new Date(Date.now()+MIN_LEAD_MINUTES*60000).toISOString(),shortLink:false,tags:[],
    posts:[{integration:{id:env.INSTAGRAM_INTEGRATION_ID},value:[{content:kind==='reel'?(animation.caption||''):'',image:[{id:uploaded.id,path:uploaded.path}]}],
      settings:{__type:env.INSTAGRAM_PROVIDER||'instagram-standalone',post_type:kind==='story'?'story':'post'}}]};
  const result=await request(`${base}/posts`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  if(!Array.isArray(result)||!result[0]?.postId) throw new Error('Postiz returned no post ID; verify delivery');
  return {postiz:'draft',kind,postId:result[0].postId,at:new Date().toISOString()};
}

export function gridCaption(edition,date,link=null) {
  const items=eventsByDay(edition.data,edition.selected).find(d=>d.date===date)?.items||[];
  const lines=items.map(({event:e},i)=>`${i+1}. ${e.title}\n${eventTime(e)} · ${e.venue} · ${e.price}${link?`\n${link(e.sourceUrl)}`:''}`);
  return [`${edition.data.headline?`${edition.data.headline} · `:''}${dayName(date)} in Rīga.`,'',...lines,'','Save this for the weekend. Check organisers for updates.','#Riga #RigaEvents #Rīga']
    .join('\n').slice(0,2200).split('\n').map(s=>`<p>${escapeHtml(s)}</p>`).join('');
}
// Instagram gets one carousel per day: a date cover, then that day's events in order.
// Targets: instagram_story:<index>, instagram_feed:<date>#<part>, whatsapp or whatsapp#<n>.
function address(target) {
  const key=target.split(':')[1]; if(!key) return null;
  const [date,part]=key.split('#');
  return {date,part:Number(part||1)};
}
export function slides(job,data,selected=null,link=null) {
  if(job.target.startsWith('instagram_story:')) return {files:[`story-${Number(job.target.split(':')[1])}.jpg`],text:''};
  const at=address(job.target);
  // A bare instagram_feed target predates per-day grouping; it still publishes the whole weekend.
  if(!at) return {files:data.events.map((_,i)=>`feed-${i}.jpg`),text:caption(data)};
  const post=postOn(data,at.date,at.part,selected);
  return {files:[`cover-${at.date}-${at.part}.jpg`,...post.items.map(x=>`feed-${x.index}.jpg`)],text:postCaption(data,post,link)};
}
export function jobEvents(job,data,selected=null) {
  const video=gridVideo(job.target);
  if(video) return eventsByDay(data,selected).find(d=>d.date===video.date)?.items.map(x=>x.event)||[];
  if(job.target.startsWith('instagram_story:')) return [data.events[Number(job.target.split(':')[1])]];
  const at=job.target.startsWith('instagram_feed:')?address(job.target):null;
  return at?postOn(data,at.date,at.part,selected).items.map(x=>x.event):chosen(data,selected).map(x=>x.event);
}
export async function runJobs(store,env=process.env,fetcher=fetch) {
  if(env.LIVE_PUBLISH!=='true') return;
  const link=captionLinker(store,env);
  let job;
  while((job=store.claim())) {
    const e=store.get(job.edition);
    try {
      preflight(job.target,env);
      if(e.demo||!e.approved) throw new Error('Edition is not approved for publishing');
      const events=jobEvents(job,e.data,e.selected);
      if(isWhatsApp(job.target)) {if(!upcoming(e.data,e.selected).length) throw new Error('Every event in this digest has already started');}
      else if(events.some(x=>Date.parse(x.startsAt)<=Date.now())) throw new Error('Event already started; create an updated edition');
    } catch(err) {store.finish(job.id,'blocked',{error:err.message});continue;}
    try {store.finish(job.id,'sent',await deliver(job,e,store.dir,env,fetcher,link));}
    // A rate limit means the provider refused the request outright, so nothing was created: try again later.
    catch(err) {if(err.status===429) store.requeue(job.id,10,'Rate limited; retrying automatically'); else store.finish(job.id,'uncertain',{error:err.message});}
  }
}
// Setup helpers: discover the IDs that .env needs once the accounts are connected.
export async function listIntegrations(env=process.env,fetcher=fetch) {
  if(!env.POSTIZ_API_URL||!env.POSTIZ_API_KEY) throw new Error('Set POSTIZ_API_URL and POSTIZ_API_KEY (Postiz → Settings → Developers)');
  const list=await request(`${env.POSTIZ_API_URL.replace(/\/$/,'')}/integrations`,{headers:{Authorization:env.POSTIZ_API_KEY}},fetcher);
  if(!Array.isArray(list)) throw new Error('Postiz returned no integration list');
  return list.map(i=>({id:i.id,provider:i.identifier||i.providerIdentifier,name:i.name,disabled:!!i.disabled}));
}
export async function listGroups(env=process.env,fetcher=fetch) {
  if(!env.WAHA_URL||!env.WAHA_API_KEY) throw new Error('Set WAHA_URL and WAHA_API_KEY');
  const list=await request(`${env.WAHA_URL.replace(/\/$/,'')}/api/${encodeURIComponent(env.WAHA_SESSION||'default')}/groups`,{headers:{'X-Api-Key':env.WAHA_API_KEY}},fetcher).catch(err=>{throw new Error(`${err.message}. Is the WAHA session '${env.WAHA_SESSION||'default'}' started and paired?`);});
  if(!Array.isArray(list)) throw new Error('WAHA returned no group list; is the session started and paired?');
  return list.map(g=>({id:typeof g.id==='string'?g.id:g.id?._serialized,name:g.name||g.subject||g.groupMetadata?.subject||''})).filter(g=>g.id);
}
export function checkConfig(env=process.env) {
  const report=[];
  const add=(area,key,ok,hint)=>report.push({area,key,ok:!!ok,hint});
  add('app','APP_ORIGIN',/^https:\/\//.test(env.APP_ORIGIN||''),'HTTPS public URL; required for ChatGPT MCP and OAuth');
  add('app','ADMIN_TOKEN',env.ADMIN_TOKEN,'generated by scripts/bootstrap.sh');
  add('instagram','POSTIZ_API_KEY',env.POSTIZ_API_KEY,'Postiz → Settings → Developers');
  add('instagram','INSTAGRAM_INTEGRATION_ID',env.INSTAGRAM_INTEGRATION_ID,'run: cli.js integrations');
  add('instagram','INSTAGRAM_PROVIDER',['instagram','instagram-standalone'].includes(env.INSTAGRAM_PROVIDER||'instagram-standalone'),'instagram-standalone or instagram');
  add('whatsapp','WAHA_API_KEY',env.WAHA_API_KEY,'generated by scripts/bootstrap.sh');
  add('whatsapp','WAHA_CHAT_ID',/@(g\.us|newsletter)$/.test(env.WAHA_CHAT_ID||''),'run: cli.js groups');
  const chatgpt=env.RESEARCH_SCHEDULE_ENABLED!=='true';
  add('research',chatgpt?'ChatGPT MCP owns research':'VPS scheduler owns research',chatgpt||(env.OPENAI_API_KEY&&env.OPENAI_MODEL),chatgpt?'connect the ChatGPT task to /mcp':'set OPENAI_API_KEY and OPENAI_MODEL');
  add('delivery','LIVE_PUBLISH',true,env.LIVE_PUBLISH==='true'?'LIVE: approved editions will be published':'preview only; nothing is sent');
  add('delivery','AUTO_APPROVE',true,env.AUTO_APPROVE==='true'?'scheduled research is approved without review':'manual review required');
  return report;
}
