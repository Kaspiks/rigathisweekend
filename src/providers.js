import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { caption, escapeHtml, whatsappText } from './domain.js';

export async function request(url,options={},fetcher=fetch) {
  const res=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
  return res.json();
}
export function preflight(target,env=process.env) {
  if(env.LIVE_PUBLISH!=='true') throw new Error('LIVE_PUBLISH is not enabled');
  const keys=target==='whatsapp'?['WAHA_URL','WAHA_API_KEY','WAHA_CHAT_ID']:['POSTIZ_API_URL','POSTIZ_API_KEY','INSTAGRAM_INTEGRATION_ID'];
  for(const key of keys) if(!env[key]) throw new Error(`Missing ${key}`);
  if(target==='whatsapp'&&!/@(g\.us|newsletter)$/.test(env.WAHA_CHAT_ID)) throw new Error('WAHA_CHAT_ID must be a group or channel ID');
  if(target!=='whatsapp'&&!['instagram','instagram-standalone'].includes(env.INSTAGRAM_PROVIDER||'instagram-standalone')) throw new Error('Invalid INSTAGRAM_PROVIDER');
}
export async function deliver(job,edition,dir,env=process.env,fetcher=fetch) {
  preflight(job.target,env);
  if(job.target==='whatsapp') {
    const result=await request(`${env.WAHA_URL.replace(/\/$/,'')}/api/sendText`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':env.WAHA_API_KEY},body:JSON.stringify({session:env.WAHA_SESSION||'default',chatId:env.WAHA_CHAT_ID,text:whatsappText(edition.data)})},fetcher);
    if(!result.id) throw new Error('WAHA returned no message ID; verify delivery');
    return result;
  }
  const story=job.target.startsWith('instagram_story:');
  const indices=story?[Number(job.target.split(':')[1])]:edition.data.events.map((_,i)=>i);
  const base=env.POSTIZ_API_URL.replace(/\/$/,''); const headers={Authorization:env.POSTIZ_API_KEY};
  const images=[];
  for(const i of indices) {
    const filename=`${story?'story':'feed'}-${i}.jpg`;
    const file=await readFile(join(dir,'media',edition.id,filename));
    const body=new FormData(); body.append('file',new Blob([file],{type:'image/jpeg'}),filename);
    const uploaded=await request(`${base}/upload`,{method:'POST',headers,body},fetcher);
    if(!uploaded.id||!uploaded.path) throw new Error('Postiz upload returned no media ID/path');
    images.push({id:uploaded.id,path:uploaded.path});
  }
  const content=story?'':caption(edition.data).split('\n').map(s=>`<p>${escapeHtml(s)}</p>`).join('');
  const payload={type:'now',date:new Date().toISOString(),shortLink:false,tags:[],posts:[{integration:{id:env.INSTAGRAM_INTEGRATION_ID},value:[{content,image:images}],settings:{__type:env.INSTAGRAM_PROVIDER||'instagram-standalone',post_type:story?'story':'post'}}]};
  const result=await request(`${base}/posts`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  if(!Array.isArray(result)||!result[0]?.postId) throw new Error('Postiz returned no post ID; verify delivery');
  return result;
}
export async function runJobs(store,env=process.env,fetcher=fetch) {
  if(env.LIVE_PUBLISH!=='true') return;
  let job;
  while((job=store.claim())) {
    const e=store.get(job.edition);
    try {
      preflight(job.target,env);
      if(e.demo||!e.approved) throw new Error('Edition is not approved for publishing');
      const relevant=job.target.startsWith('instagram_story:')?[e.data.events[Number(job.target.split(':')[1])]]:e.data.events;
      if(relevant.some(x=>Date.parse(x.startsAt)<=Date.now())) throw new Error('Event already started; create an updated edition');
    } catch(err) {store.finish(job.id,'blocked',{error:err.message});continue;}
    try {store.finish(job.id,'sent',await deliver(job,e,store.dir,env,fetcher));}
    catch(err) {store.finish(job.id,'uncertain',{error:err.message});}
  }
}
