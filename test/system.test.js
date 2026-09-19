import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import sharp from 'sharp';
import { Store } from '../src/store.js';
import { validateSubmission,weekendFor,plannedJobs } from '../src/domain.js';
import { renderEdition } from '../src/render.js';
import { deliver,runJobs } from '../src/providers.js';
import { createApp } from '../src/app.js';
import { research } from '../src/research.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const fixture=()=>({weekend:'2099-10-23',events:[{title:'Rīgas mūzikas vakars',startsAt:'2099-10-24T18:00:00+03:00',venue:'Rīga · koncertzāle',price:'€12',summary:'An evening of live music in the city.',sourceUrl:'https://example.com/event'}]});
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'riga-test-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
test('Riga weekends include current Saturday/Sunday and local Monday transitions',()=>{
  assert.equal(weekendFor(DateTime.fromISO('2026-09-12T15:00:00Z')),'2026-09-11');
  assert.equal(weekendFor(DateTime.fromISO('2026-09-13T22:00:00Z')),'2026-09-18');
  assert.throws(()=>validateSubmission({...fixture(),weekend:'2099-10-24'}),/Friday/);
  assert.throws(()=>validateSubmission({...fixture(),events:[...fixture().events,...fixture().events]}),/Duplicate/);
  assert.throws(()=>validateSubmission({...fixture(),events:[{...fixture().events[0],startsAt:'2099-10-27T18:00:00+02:00'}]}),/outside/);
});
test('DST scheduling stays at Riga 09:00 on the clock change',()=>{
  const data={weekend:'2026-10-23',events:[{...fixture().events[0],startsAt:'2026-10-23T18:00:00+03:00'},{...fixture().events[0],title:'Sunday',startsAt:'2026-10-25T18:00:00+02:00'}]};
  const jobs=plannedJobs(data,DateTime.fromISO('2026-10-22T10:00:00Z'),null,[0,1]), due=t=>jobs.find(j=>j.target===t).due;
  assert.equal(due('instagram_feed:2026-10-23#1'),'2026-10-23T06:00:00.000Z','Friday 09:00 Riga, still summer time');
  assert.equal(due('instagram_feed:2026-10-25#1'),'2026-10-25T07:00:00.000Z','Sunday 09:00 Riga, clocks already back');
  assert.equal(due('instagram_story:1'),'2026-10-25T07:00:00.000Z');
  assert.ok(!jobs.some(j=>j.target.startsWith('whatsapp')),'WhatsApp is never on a schedule');
});
test('A broad candidate list is accepted, but what you approve has to fit a post',async t=>{
  const store=await setup(t),input=fixture();
  input.events=Array.from({length:8},(_,i)=>({...input.events[0],title:String(i)+'x'.repeat(99),venue:'v'.repeat(90),price:'p'.repeat(60)}));
  const e=store.submit(input);
  assert.equal(store.list().length,1,'collecting many candidates is fine');
  const long=store.submit({...input,events:input.events.map(x=>({...x,summary:'S'.repeat(220)}))});
  assert.equal(store.approve(long.id,undefined,[0,1,2]).length,1,'a selection publishes as one post, with no stories unless ticked');
  const {postsFor,postCaption}=await import('../src/domain.js');
  const full=postCaption(long.data,postsFor(long.data)[0]);
  assert.ok(full.length<=2200,'eight long entries fit rather than being refused');
  assert.doesNotMatch(full,/^\d+\. 0x/m,'titles are the first thing to go, since each slide already shows its title');
  assert.doesNotMatch(full,/S…/,'with titles gone the descriptions fit whole');
  assert.equal((full.match(/https:\/\/example\.com\/event/g)||[]).length,8,'every full link is kept');
});
test('A day with more events than one carousel holds is split across several posts',async t=>{
  const {postsFor,postName}=await import('../src/domain.js');
  const {slides}=await import('../src/providers.js');
  const store=await setup(t);
  // Twelve on one Sunday: nine in the first carousel, three in the second.
  const input={weekend:'2099-10-23',events:Array.from({length:12},(_,i)=>({...fixture().events[0],title:`Event ${i}`,startsAt:`2099-10-25T${String(8+i).padStart(2,'0')}:00:00+03:00`}))};
  const posts=postsFor(input);
  assert.deepEqual(posts.map(p=>p.items.length),[9,3]);
  assert.deepEqual(posts.map(p=>p.parts),[2,2]);
  assert.equal(postName(posts[1]),'Sunday 25 October, post 2 of 2');
  const e=store.submit(input), jobs=store.approve(e.id);
  const feed=jobs.filter(j=>j.target.startsWith('instagram_feed'));
  assert.deepEqual(feed.map(j=>j.target),['instagram_feed:2099-10-25#1','instagram_feed:2099-10-25#2']);
  assert.ok(Date.parse(feed[1].publish_at)>Date.parse(feed[0].publish_at),'the second post is scheduled after the first rather than with it');
  const first=slides(feed[0],input), second=slides(feed[1],input);
  assert.equal(first.files.length,10,'cover plus nine is exactly the API limit');
  assert.deepEqual(second.files,['cover-2099-10-25-2.jpg','feed-9.jpg','feed-10.jpg','feed-11.jpg']);
  assert.match(second.text,/^Sunday 25 October, post 2 of 2 in Rīga\./);
  assert.doesNotMatch(second.text,/Event 0\b/,'each post carries only its own slice');
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  for(const part of [1,2]) {
    const meta=await sharp(join(store.dir,'media',e.id,`cover-2099-10-25-${part}.jpg`)).metadata();
    assert.equal(meta.height,1350);
  }
});
test('Submissions and approvals deduplicate; competing editions cannot both publish',async t=>{
  const store=await setup(t),e=store.submit(fixture());assert.equal(store.submit(fixture()).id,e.id);
  store.approve(e.id);store.approve(e.id);assert.equal(store.jobs(e.id).length,1);
  const updated=fixture();updated.events[0].price='€15';const e2=store.submit(updated);
  assert.throws(()=>store.approve(e2.id),/already covers 2099-10-24/);assert.equal(store.get(e2.id).approved,0);
  // A later edition may still claim a day nothing has published yet.
  const sunday=store.submit({weekend:'2099-10-23',events:[{...fixture().events[0],title:'Sunday market',startsAt:'2099-10-25T11:00:00+03:00'}]});
  assert.deepEqual(store.approve(sunday.id).map(j=>j.target).filter(t=>t.startsWith('instagram_feed')),['instagram_feed:2099-10-25#1']);
  assert.equal(store.get(sunday.id).approved,1);
  assert.throws(()=>store.approve(store.submit(fixture(),true).id),/Demo/);
});
test('Two database connections cannot claim the same job; interrupted sends stay uncertain',async t=>{
  const store=await setup(t);const other=new Store(store.dir);t.after(()=>other.close());const e=store.submit(fixture());store.approve(e.id,undefined,null,[0]);
  const a=store.claim('2100-01-01'),b=other.claim('2100-01-01');assert.notEqual(a.id,b.id);
  store.recover();assert.equal(store.jobs(e.id).filter(j=>j.status==='uncertain').length,2);
});
test('Rendering creates real JPEGs of Instagram dimensions and Latvian copy',async t=>{
  const store=await setup(t),e=store.submit(fixture());await renderEdition(e,store.dir);
  for(const [kind,height] of [['feed',1350],['story',1920]]){const meta=await sharp(join(store.dir,'media',e.id,`${kind}-0.jpg`)).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,height);assert.equal(meta.format,'jpeg');}
  assert.match(await readFile(join(store.dir,'media',e.id,'whatsapp.txt'),'utf8'),/Rīgas mūzikas/);
});
test('Postiz multipart upload and Story payload match the public API; WhatsApp uses configured group',async t=>{
  const store=await setup(t),e=store.submit(fixture());await renderEdition(e,store.dir);const calls=[];
  const fake=async(url,o)=>{calls.push([url,o]);return {ok:true,json:async()=>url.endsWith('/upload')?{id:'img',path:'https://cdn.example.com/img.jpg'}:url.endsWith('/posts')?[{postId:'post',integration:'ig'}]:{id:'wa-message'}};};
  const env={LIVE_PUBLISH:'true',POSTIZ_API_URL:'https://postiz.example/api/public/v1',POSTIZ_API_KEY:'key',INSTAGRAM_INTEGRATION_ID:'ig',WAHA_URL:'http://waha:3000',WAHA_API_KEY:'wa',WAHA_CHAT_ID:'123@g.us'};
  await deliver({target:'instagram_story:0'},e,store.dir,env,fake);
  assert.equal(calls[0][1].headers.Authorization,'key');assert.ok(calls[0][1].body.get('file'));
  const body=JSON.parse(calls[1][1].body);assert.equal(body.posts[0].settings.post_type,'story');assert.equal(body.posts[0].value[0].content,'');assert.equal(body.type,'draft','stories arrive in Postiz as drafts');
  await deliver({target:'whatsapp'},e,store.dir,env,fake);assert.equal(JSON.parse(calls[2][1].body).chatId,'123@g.us');
});
test('Preview mode never calls providers; timeouts are never blindly retried',async t=>{
  const store=await setup(t),e=store.submit(fixture());store.approve(e.id);store.queueWhatsApp(e.id);store.db.prepare("UPDATE jobs SET due='2000-01-01' WHERE target='whatsapp'").run();
  let calls=0;const fake=async()=>{calls++;throw Error('timeout');};
  await runJobs(store,{},fake);assert.equal(calls,0);
  const env={LIVE_PUBLISH:'true',WAHA_URL:'http://waha',WAHA_API_KEY:'key',WAHA_CHAT_ID:'123@g.us'};
  await runJobs(store,env,fake);await runJobs(store,env,fake);assert.equal(calls,1);assert.equal(store.jobs(e.id).find(j=>j.target==='whatsapp').status,'uncertain');
});
test('Research rejects invented sources even when the event JSON is plausible',async()=>{
  const fake=async()=>({ok:true,json:async()=>({status:'completed',id:'r',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture())}]}]})});
  await assert.rejects(research('2099-10-23',{OPENAI_API_KEY:'key',OPENAI_MODEL:'test'},fake),/Unverified source/);
});
test('HTTP auth, CSRF protection and actual MCP protocol discovery/submission',async t=>{
  const store=await setup(t),token='a'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/editions')).status,401);
  assert.equal((await fetch(base+'/api/editions',{headers:{Authorization:`Bearer ${token}`,Origin:'https://evil.example'}})).status,403);
  const client=new Client({name:'test-client',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
  await client.connect(transport);t.after(()=>client.close());
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='submit_weekend_events'));
  const result=await client.callTool({name:'submit_weekend_events',arguments:fixture()});assert.ok(!result.isError);assert.equal(store.list().length,1);assert.equal(store.list()[0].approved,0);
});
test('Setup helpers discover Postiz integration and WhatsApp group IDs, and the config check names what is missing',async()=>{
  const {listIntegrations,listGroups,checkConfig}=await import('../src/providers.js');
  const calls=[];const fetcher=async(url,opts)=>{calls.push({url,headers:opts.headers});
    if(url.endsWith('/integrations')) return {ok:true,json:async()=>[{id:'int-1',identifier:'instagram-standalone',name:'rigaweekend',disabled:false}]};
    return {ok:true,json:async()=>[{id:{_serialized:'1203@g.us'},name:'Riga Weekend'},{id:'4567@g.us',subject:'Test'}]};};
  assert.deepEqual(await listIntegrations({POSTIZ_API_URL:'http://postiz/api/public/v1/',POSTIZ_API_KEY:'k'},fetcher),[{id:'int-1',provider:'instagram-standalone',name:'rigaweekend',disabled:false}]);
  assert.equal(calls[0].url,'http://postiz/api/public/v1/integrations');assert.equal(calls[0].headers.Authorization,'k');
  assert.deepEqual(await listGroups({WAHA_URL:'http://waha:3000',WAHA_API_KEY:'w',WAHA_SESSION:'default'},fetcher),[{id:'1203@g.us',name:'Riga Weekend'},{id:'4567@g.us',name:'Test'}]);
  assert.equal(calls[1].url,'http://waha:3000/api/default/groups');assert.equal(calls[1].headers['X-Api-Key'],'w');
  await assert.rejects(listIntegrations({},fetcher),/POSTIZ_API_KEY/);
  const missing=checkConfig({APP_ORIGIN:'http://localhost:3100',ADMIN_TOKEN:'t',WAHA_API_KEY:'w',RESEARCH_SCHEDULE_ENABLED:'true'}).filter(r=>!r.ok).map(r=>r.key);
  assert.deepEqual(missing,['APP_ORIGIN','POSTIZ_API_KEY','INSTAGRAM_INTEGRATION_ID','WAHA_CHAT_ID','VPS scheduler owns research']);
  const done=checkConfig({APP_ORIGIN:'https://events.example.com',ADMIN_TOKEN:'t',POSTIZ_API_KEY:'k',INSTAGRAM_INTEGRATION_ID:'i',WAHA_API_KEY:'w',WAHA_CHAT_ID:'1@g.us'});
  assert.ok(done.every(r=>r.ok));
});
test('OAuth: dynamic registration, admin-token login, PKCE exchange, MCP-only access, refresh and revoke',async t=>{
  const {createHash,randomBytes}=await import('node:crypto');
  const store=await setup(t),token='b'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  // Unauthenticated MCP calls point clients at the protected-resource metadata, which points at this issuer.
  const denied=await fetch(base+'/mcp',{method:'POST'});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata="http:\/\/localhost:3100\/\.well-known\/oauth-protected-resource\/mcp"/);
  const meta=await (await fetch(base+'/.well-known/oauth-authorization-server')).json();assert.equal(meta.registration_endpoint,'http://localhost:3100/register');assert.deepEqual(meta.code_challenge_methods_supported,['S256']);
  assert.equal((await (await fetch(base+'/.well-known/oauth-protected-resource/mcp')).json()).resource,'http://localhost:3100/mcp');
  const bad=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'x',redirect_uris:['http://evil.example/cb']})});assert.equal(bad.status,400);
  const reg=await (await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'client_secret_basic'})})).json();
  assert.ok(reg.client_id);assert.equal(reg.client_secret,undefined);assert.equal(reg.token_endpoint_auth_method,'none');
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const authz=new URL(base+'/authorize');for(const [k,v] of Object.entries({response_type:'code',client_id:reg.client_id,redirect_uri:reg.redirect_uris[0],code_challenge:challenge,code_challenge_method:'S256',state:'xyz',resource:'http://localhost:3100/mcp'})) authz.searchParams.set(k,v);
  const page=await fetch(authz);assert.equal(page.status,200);const html=await page.text();assert.match(html,/ChatGPT/);const txn=html.match(/name="txn" value="([^"]+)"/)[1];
  const wrong=await fetch(base+'/oauth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({txn,token:'nope'})});assert.equal(wrong.status,401);
  assert.equal((await fetch(base+'/oauth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://evil.example'},body:new URLSearchParams({txn,token})})).status,403,'cross-origin login post rejected');
  assert.doesNotMatch(page.headers.get('referrer-policy')||'',/no-referrer/,'no-referrer would make browsers send Origin: null');
  const ok=await fetch(base+'/oauth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'http://localhost:3100'},body:new URLSearchParams({txn,token})});
  assert.equal(ok.status,302);const back=new URL(ok.headers.get('location'));assert.equal(back.origin+back.pathname,reg.redirect_uris[0]);assert.equal(back.searchParams.get('state'),'xyz');const code=back.searchParams.get('code');
  const again=await fetch(base+'/oauth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({txn,token})});
  assert.equal(again.status,302,'a double submit repeats the redirect instead of failing');assert.equal(new URL(again.headers.get('location')).searchParams.get('code'),code,'same code on repeat');
  assert.match(html,/nonce="/);assert.match(page.headers.get('content-security-policy'),/script-src 'nonce-/);
  assert.match(page.headers.get('content-security-policy'),/form-action 'self' https:\/\/chatgpt\.com/,'Chrome blocks the post-login redirect unless the callback origin is allowed');
  assert.match(wrong.headers.get('content-security-policy'),/form-action 'self' https:\/\/chatgpt\.com/);
  assert.equal((await fetch(base+'/oauth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({txn:'stale',token})})).status,400,'unknown transaction rejected');
  const tokenReq=body=>fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  assert.equal((await tokenReq({grant_type:'authorization_code',client_id:reg.client_id,code,code_verifier:'wrong-verifier-wrong-verifier-wrong-verifier-1',redirect_uri:reg.redirect_uris[0]})).status,400,'PKCE enforced');
  const tokens=await (await tokenReq({grant_type:'authorization_code',client_id:reg.client_id,code,code_verifier:verifier,redirect_uri:reg.redirect_uris[0]})).json();
  assert.ok(tokens.access_token&&tokens.refresh_token);assert.equal(tokens.token_type,'bearer');
  assert.equal((await tokenReq({grant_type:'authorization_code',client_id:reg.client_id,code,code_verifier:verifier})).status,400,'code is single-use');
  const client=new Client({name:'chatgpt',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}});
  await client.connect(transport);t.after(()=>client.close());
  assert.ok((await client.listTools()).tools.some(x=>x.name==='list_weekend_editions'));
  assert.equal((await fetch(base+'/api/editions',{headers:{Authorization:`Bearer ${tokens.access_token}`}})).status,401,'OAuth tokens never reach the dashboard API');
  const basic=Buffer.from(`${reg.client_id}:`).toString('base64');
  const refreshed=await (await fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${basic}`},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token})})).json();assert.ok(refreshed.access_token,'client_id via HTTP Basic is accepted');
  assert.equal((await tokenReq({grant_type:'refresh_token',client_id:reg.client_id,refresh_token:tokens.refresh_token})).status,400,'refresh tokens rotate');
  assert.equal((await fetch(base+'/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:reg.client_id,token:refreshed.access_token})})).status,200);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${refreshed.access_token}`}})).status,401,'revoked token is rejected');
});
test('Captions carry organiser links and degrade instead of rejecting a long edition',async()=>{
  const {caption}=await import('../src/domain.js');
  const short=caption(fixture());
  assert.match(short,/https:\/\/example\.com\/event/,'full link when it fits');
  const many={weekend:'2099-10-23',events:Array.from({length:8},(_,i)=>({...fixture().events[0],title:`Concert number ${i}`,startsAt:`2099-10-24T1${i}:00:00+03:00`,summary:'x'.repeat(60),sourceUrl:`https://www.organiser-with-a-long-name.example/${'p'.repeat(170)}/${i}`}))};
  const trimmed=caption(many);
  assert.ok(trimmed.length<=2200);
  assert.equal((trimmed.match(/https:\/\/www\.organiser-with-a-long-name\.example\/p{170}\/\d/g)||[]).length,8,'every full link survives, however long');
  assert.doesNotMatch(trimmed,/Concert number/,'titles went first');
  assert.doesNotMatch(trimmed,/x{60}/,'and then descriptions, before any link was touched');
  assert.match(trimmed,/^1\.\nhttps:/m,'each entry keeps its number so it still matches its slide');
  const huge={...many,events:many.events.map(e=>({...e,title:'T'.repeat(100),summary:'S'.repeat(220)}))};
  const packed=caption(huge);
  assert.ok(packed.length<=2200);assert.equal((packed.match(/p{170}/g)||[]).length,8);
});
test('Event photos come from the organiser page, and hostile URLs are refused',async t=>{
  const {eventPhoto,pictureUrl}=await import('../src/photos.js');
  assert.equal(pictureUrl('<meta property="og:image" content="/img/a.jpg?x=1&amp;y=2">','https://93.184.216.34/e'),'https://93.184.216.34/img/a.jpg?x=1&y=2');
  assert.equal(pictureUrl('<meta name="twitter:image" content="https://93.184.216.34/b.jpg">','https://93.184.216.34/e'),'https://93.184.216.34/b.jpg');
  assert.equal(pictureUrl('<meta property="og:image" content="http://insecure.example/a.jpg">','https://93.184.216.34/e'),null,'http images are ignored');
  assert.equal(pictureUrl('<p>no image here</p>','https://93.184.216.34/e'),null);
  const png=await sharp({create:{width:900,height:700,channels:3,background:'#336699'}}).png().toBuffer();
  const tiny=await sharp({create:{width:120,height:120,channels:3,background:'#336699'}}).png().toBuffer();
  const reply=(type,body,extra={})=>({ok:true,status:200,headers:new Headers({'content-type':type,...extra}),arrayBuffer:async()=>body});
  const seen=[];
  const fetcher=async url=>{
    seen.push(url);
    if(url.endsWith('/event')) return reply('text/html; charset=utf-8',Buffer.from('<meta property="og:image" content="https://93.184.216.34/photo.png">'));
    if(url.endsWith('/photo.png')) return reply('image/png',png);
    if(url.endsWith('/tiny.png')) return reply('image/png',tiny);
    if(url.endsWith('/nothtml')) return reply('application/json',Buffer.from('{}'));
    if(url.endsWith('/redirect')) return {ok:false,status:302,headers:new Headers({location:'https://127.0.0.1/secret.png'}),arrayBuffer:async()=>Buffer.alloc(0)};
    return {ok:false,status:404,headers:new Headers(),arrayBuffer:async()=>Buffer.alloc(0)};
  };
  const found=await eventPhoto({sourceUrl:'https://93.184.216.34/event'},fetcher);
  assert.ok(found&&found.buffer.length>0);assert.equal(found.label,'PHOTO: 93.184.216.34');
  assert.equal(await eventPhoto({sourceUrl:'https://93.184.216.34/e',imageUrl:'https://93.184.216.34/photo.png'},fetcher).then(r=>r.label),'PHOTO: 93.184.216.34','an explicit imageUrl skips the page');
  assert.equal(await eventPhoto({sourceUrl:'https://93.184.216.34/nothtml'},fetcher),null,'non-HTML page');
  assert.equal(await eventPhoto({sourceUrl:'https://93.184.216.34/e',imageUrl:'https://93.184.216.34/tiny.png'},fetcher),null,'icons and tracking pixels are too small');
  const before=seen.length;
  for(const url of ['https://127.0.0.1/x','https://10.0.0.5/x','https://192.168.1.1/x','https://169.254.169.254/latest/meta-data','https://[::1]/x','http://93.184.216.34/x'])
    assert.equal(await eventPhoto({sourceUrl:url},fetcher),null,`refused: ${url}`);
  assert.equal(seen.length,before,'private and plaintext targets are never requested');
  assert.equal(await eventPhoto({sourceUrl:'https://93.184.216.34/e',imageUrl:'https://93.184.216.34/redirect'},fetcher),null,'redirects into private space are refused');
  assert.ok(seen.every(u=>!u.includes('secret')));
});
test('A card with a photo keeps Instagram dimensions and credits the organiser',async t=>{
  const {cardSvg,renderEdition}=await import('../src/render.js');
  assert.match(cardSvg(fixture().events[0],0,1,'2099-10-23',false,false,'PHOTO: homonovus.lv'),/PHOTO: HOMONOVUS\.LV/);
  assert.doesNotMatch(cardSvg(fixture().events[0],0,1,'2099-10-23'),/PHOTO:/);
  const store=await setup(t),png=await sharp({create:{width:1600,height:900,channels:3,background:'#884422'}}).png().toBuffer();
  const input=fixture();input.events=[{...input.events[0],sourceUrl:'https://93.184.216.34/event'}];
  const e=store.submit(input);
  const fetcher=async url=>({ok:true,status:200,headers:new Headers({'content-type':url.endsWith('.png')?'image/png':'text/html'}),arrayBuffer:async()=>url.endsWith('.png')?png:Buffer.from('<meta property="og:image" content="https://93.184.216.34/p.png">')});
  await renderEdition(e,store.dir,fetcher);
  for(const [kind,height] of [['feed',1350],['story',1920]]) {
    const meta=await sharp(join(store.dir,'media',e.id,`${kind}-0.jpg`)).metadata();
    assert.equal(meta.width,1080);assert.equal(meta.height,height);assert.equal(meta.format,'jpeg');
  }
  // A flat card and a photo card must differ, proving the photo really reached the JPEG.
  const plain=await setup(t),p=plain.submit(fixture());await renderEdition(p,plain.dir,async()=>{throw new Error('offline');});
  const withPhoto=await readFile(join(store.dir,'media',e.id,'feed-0.jpg'));
  const without=await readFile(join(plain.dir,'media',p.id,'feed-0.jpg'));
  assert.ok(!withPhoto.equals(without));
  assert.match(await readFile(join(plain.dir,'media',p.id,'instagram-2099-10-24-1.txt'),'utf8'),/https:\/\/example\.com\/event/);
});

test('Each weekend day becomes its own Instagram post, opening with a date cover',async t=>{
  const {eventsByDay,postCaption,postOn,plannedJobs:planned}=await import('../src/domain.js');
  const {slides,jobEvents,deliver}=await import('../src/providers.js');
  const base=fixture().events[0];
  const input={weekend:'2099-10-23',events:[
    {...base,title:'Saturday evening concert',startsAt:'2099-10-24T18:00:00+03:00'},
    {...base,title:'Saturday late show',startsAt:'2099-10-24T21:00:00+03:00'},
    {...base,title:'Sunday makers market',startsAt:'2099-10-25T11:00:00+03:00'},
  ]};
  const days=eventsByDay(input);
  assert.deepEqual(days.map(d=>d.date),['2099-10-24','2099-10-25']);
  assert.deepEqual(days.map(d=>d.items.length),[2,1]);
  assert.deepEqual(planned(input,DateTime.fromISO('2099-10-20T10:00:00Z'),null,[0,1,2]).map(j=>j.target),
    ['instagram_feed:2099-10-24#1','instagram_feed:2099-10-25#1','instagram_story:0','instagram_story:1','instagram_story:2']);
  assert.deepEqual(planned(input,DateTime.fromISO('2099-10-20T10:00:00Z')).map(j=>j.target),['instagram_feed:2099-10-24#1','instagram_feed:2099-10-25#1'],'no stories unless ticked');
  // The cover leads, then that day's events in order; the other day is untouched.
  assert.deepEqual(slides({target:'instagram_feed:2099-10-24#1'},input).files,['cover-2099-10-24-1.jpg','feed-0.jpg','feed-1.jpg']);
  assert.deepEqual(slides({target:'instagram_feed:2099-10-25#1'},input).files,['cover-2099-10-25-1.jpg','feed-2.jpg']);
  assert.deepEqual(slides({target:'instagram_story:2'},input).files,['story-2.jpg']);
  assert.match(slides({target:'instagram_feed:2099-10-25#1'},input).text,/^Sunday 25 October in Rīga\./);
  assert.doesNotMatch(slides({target:'instagram_feed:2099-10-25#1'},input).text,/Saturday evening concert/,'a day post only carries its own events');
  assert.deepEqual(jobEvents({target:'instagram_feed:2099-10-25#1'},input).map(e=>e.title),['Sunday makers market'],'a started Saturday event cannot block Sunday');
  const store=await setup(t),e=store.submit(input);
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  for(const d of ['2099-10-24','2099-10-25']) {
    const meta=await sharp(join(store.dir,'media',e.id,`cover-${d}-1.jpg`)).metadata();
    assert.equal(meta.width,1080);assert.equal(meta.height,1350);
    assert.equal(await readFile(join(store.dir,'media',e.id,`instagram-${d}-1.txt`),'utf8'),postCaption(input,postOn(input,d,1)));
  }
  const calls=[];
  const fake=async(url,o)=>{calls.push([url,o]);return {ok:true,json:async()=>url.endsWith('/upload')?{id:'img',path:'https://cdn.example.com/i.jpg'}:[{postId:'p',integration:'ig'}]};};
  const env={LIVE_PUBLISH:'true',POSTIZ_API_URL:'https://postiz.example/api/public/v1',POSTIZ_API_KEY:'key',INSTAGRAM_INTEGRATION_ID:'ig'};
  await deliver({target:'instagram_feed:2099-10-24#1'},e,store.dir,env,fake);
  assert.equal(calls.filter(c=>c[0].endsWith('/upload')).length,3,'cover plus two events');
  const payload=JSON.parse(calls.at(-1)[1].body);
  assert.equal(payload.posts[0].settings.post_type,'post');
  assert.equal(payload.posts[0].value[0].image.length,3);
  assert.match(payload.posts[0].value[0].content,/Saturday 24 October in R/);
});
test('Approval publishes only the events you tick',async t=>{
  const {slides}=await import('../src/providers.js');
  const {whatsappText}=await import('../src/domain.js');
  const base=fixture().events[0];
  const store=await setup(t),e=store.submit({weekend:'2099-10-23',events:[
    {...base,title:'Keep me Saturday',startsAt:'2099-10-24T18:00:00+03:00'},
    {...base,title:'Skip me Saturday',startsAt:'2099-10-24T19:00:00+03:00'},
    {...base,title:'Keep me Sunday',startsAt:'2099-10-25T12:00:00+03:00'},
  ]});
  const jobs=store.approve(e.id,undefined,[0,2],[2]).map(j=>j.target).sort();
  assert.deepEqual(jobs,['instagram_feed:2099-10-24#1','instagram_feed:2099-10-25#1','instagram_story:2'],'nothing is queued for the event left out, and only the ticked story');
  assert.deepEqual(store.get(e.id).stories,[2]);
  const saved=store.get(e.id);
  assert.deepEqual(saved.selected,[0,2]);
  assert.deepEqual(slides({target:'instagram_feed:2099-10-24#1'},saved.data,saved.selected).files,['cover-2099-10-24-1.jpg','feed-0.jpg']);
  assert.doesNotMatch(whatsappText(saved.data,saved.selected),/Skip me/);
  assert.match(whatsappText(saved.data,saved.selected),/Keep me Sunday/);
  await renderEdition(saved,store.dir,async()=>{throw new Error('offline');});
  assert.doesNotMatch(await readFile(join(store.dir,'media',saved.id,'instagram-2099-10-24-1.txt'),'utf8'),/Skip me/,'the caption redraws around the choice');
  assert.ok(await readFile(join(store.dir,'media',saved.id,'feed-1.jpg')),'the unpublished event is still rendered for review');
  assert.deepEqual(store.approve(saved.id,undefined,[1]).map(j=>j.target).sort(),jobs,'a second approval cannot republish a different set');
  assert.deepEqual(store.get(saved.id).selected,[0,2]);
  const other=store.submit({weekend:'2099-10-23',events:[{...base,startsAt:'2099-10-23T20:00:00+03:00'}]});
  assert.throws(()=>store.approve(other.id,undefined,[5]),/not in this edition/);
  assert.throws(()=>store.approve(other.id,undefined,[0],[1]),/story was ticked for an event that is not being published/);
  assert.throws(()=>store.approve(other.id,undefined,[]),/at least one/);
});
test('The largest submission the schema allows still fits through the API',async t=>{
  const store=await setup(t),token='c'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  // Every field at its maximum, and in Latvian, where each character costs two bytes.
  const event=i=>({title:'Ī'.repeat(100),startsAt:`2099-10-2${3+Math.floor(i/20)}T${String(8+i%12).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00+03:00`,
    venue:'Ā'.repeat(90),price:'Ē'.repeat(60),summary:'Š'.repeat(220),sourceUrl:'https://example.com/'+'p'.repeat(470),imageUrl:'https://example.com/'+'q'.repeat(470)});
  const events=Array.from({length:60},(_,i)=>event(i));
  const res=await fetch(base+'/api/editions',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({weekend:'2099-10-23',events})});
  assert.equal(res.status,201,'60 events at maximum length are accepted');
  assert.equal((await res.json()).data.events.length,60);
  const tooMany=await fetch(base+'/api/editions',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({weekend:'2099-10-23',events:[...events,event(60)]})});
  assert.equal(tooMany.status,400,'61 is refused by the schema, not by the body size');
  assert.match((await tooMany.json()).error,/events/);
});
test('The date cover shows counts rather than a list that can overflow',async()=>{
  const {coverSvg}=await import('../src/render.js');
  const {postsFor}=await import('../src/domain.js');
  const many={weekend:'2099-10-23',events:Array.from({length:23},(_,i)=>({...fixture().events[0],title:`A very long event title number ${i} that would overflow the card`,startsAt:`2099-10-25T${String(1+i).padStart(2,'0')}:00:00+03:00`}))};
  const posts=postsFor(many);
  const second=coverSvg(posts[1],'2099-10-23');
  assert.match(second,/9 OF 23 EVENTS/);
  assert.match(second,/PART 2 OF 3/);
  assert.doesNotMatch(second,/very long event title/,'titles are gone, so nothing can run off the card');
  const one=coverSvg(postsFor({weekend:'2099-10-23',events:[fixture().events[0]]})[0],'2099-10-23');
  assert.match(one,/>1 EVENT</);
  assert.doesNotMatch(one,/PART/,'a single post is not labelled part 1 of 1');
});
test('The card leads with name, date and price; the detail moves to the caption',async t=>{
  const {cardSvg}=await import('../src/render.js');
  const {dayName,postsFor,postCaption}=await import('../src/domain.js');
  const e={...fixture().events[0],title:'Rīgas mūzikas vakars',price:'€12',venue:'Rīga · koncertzāle',summary:'An evening of live music, 18+ only, doors at half past five.'};
  const svg=cardSvg(e,0,1,'2099-10-23');
  const size=re=>Number(svg.match(re)[1]);
  const name=size(/font-size="(\d+)"[^>]*>Rīgas/), when=size(/font-size="(\d+)"[^>]*>Sat, 24 Oct/), cost=size(/font-size="(\d+)"[^>]*>€12/), where=size(/font-size="(\d+)"[^>]*>Rīga · konc/);
  assert.ok(name>when,`the name is largest (${name} vs ${when})`);
  assert.equal(when,cost,'date and price share the second tier');
  assert.ok(cost>where,`the venue is smaller than the price (${where} vs ${cost})`);
  assert.doesNotMatch(svg,/18\+ only/,'the detail is not on the card');
  const caption=postCaption({events:[e]},postsFor({weekend:'2099-10-23',events:[e]})[0]);
  assert.match(caption,/18\+ only/,'the detail is in the caption instead');
  assert.match(caption,/https:\/\/example\.com\/event/,'and the organiser link survives alongside it');
  // A long title shrinks to fit rather than running off the card.
  const long=cardSvg({...e,title:'A'.repeat(180)},0,1,'2099-10-23');
  assert.ok(size(/font-size="(\d+)"[^>]*>Rīgas/)>Number(long.match(/font-size="(\d+)"[^>]*>A+</)[1]));
});
test('A language tag shows on the card and travels into the caption and digest',async t=>{
  const {cardSvg}=await import('../src/render.js');
  const {postsFor,postCaption,whatsappText,languageTag}=await import('../src/domain.js');
  const tagged={...fixture().events[0],languages:['EN','LV']};
  const svg=cardSvg(tagged,0,1,'2099-10-23');
  assert.equal(languageTag(tagged),'EN · LV');
  assert.match(svg,/<rect[^>]*rx="24"[^>]*fill="#d4ed86"/,'the pill is drawn');
  assert.match(svg,/text-anchor="middle"[^>]*>EN · LV</);
  const data={weekend:'2099-10-23',events:[tagged]};
  assert.doesNotMatch(postCaption(data,postsFor(data)[0]),/EN · LV/,'the tag is on the image, so the caption does not repeat it');
  assert.match(whatsappText(data),/€12 · EN · LV/);
  // Without the field nothing is drawn and nothing is added to the copy.
  const plain=fixture().events[0];
  assert.equal(languageTag(plain),null);
  const plainSlide=cardSvg(plain,0,1,'2099-10-23');
  assert.doesNotMatch(plainSlide,/>(EN|LV|RU)( · |<)/,'no language tag without languages');
  assert.equal((plainSlide.match(/rx="24"/g)||[]).length,1,'only the day tag remains');
  const bare={weekend:'2099-10-23',events:[plain]};
  assert.doesNotMatch(postCaption(bare,postsFor(bare)[0]),/ · EN/);
  const store=await setup(t);
  assert.throws(()=>store.submit({weekend:'2099-10-23',events:[{...plain,languages:['ES']}]}),/languages/i,'only EN, LV and RU are accepted');
  assert.equal(store.submit(data).data.events[0].languages.join(),'EN,LV');
});
test('You can add your own photo where an event has none, and it wins over the organiser image',async t=>{
  const store=await setup(t),token='d'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token,APP_ORIGIN:'http://localhost:3100'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, auth={Authorization:`Bearer ${token}`};
  const e=store.submit(fixture());await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  const before=await readFile(join(store.dir,'media',e.id,'feed-0.jpg'));
  const list=async()=>(await (await fetch(base+'/api/editions',{headers:auth})).json()).find(x=>x.id===e.id);
  assert.deepEqual((await list()).uploads,[]);assert.deepEqual((await list()).organiserPhotos,[],'this event has no organiser photo');
  const upload=(body,type='image/jpeg',extra={})=>fetch(`${base}/api/editions/${e.id}/events/0/photo`,{method:'POST',headers:{...auth,'Content-Type':type,...extra},body});
  // A phone photo: sideways, with a location embedded.
  const phone=await sharp({create:{width:1200,height:900,channels:3,background:'#aa3355'}}).jpeg().withExif({IFD0:{Copyright:'private'},IFD3:{GPSLatitudeRef:'N'}}).toBuffer();
  assert.ok((await sharp(phone).metadata()).exif,'the test image really carries metadata');
  const ok=await upload(phone);assert.equal(ok.status,201);
  const stored=join(store.dir,'media',e.id,'upload-0.jpg');
  assert.equal((await sharp(stored).metadata()).exif,undefined,'location and every other tag are stripped');
  assert.ok(!(await readFile(join(store.dir,'media',e.id,'feed-0.jpg'))).equals(before),'the slide is redrawn with the photo');
  assert.deepEqual((await list()).uploads,[0]);
  const small=await sharp({create:{width:300,height:200,channels:3,background:'#000'}}).png().toBuffer();
  const tooSmall=await upload(small,'image/png');assert.equal(tooSmall.status,400);assert.match((await tooSmall.json()).error,/at least 400 pixels.*200/);
  const junk=await upload(Buffer.from('not an image'),'image/png');assert.equal(junk.status,400);assert.match((await junk.json()).error,/JPEG or PNG/);
  assert.equal((await fetch(`${base}/api/editions/${e.id}/events/7/photo`,{method:'POST',headers:{...auth,'Content-Type':'image/jpeg'},body:phone})).status,400,'an event that does not exist');
  assert.equal((await upload(phone,'image/jpeg',{Origin:'https://evil.example'})).status,403,'another site cannot upload through your session');
  assert.equal((await fetch(`${base}/api/editions/${e.id}/events/0/photo`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:phone})).status,401);
  const removed=await fetch(`${base}/api/editions/${e.id}/events/0/photo`,{method:'DELETE',headers:auth});assert.equal(removed.status,200);
  assert.deepEqual((await list()).uploads,[]);
  // Your upload beats a cached organiser image, and is not credited to anyone.
  const {cardSvg}=await import('../src/render.js');
  const organiser=await sharp({create:{width:900,height:900,channels:3,background:'#113355'}}).jpeg().toBuffer();
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(store.dir,'media',e.id,'photo-0.jpg'),organiser);await writeFile(join(store.dir,'media',e.id,'photo-0.label'),'PHOTO: organiser.example');
  assert.deepEqual((await list()).organiserPhotos,[0]);
  await upload(phone);await renderEdition(store.get(e.id),store.dir,async()=>{throw new Error('offline');});
  const svg=cardSvg(fixture().events[0],0,1,'2099-10-23',false,false,'');
  assert.doesNotMatch(svg,/PHOTO:/);assert.match(svg,/>CHECK ORGANISER FOR UPDATES</);
});
test('No part of a busy day is scheduled after its own events have begun',async()=>{
  const {plannedJobs:planned}=await import('../src/domain.js');
  // Today's real shape: nine events from 10:00, nine from 12:00, eight from 16:00.
  const starts=['10:00','10:30','11:00','11:00','11:00','11:00','11:00','11:00','12:00','12:00','12:00','13:00','13:00','13:30','14:00','15:00','15:00','15:00','16:00','16:00','16:00','17:00','18:00','18:00','18:00','18:20'];
  const data={weekend:'2099-10-23',events:starts.map((t,i)=>({...fixture().events[0],title:`Event ${i}`,startsAt:`2099-10-25T${t}:00+02:00`}))};
  const jobs=planned(data,DateTime.fromISO('2099-10-24T12:00:00Z')).filter(j=>j.target.startsWith('instagram_feed'));
  const byPart=jobs.map(j=>DateTime.fromISO(j.due).setZone('Europe/Riga').toFormat('HH:mm'));
  assert.deepEqual(byPart,['09:00','09:30','10:00']);
  const sorted=[...data.events].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  jobs.forEach((j,p)=>assert.ok(Date.parse(j.due)<=Date.parse(sorted[p*9].startsAt)-3600000,`post ${p+1} goes out an hour before its first event`));
  // An early event pulls its post earlier than 09:00 rather than blocking it.
  const early={weekend:'2099-10-23',events:[{...fixture().events[0],startsAt:'2099-10-25T08:30:00+02:00'}]};
  assert.equal(DateTime.fromISO(planned(early,DateTime.fromISO('2099-10-24T12:00:00Z')).find(j=>j.target.startsWith('instagram_feed')).due).setZone('Europe/Riga').toFormat('HH:mm'),'07:30');
});
test('Captions carry only the title, description and organiser link',async()=>{
  const {postsFor,postCaption}=await import('../src/domain.js');
  const e={...fixture().events[0],price:'€12 for adults',summary:'(Rīgas mūzikas vakars) An evening of live music. 18+.'};
  const data={weekend:'2099-10-23',events:[e]}, caption=postCaption(data,postsFor(data)[0]);
  assert.doesNotMatch(caption,/€12 for adults/,'the price is on the image');
  assert.doesNotMatch(caption,/Sat, 24 Oct|koncertzāle/,'so are the date and venue');
  assert.match(caption,/^1\. Rīgas mūzikas vakars\n\(Rīgas mūzikas vakars\) An evening of live music\. 18\+\.\nhttps:\/\/example\.com\/event$/m,'title, description, link');
});
test('Each slide shows the same number as its caption entry, counted within its own post',async()=>{
  const {cardSvg}=await import('../src/render.js');
  const {postsFor,postCaption}=await import('../src/domain.js');
  const data={weekend:'2099-10-23',events:Array.from({length:12},(_,i)=>({...fixture().events[0],title:`Event ${i}`,startsAt:`2099-10-24T${String(8+i).padStart(2,'0')}:00:00+03:00`}))};
  const second=postsFor(data)[1];
  assert.deepEqual(second.items.map(x=>x.event.title),['Event 9','Event 10','Event 11']);
  assert.match(postCaption(data,second),/^2\. Event 10$/m,'the caption numbers restart in each post');
  const slide=cardSvg(second.items[1].event,1,second.items.length,'2099-10-23');
  assert.match(slide,/<circle[^>]*r="46"[^>]*\/><text[^>]*>2<\/text><text[^>]*>OF 3</,'the slide says 2 of 3, matching the caption');
  assert.doesNotMatch(cardSvg(second.items[1].event,1,3,'2099-10-23',true),/r="46"/,'stories stand alone, so they carry no number');
  assert.doesNotMatch(cardSvg(second.items[1].event,0,0,'2099-10-23'),/r="46"/,'an unpublished event gets no number');
});
test('Stories are dated before an early event, and WhatsApp is never scheduled',async()=>{
  const {plannedJobs:planned}=await import('../src/domain.js');
  const base=fixture().events[0];
  const data={weekend:'2099-10-23',events:[
    {...base,title:'Friday breakfast',startsAt:'2099-10-23T08:00:00+03:00'},
    {...base,title:'Saturday concert',startsAt:'2099-10-24T19:00:00+03:00'},
  ]};
  const jobs=planned(data,DateTime.fromISO('2099-10-20T10:00:00Z'),null,[0,1]);
  const at=t=>DateTime.fromISO(jobs.find(j=>j.target===t).due).setZone('Europe/Riga').toFormat('ccc HH:mm');
  assert.equal(at('instagram_story:0'),'Fri 07:00','a story for an early event is dated an hour before it');
  assert.equal(at('instagram_story:1'),'Sat 09:00','a later event keeps the normal morning slot');
  assert.equal(at('instagram_feed:2099-10-23#1'),'Fri 07:00');
  assert.ok(!jobs.some(j=>j.target.startsWith('whatsapp')));
});
test('Approval hands carousels to Postiz scheduled for their time, and stories as drafts',async t=>{
  const {deliver,MIN_LEAD_MINUTES}=await import('../src/providers.js');
  const store=await setup(t);
  const base=fixture().events[0];
  const e=store.submit({weekend:'2099-10-23',events:[{...base,title:'Saturday',startsAt:'2099-10-24T18:00:00+03:00'},{...base,title:'Sunday',startsAt:'2099-10-25T12:00:00+03:00'}]});
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  const before=Date.now(), jobs=store.approve(e.id,undefined,null,[1]);
  for(const j of jobs) assert.ok(Date.parse(j.due)<=Date.now()+1000,'every item is handed over straight away');
  const feed=jobs.find(j=>j.target==='instagram_feed:2099-10-24#1'), story=jobs.find(j=>j.target==='instagram_story:1');
  assert.equal(DateTime.fromISO(feed.publish_at).setZone('Europe/Riga').toFormat('yyyy-MM-dd HH:mm'),'2099-10-24 09:00','but carries the time it should publish');
  const calls=[];
  const fake=async(url,o)=>{calls.push([url,o]);return {ok:true,json:async()=>url.endsWith('/upload')?{id:'img',path:'https://cdn.example.com/i.jpg'}:[{postId:'p1',integration:'ig'}]};};
  const env={LIVE_PUBLISH:'true',POSTIZ_API_URL:'https://postiz.example/api/public/v1',POSTIZ_API_KEY:'key',INSTAGRAM_INTEGRATION_ID:'ig'};
  const saved=store.get(e.id);
  const scheduled=await deliver(feed,saved,store.dir,env,fake);
  const post=JSON.parse(calls.at(-1)[1].body);
  assert.equal(post.type,'schedule');assert.equal(post.date,new Date(feed.publish_at).toISOString(),'Postiz is told the planned time');
  assert.deepEqual({postiz:scheduled.postiz,publishAt:scheduled.publishAt,postId:scheduled.postId},{postiz:'scheduled',publishAt:post.date,postId:'p1'});
  await deliver(story,saved,store.dir,env,fake);
  const draft=JSON.parse(calls.at(-1)[1].body);
  assert.equal(draft.type,'draft');assert.equal(draft.posts[0].settings.post_type,'story');
  // A slot that already passed lands a few minutes out, so there is still time to move it in Postiz.
  await deliver({...feed,publish_at:'2000-01-01T00:00:00.000Z'},saved,store.dir,env,fake);
  const late=Date.parse(JSON.parse(calls.at(-1)[1].body).date);
  assert.ok(late>=before+MIN_LEAD_MINUTES*60000&&late<=Date.now()+MIN_LEAD_MINUTES*60000+1000);
});
test('WhatsApp is sent only on demand, never twice by accident, and only lists what is still to come',async t=>{
  const store=await setup(t),token='e'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const {runJobs}=await import('../src/providers.js');
  const ev=fixture().events[0];
  const e=store.submit({weekend:'2099-10-23',events:[{...ev,title:'Keep',startsAt:'2099-10-24T18:00:00+03:00'},{...ev,title:'Also',startsAt:'2099-10-25T18:00:00+03:00'}]});
  const send=(resend)=>fetch(`${base}/api/editions/${e.id}/whatsapp`,{method:'POST',headers:auth,body:JSON.stringify({resend})});
  assert.equal((await send()).status,400,'nothing can be sent before approval');
  store.approve(e.id);
  assert.ok(!store.jobs(e.id).some(j=>j.target.startsWith('whatsapp')),'approving does not send WhatsApp');
  const first=await send();assert.equal(first.status,202);
  assert.equal((await (await send()).json()).id,(await first.json()).id,'pressing twice while it is sending does not queue two');
  const sent=[];
  const fake=async(url,o)=>{sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({id:'wa'})};};
  const env={LIVE_PUBLISH:'true',WAHA_URL:'http://waha:3000',WAHA_API_KEY:'k',WAHA_CHAT_ID:'1@g.us'};
  store.db.prepare("UPDATE jobs SET status='sent' WHERE target LIKE 'instagram%'").run();
  await runJobs(store,env,fake);
  assert.equal(sent.length,1);assert.match(sent[0].text,/Keep/);
  const again=await send();assert.equal(again.status,409,'a second send needs to be asked for');assert.match((await again.json()).error,/already sent/);
  assert.equal((await send(true)).status,202);
  assert.ok(store.jobs(e.id).some(j=>j.target==='whatsapp#2'),'a deliberate resend is its own record');
  // Mid-weekend, the digest leaves out events that have already begun.
  store.db.prepare('UPDATE editions SET data=? WHERE id=?').run(JSON.stringify({...e.data,events:[{...e.data.events[0],startsAt:'2000-01-01T10:00:00+02:00'},e.data.events[1]]}),e.id);
  await runJobs(store,env,fake);
  assert.equal(sent.length,2);assert.doesNotMatch(sent[1].text,/Keep/);assert.match(sent[1].text,/Also/);
  store.db.prepare('UPDATE editions SET data=? WHERE id=?').run(JSON.stringify({...e.data,events:e.data.events.map(x=>({...x,startsAt:'2000-01-01T10:00:00+02:00'}))}),e.id);
  store.queueWhatsApp(e.id,true);await runJobs(store,env,fake);
  assert.equal(sent.length,2,'nothing is sent when every event has started');
  assert.match(store.jobs(e.id).find(j=>j.target==='whatsapp#3').result,/already started/);
});
test('Photos are locked once approved, because they are already in Postiz',async t=>{
  const store=await setup(t),token='f'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const e=store.submit(fixture());store.approve(e.id);
  const photo=await sharp({create:{width:900,height:900,channels:3,background:'#335577'}}).jpeg().toBuffer();
  const res=await fetch(`${base}/api/editions/${e.id}/events/0/photo`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg'},body:photo});
  assert.equal(res.status,400);assert.match((await res.json()).error,/already in Postiz/);
});
test('Captions use short links, so every description fits whole',async t=>{
  const {postsFor,postCaption}=await import('../src/domain.js');
  const store=await setup(t);
  const long='https://www.riga.lv/lv/notikums/jugendstila-terpiem-veltits-bernu-rits-muzeja-rigas-jugendstila-centrs?date=0&utm_source=listing';
  // Nine events with maximum-length descriptions and very long organiser links.
  const data={weekend:'2099-10-23',events:Array.from({length:9},(_,i)=>({...fixture().events[0],title:`Event ${i}`,startsAt:`2099-10-24T${String(9+i).padStart(2,'0')}:00:00+03:00`,summary:`D${i} `+'x'.repeat(214),sourceUrl:`${long}&n=${i}`}))};
  const post=postsFor(data)[0], link=store.linker('rtw.lv');
  const withFull=postCaption(data,post), withShort=postCaption(data,post,link);
  assert.match(withFull,/…/,'with full links the descriptions had to be cut');
  assert.doesNotMatch(withShort,/…/,'with short links no description is cut');
  for(let i=0;i<9;i++) assert.ok(withShort.includes(`D${i} `+'x'.repeat(214)),`description ${i} is complete`);
  assert.ok(withShort.length<=2200);
  assert.doesNotMatch(withShort,/riga\.lv\/lv\/notikums/,'no full link is printed');
  assert.equal((withShort.match(/rtw\.lv\/[a-z2-9]{5}/g)||[]).length,9);
  assert.doesNotMatch(withShort,/Save this for the weekend/,'on this extreme post the closing line gave way first');
  // With the dashboard's own, longer host and realistic descriptions, nine still fit whole with hashtags.
  const typical={...data,events:data.events.map((x,i)=>({...x,summary:`T${i} `+'y'.repeat(146)}))};
  const onHost=postCaption(typical,postsFor(typical)[0],store.linker('riga.petalsforher.com'));
  assert.doesNotMatch(onHost,/…/);assert.match(onHost,/#Riga #RigaEvents #Rīga$/);
  // A shorter post keeps its titles too.
  const small={weekend:'2099-10-23',events:data.events.slice(0,3)};
  assert.match(postCaption(small,postsFor(small)[0],link),/^1\. Event 0$/m);
});
test('Short codes are stable per link, unambiguous, and redirect publicly with a click count',async t=>{
  const store=await setup(t),token='g'.repeat(32);
  const app=createApp(store,{ADMIN_TOKEN:token,APP_ORIGIN:'https://riga.example.com'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const a=store.shortCode('https://organiser.example/a'), b=store.shortCode('https://organiser.example/b');
  assert.equal(store.shortCode('https://organiser.example/a'),a,'the same link keeps its code across editions');
  assert.notEqual(a,b);
  for(let i=0;i<200;i++){const c=store.shortCode(`https://organiser.example/${i}`);assert.match(c,/^[a-hj-km-np-z2-9]{5}$/,'no 0/o, 1/l/i look-alikes');assert.match(c,/\d/,'always a digit');}
  const hop=await fetch(`${base}/${a}`,{redirect:'manual'});
  assert.equal(hop.status,302,'no login needed to follow a caption link');
  assert.equal(hop.headers.get('location'),'https://organiser.example/a');
  await fetch(`${base}/${a}`,{redirect:'manual'});
  assert.equal(store.clicks('https://organiser.example/a').clicks,2);
  assert.equal((await fetch(`${base}/zz9zz`,{redirect:'manual'})).status,404,'an unknown code is a plain not-found, not a login prompt');
  assert.equal((await fetch(`${base}/media`,{redirect:'manual'})).status,401,'real routes are untouched');
  // The review page shows each event's short link and its clicks.
  const e=store.submit({weekend:'2099-10-23',events:[{...fixture().events[0],sourceUrl:'https://organiser.example/a'}]});
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');},{link:store.linker('riga.example.com')});
  const row=(await (await fetch(base+'/api/editions',{headers:{Authorization:`Bearer ${token}`}})).json()).find(x=>x.id===e.id);
  assert.deepEqual(row.shortLinks['0'],{url:`riga.example.com/${a}`,via:'own',clicks:2});
  assert.match(row.posts[0].caption,new RegExp(`riga\\.example\\.com/${a}`),'the previewed caption is the one that will publish');
});
test('ej.uz links are created for published events and preferred in captions, with the app link as fallback',async t=>{
  const {prepareLinks,captionLinker,linkSummary,refreshClicks}=await import('../src/shortlinks.js');
  const store=await setup(t), env={EJUZ_API_KEY:'ejuz_test_key',APP_ORIGIN:'https://riga.example.com'};
  const calls=[]; let next=0;
  const ok=(status,result)=>({ok:status<300,status,json:async()=>({code:status,error:status>=300,result})});
  const fake=async(url,o)=>{
    calls.push({url,method:o.method||'GET',auth:o.headers.Authorization,body:o.body&&JSON.parse(o.body)});
    if(url.endsWith('/smurls')&&o.method==='POST'){
      const target=JSON.parse(o.body).url;
      if(target.includes('blocked')) return {ok:false,status:400,json:async()=>({error:true,code:400,message:'šī garā saite ir nederīga vai tās domēns ir bloķēts (blocklist)'})};
      return ok(201,{url:target,smurl:`ab${next++}cd`,shortUrl:'https://ej.uz/x'});
    }
    if(url.endsWith('/clicks')) return ok(200,{total:7,clicks:[]});
    return ok(404,{});
  };
  const urls=['https://organiser.example/a','https://organiser.example/b','https://blocked.example/c'];
  const first=await prepareLinks(store,urls,env,fake,{sleep:async()=>{}});
  assert.deepEqual(first,{created:2,fellBack:1,stopped:null});
  assert.ok(calls.every(c=>c.auth==='Bearer ejuz_test_key'&&c.url.startsWith('https://ej.uz/api/v1/')),'the key only ever goes to ej.uz');
  const link=captionLinker(store,env);
  assert.equal(link(urls[0]),'ej.uz/ab0cd');
  assert.match(link(urls[2]),/^riga\.example\.com\/[a-z2-9]{5}$/,'a refused URL falls back to the app link');
  const before=calls.length;
  await prepareLinks(store,urls,env,fake,{sleep:async()=>{}});
  assert.equal(calls.length,before,'known links and recently refused ones are not requested again');
  // The app's own code still redirects, so nothing breaks if ej.uz later removes a link.
  assert.equal(store.follow(store.shortCode(urls[0])),urls[0]);
  store.follow(store.shortCode(urls[0]));
  assert.equal(await refreshClicks(store,env,fake),2);
  assert.deepEqual(linkSummary(store,urls[0],env),{url:'ej.uz/ab0cd',via:'ej.uz',clicks:2+7},'clicks from both links are added up');
  // No key, no calls.
  const quiet=[];await prepareLinks(store,['https://organiser.example/new'],{},async(...a)=>{quiet.push(a);});
  assert.equal(quiet.length,0);
});
test('A bad key or an ej.uz outage stops early and every caption still gets a working link',async t=>{
  const {prepareLinks,captionLinker}=await import('../src/shortlinks.js');
  const env={EJUZ_API_KEY:'k',APP_ORIGIN:'https://riga.example.com'};
  const urls=Array.from({length:6},(_,i)=>`https://organiser.example/${i}`);
  let authCalls=0; const store=await setup(t);
  const badKey=await prepareLinks(store,urls,env,async()=>{authCalls++;return {ok:false,status:401,json:async()=>({error:true,message:'API key required'})};},{sleep:async()=>{}});
  assert.equal(authCalls,1,'a rejected key is tried once, not six times');
  assert.deepEqual({created:badKey.created,fellBack:badKey.fellBack},{created:0,fellBack:6});
  let downCalls=0; const other=await setup(t);
  await prepareLinks(other,urls,env,async()=>{downCalls++;throw new Error('timeout');},{sleep:async()=>{}});
  assert.equal(downCalls,3,'three failures in a row and it stops');
  const link=captionLinker(other,env);
  for(const u of urls) assert.match(link(u),/^riga\.example\.com\//);
});
test('Approving creates ej.uz links only for the events being published',async t=>{
  const store=await setup(t),token='h'.repeat(32), posted=[];
  let jobsSeen=0;
  const fake=async(url,o)=>{if(o.method==='POST'){jobsSeen+=store.db.prepare('SELECT count(*) n FROM jobs').get().n;const u=JSON.parse(o.body).url;posted.push(u);return {ok:true,status:201,json:async()=>({result:{url:u,smurl:`z${posted.length}zz`}})};}return {ok:false,status:404,json:async()=>({})};};
  const app=createApp(store,{ADMIN_TOKEN:token,EJUZ_API_KEY:'k',APP_ORIGIN:'http://localhost:3100',EJUZ_TEST_NO_WAIT:'1'},{fetcher:fake});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, ev=fixture().events[0];
  const e=store.submit({weekend:'2099-10-23',events:[{...ev,title:'One',sourceUrl:'https://o.example/1'},{...ev,title:'Two',startsAt:'2099-10-24T19:00:00+03:00',sourceUrl:'https://o.example/2'},{...ev,title:'Three',startsAt:'2099-10-24T20:00:00+03:00',sourceUrl:'https://o.example/3'}]});
  assert.equal(posted.length,0,'submitting a candidate list creates nothing at ej.uz');
  const res=await fetch(`${base}/api/editions/${e.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({events:[0,2]})});
  assert.equal(res.status,200);
  assert.deepEqual(posted.sort(),['https://o.example/1','https://o.example/3']);
  assert.equal(jobsSeen,0,'links are made before anything is queued for Postiz');
  const row=(await (await fetch(base+'/api/editions',{headers:{Authorization:`Bearer ${token}`}})).json()).find(x=>x.id===e.id);
  assert.match(row.posts[0].caption,/ej\.uz\/z\dzz/);
  assert.notEqual(row.shortLinks['1']?.via,'ej.uz','the unpublished event gets no ej.uz link');
});
test('Every cover carries the several-days note, and slides show a day tag beside the language tag',async t=>{
  const {postsFor,postCaption,whatsappText,dayTag}=await import('../src/domain.js');
  const {coverSvg,cardSvg}=await import('../src/render.js');
  const base=fixture().events[0];
  const exhibition={...base,title:'Textile Mosaic',startsAt:'2099-10-23T09:00:00+03:00',summary:'Quilts. Open Friday, Saturday and Sunday.',languages:['EN','LV','RU'],alsoOn:['2099-10-25','2099-10-24']};
  const concert={...base,title:'One-night concert',startsAt:'2099-10-24T19:00:00+03:00'};
  const store=await setup(t), e=store.submit({weekend:'2099-10-23',events:[exhibition,concert]});
  assert.equal(dayTag(e.data.events[0]),'FRI · SAT · SUN');
  assert.equal(dayTag(e.data.events[1]),'SAT','a one-day event shows its own day');
  for(const post of postsFor(e.data)) {
    const cover=coverSvg(post,'2099-10-23');
    assert.match(cover,/EXHIBITIONS MAY RUN SEVERAL DAYS/,'the note is on every cover, whatever the post contains');
    assert.match(cover,/CHECK THE CAPTION FOR DATES/);
  }
  const slide=cardSvg(e.data.events[0],0,1,'2099-10-23');
  assert.match(slide,/>EN · LV · RU</);assert.match(slide,/>FRI · SAT · SUN</);
  const langY=Number(slide.match(/<rect x="\d+" y="(\d+)"[^>]*rx="24"[^>]*\/><text[^>]*>EN · LV · RU</)[1]);
  const dayY=Number(slide.match(/<rect x="\d+" y="(\d+)"[^>]*rx="24"[^>]*\/><text[^>]*>FRI · SAT · SUN</)[1]);
  assert.equal(dayY,langY+60,'the day tag sits directly under the language tag');
  assert.match(cardSvg(e.data.events[0],0,1,'2099-10-23',true),/>FRI · SAT · SUN</,'stories carry it too');
  // Descriptions already say which days, so captions and the digest do not repeat it.
  const caption=postCaption(e.data,postsFor(e.data)[0]);
  assert.doesNotMatch(caption,/Also on/);assert.match(caption,/Open Friday, Saturday and Sunday/);
  assert.doesNotMatch(whatsappText(e.data),/also on/i);
  assert.throws(()=>store.submit({weekend:'2099-10-23',events:[{...concert,alsoOn:['2099-10-24']}]}),/cannot repeat the event's own day/);
  assert.throws(()=>store.submit({weekend:'2099-10-23',events:[{...concert,alsoOn:['2099-10-30']}]}),/another day of this weekend/);
});
test('A Postiz rate limit is retried automatically instead of needing a manual check',async t=>{
  const store=await setup(t), e=store.submit(fixture());await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  store.approve(e.id,undefined,null,[0]);
  let calls=0;
  const limited=async url=>{calls++;return url.endsWith('/upload')?{ok:true,status:200,json:async()=>({id:'i',path:'https://cdn.example/i.jpg'})}:{ok:false,status:429,json:async()=>({})};};
  const env={LIVE_PUBLISH:'true',POSTIZ_API_URL:'https://postiz.example/api/public/v1',POSTIZ_API_KEY:'k',INSTAGRAM_INTEGRATION_ID:'ig'};
  await runJobs(store,env,limited);
  const jobs=store.jobs(e.id);
  assert.ok(jobs.every(j=>j.status==='queued'),'refused posts go back in the queue, not to "needs checking"');
  assert.ok(jobs.every(j=>Date.parse(j.due)>Date.now()+9*60000),'and wait about ten minutes');
  assert.match(jobs[0].result,/retrying automatically/);
  const before=calls;await runJobs(store,env,limited);assert.equal(calls,before,'nothing is retried before its time');
});
test('You can tick the other days on the review page, and approved editions are left alone',async t=>{
  const store=await setup(t),token='i'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const e=store.submit({weekend:'2099-10-23',events:[{...fixture().events[0],startsAt:'2099-10-23T10:00:00+03:00'}]});
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  const set=body=>fetch(`${base}/api/editions/${e.id}/events/0/also-on`,{method:'POST',headers:auth,body:JSON.stringify(body)});
  assert.equal((await set({alsoOn:['2099-10-25']})).status,200);
  assert.deepEqual(store.get(e.id).data.events[0].alsoOn,['2099-10-25']);
  const {dayTag}=await import('../src/domain.js');
  assert.equal(dayTag(store.get(e.id).data.events[0]),'FRI · SUN','the day tag follows the ticks');
  const row=(await (await fetch(base+'/api/editions',{headers:auth})).json()).find(x=>x.id===e.id);
  assert.deepEqual(row.weekendDays,['2099-10-23','2099-10-24','2099-10-25']);assert.equal(row.eventDates[0],'2099-10-23');
  const bad=await set({alsoOn:['2099-10-23']});assert.equal(bad.status,400);
  assert.equal((await set({alsoOn:[]})).status,200);assert.equal(store.get(e.id).data.events[0].alsoOn,undefined,'unticking everything clears it');
  store.approve(e.id);
  const locked=await set({alsoOn:['2099-10-24']});assert.equal(locked.status,400);assert.match((await locked.json()).error,/already in Postiz/);
});
test('Slide and cover copy stays clear of the strip where carousel dots are drawn',async()=>{
  const {coverSvg,cardSvg}=await import('../src/render.js');
  const {postsFor}=await import('../src/domain.js');
  const data={weekend:'2099-10-23',events:[{...fixture().events[0],alsoOn:['2099-10-25']}]};
  const lowest=svg=>Math.max(...[...svg.matchAll(/<text[^>]* y="([\d.]+)"/g)].map(m=>Number(m[1])),...[...svg.matchAll(/<rect x="80" y="([\d.]+)"[^>]*height="([\d.]+)"/g)].map(m=>Number(m[1])+Number(m[2])));
  assert.ok(lowest(coverSvg(postsFor(data)[0],'2099-10-23'))<=1210,'cover text ends above the dot strip');
  assert.ok(lowest(cardSvg(data.events[0],0,1,'2099-10-23',false,false,'PHOTO: x.example'))<=1210,'photo slide text ends above it');
  assert.ok(lowest(cardSvg(data.events[0],0,1,'2099-10-23'))<=1210,'plain slide text ends above it');
  assert.ok(lowest(cardSvg(data.events[0],0,1,'2099-10-23',true))<=1730,'stories are unchanged');
});
test('ej.uz link creation keeps to the per-minute, hourly and daily limits',async t=>{
  const {prepareLinks,ejuzLimits}=await import('../src/shortlinks.js');
  assert.deepEqual(ejuzLimits({}),{minute:25,hour:90,day:450,pauseMs:2500},'defaults sit under 30/100/500');
  assert.equal(ejuzLimits({EJUZ_PER_MINUTE:'30',EJUZ_PER_HOUR:'100'}).hour,100);
  const store=await setup(t), env={EJUZ_API_KEY:'k'};
  let clock=Date.parse('2099-01-01T10:00:00Z'), made=0, waited=0;
  const now=()=>clock, sleep=async ms=>{waited+=ms;clock+=ms;};
  const fake=async(url,o)=>{clock+=200;made++;return {ok:true,status:201,json:async()=>({result:{smurl:`q${made}xx`}})};};
  const limits={minute:30,hour:100,day:500,pauseMs:2100};
  // 120 events at once: paced to 30 a minute, and stops at 100 within the hour.
  const urls=Array.from({length:120},(_,i)=>`https://o.example/${i}`);
  const r=await prepareLinks(store,urls,env,fake,{limits,sleep,now});
  assert.equal(r.created,100);assert.equal(r.fellBack,20);assert.equal(r.stopped,'hourly limit');
  for(let m=0;m*60000<clock-Date.parse('2099-01-01T10:00:00Z');m++){
    const from=new Date(Date.parse('2099-01-01T10:00:00Z')+m*60000).toISOString(), to=new Date(Date.parse('2099-01-01T10:00:00Z')+(m+1)*60000).toISOString();
    assert.ok(store.db.prepare('SELECT count(*) n FROM ejuz_calls WHERE at>=? AND at<?').get(from,to).n<=30,`minute ${m} stays within 30`);
  }
  // Nothing more that hour; captions for the rest use the app's own link.
  const again=await prepareLinks(store,['https://o.example/new'],env,fake,{limits,sleep,now});
  assert.equal(again.created,0);assert.equal(again.stopped,'hourly limit');
  // An explicit rate-limit answer from ej.uz stops the run straight away.
  const other=await setup(t);let tries=0;
  const limited=await prepareLinks(other,urls.slice(0,5),env,async()=>{tries++;return {ok:false,status:429,json:async()=>({})};},{limits,sleep:async()=>{},now:()=>Date.now()});
  assert.equal(tries,1);assert.equal(limited.stopped,'rate limited by ej.uz');assert.equal(limited.fellBack,5);
});
test('A refused approval makes no ej.uz links',async t=>{
  const store=await setup(t),token='j'.repeat(32),posted=[];
  const fake=async(url,o)=>{posted.push(url);return {ok:true,status:201,json:async()=>({result:{smurl:'nope1'}})};};
  const app=createApp(store,{ADMIN_TOKEN:token,EJUZ_API_KEY:'k',EJUZ_TEST_NO_WAIT:'1'},{fetcher:fake});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, ev=fixture().events[0];
  const first=store.submit({weekend:'2099-10-23',events:[{...ev,sourceUrl:'https://o.example/a'}]});store.approve(first.id);
  const clash=store.submit({weekend:'2099-10-23',events:[{...ev,title:'Same day',sourceUrl:'https://o.example/b'}]});
  const res=await fetch(`${base}/api/editions/${clash.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({events:[0]})});
  assert.equal(res.status,400);assert.match((await res.json()).error,/already covers/);
  assert.equal(posted.length,0,'the selection was refused before any link was requested');
});
test('The ej.uz client follows its documented statuses, messages, Retry-After and display form',async t=>{
  const {ejuzCreate,ejuzDelete,ejuzClicks,prepareLinks,captionLinker}=await import('../src/shortlinks.js');
  const res=(status,body,headers={})=>({ok:status<300,status,headers:new Headers(headers),json:async()=>{if(body===undefined)throw new Error('no body');return body;}});
  // 200 means an existing matching link was returned: still success, and the display form is used.
  assert.deepEqual(await ejuzCreate('https://o.example/a','k',async()=>res(200,{code:200,error:false,result:{smurl:'abcde',displaySmurl:'AbCdE',shortUrl:'https://ej.uz/abcde',url:'https://o.example/a'}})),{smurl:'abcde',display:'AbCdE'});
  await assert.rejects(ejuzCreate('https://o.example/a','k',async()=>res(201,{result:{smurl:'abcde',shortUrl:'https://evil.example/abcde'}})),/another domain/);
  // `message` may be an object with translations.
  await assert.rejects(ejuzCreate('https://o.example/a','k',async()=>res(400,{code:400,error:true,message:{en:'Invalid link',lv:'Nederīga saite',ja:'…'}})),/Nederīga saite/);
  await assert.rejects(ejuzCreate('https://o.example/a','k',async()=>res(403,{message:'Email not verified'})),e=>e.kind==='auth'&&/Email not verified/.test(e.message));
  // 204 delete has no body; deleting something already gone is fine.
  await ejuzDelete('abcde','k',async(url,o)=>{assert.equal(o.method,'DELETE');return res(204,undefined);});
  await ejuzDelete('gone1','k',async()=>res(404,{code:404,error:true}));
  // Clicks are read from the top level of the response.
  assert.equal(await ejuzClicks('abcde','k',async()=>res(200,{smurl:'abcde',total:3,clicks:[{clicks:3,country:'LV',day:'24-06-2026',platform:'android',ruleId:null}]})),3);
  // A short Retry-After is waited out once, then the link is made.
  const store=await setup(t);let n=0,slept=0;
  const r=await prepareLinks(store,['https://o.example/r'],{EJUZ_API_KEY:'k'},async()=>++n===1?res(429,{code:429,error:true},{'Retry-After':'7'}):res(201,{result:{smurl:'rtry1',displaySmurl:'Rtry1'}}),{sleep:async ms=>{slept+=ms;}});
  assert.equal(r.created,1);assert.equal(slept,7000);assert.equal(captionLinker(store,{})('https://o.example/r'),'ej.uz/Rtry1');
  // A long one ends the run instead of stalling an approval.
  const other=await setup(t);
  const long=await prepareLinks(other,['https://o.example/x','https://o.example/y'],{EJUZ_API_KEY:'k'},async()=>res(429,{},{'Retry-After':'3600'}),{sleep:async()=>{throw new Error('should not wait');}});
  assert.equal(long.created,0);assert.equal(long.stopped,'rate limited by ej.uz');
});
test('A special post has its own heading, shares the day with the regular post and goes out at noon',async t=>{
  const {postsFor,postCaption,whatsappText}=await import('../src/domain.js');
  const {coverSvg}=await import('../src/render.js');
  const store=await setup(t), friday={...fixture().events[0],title:'Late lab tour',startsAt:'2099-10-23T19:00:00+03:00'};
  const regular=store.submit({weekend:'2099-10-23',events:[friday,{...friday,title:'Concert'}]});
  const special=store.submit({weekend:'2099-10-23',headline:'Researchers’ Night',events:[friday]});
  assert.notEqual(special.id,regular.id);
  const cover=coverSvg(postsFor(special.data)[0],'2099-10-23',false,undefined,special.data.headline);
  assert.match(cover,/>RESEARCHERS’<\/text><text[^>]*>NIGHT</,'the heading is on the cover, wrapped to fit');
  assert.match(cover,/>FRIDAY</,'with the date as usual');
  assert.doesNotMatch(coverSvg(postsFor(regular.data)[0],'2099-10-23'),/RESEARCHERS/);
  assert.match(postCaption(special.data,postsFor(special.data)[0]),/^Researchers’ Night · Friday 23 October in Rīga\./);
  assert.match(whatsappText(special.data),/^RESEARCHERS’ NIGHT · RĪGA · 2099-10-23/);
  store.approve(regular.id);
  const jobs=store.approve(special.id);
  assert.equal(jobs.find(j=>j.target==='instagram_feed:2099-10-23#1').publish_at,'2099-10-23T09:00:00.000Z','noon in Riga, not on top of the 09:00 post');
  assert.throws(()=>store.approve(store.submit({weekend:'2099-10-23',events:[{...friday,title:'Another regular'}]}).id),/already covers 2099-10-23/,'regular posts still get one per day');
  assert.throws(()=>store.submit({weekend:'2099-10-23',headline:'x'.repeat(41),events:[friday]}),/headline/);
});
test('Each day has a colour theme you can change until the edition is approved',async t=>{
  const {THEMES,themeKey}=await import('../src/themes.js');
  const {coverSvg,cardSvg}=await import('../src/render.js');
  const {postsFor}=await import('../src/domain.js');
  const store=await setup(t), base=fixture().events[0];
  const e=store.submit({weekend:'2099-10-23',events:[{...base,startsAt:'2099-10-23T18:00:00+03:00'},{...base,title:'Saturday thing'},{...base,title:'Sunday thing',startsAt:'2099-10-25T18:00:00+03:00'}]});
  const days=['2099-10-23','2099-10-24','2099-10-25'];
  assert.equal(new Set(days.map(d=>themeKey(e,d))).size,3,'Friday, Saturday and Sunday differ by default');
  assert.equal(themeKey({data:{headline:'Researchers’ Night'}},'2099-10-23'),'ember','a special post stands apart');
  const plum=store.setTheme(e.id,'2099-10-24','plum');
  assert.equal(themeKey(plum,'2099-10-24'),'plum');
  assert.equal(themeKey(plum,'2099-10-23'),themeKey(e,'2099-10-23'),'the other days keep theirs');
  assert.match(coverSvg(postsFor(plum.data)[1],'2099-10-23',false,THEMES.plum),new RegExp(`fill="${THEMES.plum.ink}"`));
  assert.match(cardSvg(base,0,1,'2099-10-23',false,false,null,null,false,THEMES.plum),new RegExp(`fill="${THEMES.plum.accent}"`));
  assert.throws(()=>store.setTheme(e.id,'2099-10-24','neon'),/Unknown colour theme/);
  assert.throws(()=>store.setTheme(e.id,'2099-10-26','plum'),/No events/);
  store.approve(e.id);
  assert.throws(()=>store.setTheme(e.id,'2099-10-24','teal'),/already in Postiz/);
});
test('Ticked events become a special post from the review page, photos included',async t=>{
  const store=await setup(t),token='s'.repeat(32);const app=createApp(store,{ADMIN_TOKEN:token});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`, auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const ev=fixture().events[0];
  const e=store.submit({weekend:'2099-10-23',events:[{...ev,title:'Early',startsAt:'2099-10-23T10:00:00+03:00'},{...ev,title:'Lab night',startsAt:'2099-10-23T19:00:00+03:00'},{...ev,title:'Late',startsAt:'2099-10-23T22:00:00+03:00'}]});
  await renderEdition(e,store.dir,async()=>{throw new Error('offline');});
  const photo=await sharp({create:{width:600,height:600,channels:3,background:'#ff0000'}}).jpeg().toBuffer();
  assert.equal((await fetch(`${base}/api/editions/${e.id}/events/2/photo`,{method:'POST',headers:{Authorization:auth.Authorization,'Content-Type':'image/jpeg'},body:photo})).status,201);
  const res=await fetch(`${base}/api/editions/${e.id}/special`,{method:'POST',headers:auth,body:JSON.stringify({headline:'Researchers’ Night',events:[2,1]})});
  assert.equal(res.status,201);
  const special=await res.json();
  assert.equal(special.data.headline,'Researchers’ Night');
  assert.deepEqual(special.data.events.map(x=>x.title),['Lab night','Late']);
  assert.ok((await readFile(join(store.dir,'media',special.id,'upload-1.jpg'))).length,'your photo follows its event to its new position');
  const row=(await (await fetch(base+'/api/editions',{headers:auth})).json()).find(x=>x.id===special.id);
  assert.equal(row.headline,'Researchers’ Night');assert.equal(row.posts[0].theme,'ember');
  const set=await fetch(`${base}/api/editions/${special.id}/themes/2099-10-23`,{method:'POST',headers:auth,body:JSON.stringify({theme:'teal'})});
  assert.equal(set.status,200);assert.equal(store.get(special.id).themes['2099-10-23'],'teal');
  assert.equal((await fetch(`${base}/api/editions/${special.id}/themes/2099-10-23`,{method:'POST',headers:auth,body:JSON.stringify({theme:'neon'})})).status,400);
});
