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
  const data={weekend:'2026-10-23',events:[{...fixture().events[0],startsAt:'2026-10-25T18:00:00+02:00'}]};
  const jobs=plannedJobs(data,DateTime.fromISO('2026-10-22T10:00:00Z'));
  assert.equal(jobs[0].due,'2026-10-23T06:00:00.000Z');
  assert.equal(jobs[2].due,'2026-10-25T07:00:00.000Z');
});
test('Submissions and approvals deduplicate; competing editions cannot both publish',async t=>{
  const store=await setup(t),e=store.submit(fixture());assert.equal(store.submit(fixture()).id,e.id);
  store.approve(e.id);store.approve(e.id);assert.equal(store.jobs(e.id).length,3);
  const updated=fixture();updated.events[0].price='€15';const e2=store.submit(updated);
  assert.throws(()=>store.approve(e2.id),/UNIQUE/);assert.equal(store.get(e2.id).approved,0);
  assert.throws(()=>store.approve(store.submit(fixture(),true).id),/Demo/);
});
test('Two database connections cannot claim the same job; interrupted sends stay uncertain',async t=>{
  const store=await setup(t);const other=new Store(store.dir);t.after(()=>other.close());const e=store.submit(fixture());store.approve(e.id);
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
  const body=JSON.parse(calls[1][1].body);assert.equal(body.posts[0].settings.post_type,'story');assert.equal(body.posts[0].value[0].content,'');assert.equal(body.type,'now');
  await deliver({target:'whatsapp'},e,store.dir,env,fake);assert.equal(JSON.parse(calls[2][1].body).chatId,'123@g.us');
});
test('Preview mode never calls providers; timeouts are never blindly retried',async t=>{
  const store=await setup(t),e=store.submit(fixture());store.approve(e.id);store.db.prepare("UPDATE jobs SET due='2000-01-01' WHERE target='whatsapp'").run();
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
