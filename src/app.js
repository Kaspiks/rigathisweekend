import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Submission, whatsappText, postCaptionPreview, weekendFor, postsFor, postName, checkAlsoOn, weekendDays, eventDate, eventsByDay, eventTime, dayName, weekendOver } from './domain.js';
import { GridRequest, buildGrid, checkPicks, dayEvents, gridDay, gridFiles, suggestPicks, ticketText, dropTiles } from './grids.js';
import { renderEdition, uploadPath } from './render.js';
import { ensureThumb } from './thumbs.js';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { researchInto } from './research.js';
import { prepareLinks, captionLinker, linkSummary } from './shortlinks.js';
import { request, gridVideo } from './providers.js';
import { createOAuthProvider } from './oauth.js';

function equal(a,b) {const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function createApp(store,env=process.env,{fetcher=fetch}={}) {
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<24) throw new Error('ADMIN_TOKEN must be at least 24 characters');
  const app=express(); app.disable('x-powered-by'); app.set('trust proxy',1);
  store.recoverGrids();
  app.locals.renders=new Set(); // in-flight story renders, so tests (and shutdown) can wait for them
  app.get('/healthz',(_req,res)=>res.json({ok:true}));
  // Short links are public: anyone reading a caption can follow one. A code only ever maps to an
  // organiser URL this server stored itself, so the redirect cannot be pointed anywhere else.
  app.get(/^\/([a-hj-km-np-z2-9]{5})$/,(req,res,next)=>{
    const code=req.params[0], url=store.follow(code);
    // Generated codes always contain a digit, so a digit-free path like /media is left to the real routes.
    if(!url) return /\d/.test(code)?res.status(404).type('text').send('This link does not exist or has expired.'):next();
    res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer');
    res.redirect(302,url);
  });
  const link=captionLinker(store,env);
  const hasPhoto=(e,i)=>existsSync(uploadPath(store.dir,e.id,i))||existsSync(resolve(store.dir,'media',e.id,`photo-${i}.jpg`));
  const gridsFor=e=>eventsByDay(e.data,e.approved?e.selected:null).map(({date,items})=>{
    const files=gridFiles(store.dir,e.id,date);
    return {date,day:gridDay(date),name:dayName(date),suggested:suggestPicks(e,date,i=>hasPhoto(e,i)),
      events:items.map(({event,index})=>({index,title:event.title,time:eventTime(event)})),
      saved:store.grid(e.id,date),collage:existsSync(files.png),video:existsSync(files.mp4),
      posts:store.jobs(e.id).filter(j=>gridVideo(j.target)?.date===date).map(j=>({...j,kind:gridVideo(j.target).kind}))};
  });
  // OAuth endpoints are public by design: /.well-known/*, /authorize, /token, /register, /revoke, /oauth/login.
  const oauth=createOAuthProvider(store,env); app.use(oauth.router);
  app.use(async(req,res,next)=>{
    const auth=req.headers.authorization||'';
    const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
    const basic=auth.startsWith('Basic ')?Buffer.from(auth.slice(6),'base64').toString():'';
    const password=basic.slice(basic.indexOf(':')+1);
    let admin=basic.startsWith('admin:')&&equal(password,env.ADMIN_TOKEN);
    if(bearer) {
      try {const info=await oauth.provider.verifyAccessToken(bearer); if(info.expiresAt>Date.now()/1000) {req.auth=info; admin=info.clientId==='admin';}} catch {}
    }
    // OAuth clients (ChatGPT) may only use the MCP endpoint; the dashboard and API stay admin-only.
    if(!admin&&!(req.auth&&req.path==='/mcp')) {
      if(req.path==='/mcp') {res.set('WWW-Authenticate',`Bearer resource_metadata="${oauth.resourceMetadataUrl}"`);return res.status(401).json({error:'invalid_token',error_description:'Authorize this MCP server via OAuth or use the admin token'});}
      res.set('WWW-Authenticate','Basic realm="Riga Weekend"');return res.status(401).send('Authentication required');
    }
    if(req.headers.origin && req.headers.origin!==(env.APP_ORIGIN||'http://localhost:3100')) return res.status(403).send('Origin not allowed');
    // Rendered media never changes under the same name within a visit; the dashboard adds ?v= when it does.
    res.set('Cache-Control',/^\/(media|thumb)\//.test(req.path)?'private, max-age=86400':'no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Security-Policy',"default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    next();
  });
  // A full 60-event submission runs to ~92KB at maximum field lengths, and Latvian diacritics
  // are multibyte, so the limit sits well clear of the largest submission the schema allows.
  app.use(express.json({limit:'512kb'}));
  const submit=async input=>{const e=store.submit(input);await renderEdition(e,store.dir,fetch,{link});return e;};
  app.post('/mcp',async(req,res)=>{
    const server=new McpServer({name:'riga-weekend',version:'0.1.0'});
    const result=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
    server.registerTool('submit_weekend_events',{description:'Submit source-verified Riga events for a Friday–Sunday weekend. Generates Instagram images and a WhatsApp digest. Saves for review; does not publish.',inputSchema:Submission.shape},async input=>result(await submit(input)));
    server.registerTool('list_weekend_editions',{description:'List prepared editions and delivery status.',inputSchema:{}},async()=>result(store.list().map(e=>({...e,jobs:store.jobs(e.id)}))));
    server.registerTool('approve_weekend_edition',{description:'Approve a reviewed edition and queue Instagram and WhatsApp publication. Requires explicit user authorization to publish. Live dispatch also requires server LIVE_PUBLISH=true.',inputSchema:{id:z.string().regex(/^[a-f0-9]{24}$/)},annotations:{readOnlyHint:false,destructiveHint:true}},async({id})=>result(store.approve(id)));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    await server.connect(transport); await transport.handleRequest(req,res,req.body);
  });
  app.all('/mcp',(_req,res)=>res.status(405).send('Use POST'));
  app.get('/api/status',(_req,res)=>res.json({live:env.LIVE_PUBLISH==='true',postizUrl:env.POSTIZ_PUBLIC_URL||null,ejuz:!!env.EJUZ_API_KEY,researchEnabled:env.RESEARCH_SCHEDULE_ENABLED==='true',weekend:weekendFor(),postizConfigured:!!env.POSTIZ_API_KEY,whatsappConfigured:!!env.WAHA_CHAT_ID,researchConfigured:!!env.OPENAI_API_KEY,renderConfigured:!!env.RENDER_URL,runs:store.db.prepare('SELECT * FROM runs ORDER BY weekend DESC').all()}));
  // Past weekends stay on disk but are not listed: the page stays small and the current weekend is
  // what you work on. ?scope=all brings them back when you need to look something up.
  app.get('/api/editions',(req,res)=>{
    const all=store.list(), show=req.query.scope==='all'?all:all.filter(e=>!weekendOver(e.weekend));
    res.set('X-Past-Editions',String(all.length-show.length));
    res.json(show.map(e=>({...e,jobs:store.jobs(e.id),whatsapp:whatsappText(e.data,e.selected),
    weekendDays:weekendDays(e.weekend),eventDates:e.data.events.map(eventDate),
    uploads:e.data.events.map((_,i)=>i).filter(i=>existsSync(uploadPath(store.dir,e.id,i))),
    organiserPhotos:e.data.events.map((_,i)=>i).filter(i=>existsSync(resolve(store.dir,'media',e.id,`photo-${i}.jpg`))),
    posts:postsFor(e.data,e.selected).map(p=>({date:p.date,part:p.part,parts:p.parts,name:postName(p),indexes:p.items.map(x=>x.index),caption:postCaptionPreview(e.data,p,link)})),
    shortLinks:e.demo?{}:Object.fromEntries(e.data.events.map((x,i)=>[i,linkSummary(store,x.sourceUrl,env)])),
    grids:gridsFor(e)})));
  });
  app.post('/api/editions',async(req,res)=>res.status(201).json(await submit(req.body)));
  // Story grids: one per day of the edition. You pick the cards (a suggestion is offered), build the
  // sheet here, and only a separate press renders the video, in the render service.
  const gridDate=(e,date)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!dayEvents(e,date).length) throw new Error(`No events on ${date} in this edition`);return date;};
  app.post('/api/editions/:id/grids/:date',async(req,res)=>{
    const e=store.get(req.params.id), date=gridDate(e,req.params.date), body=GridRequest.parse(req.body||{});
    const picks=checkPicks(e,date,body.events);
    if(store.grid(e.id,date)?.status==='rendering') throw new Error('This story is rendering; wait for it to finish before changing the grid');
    await buildGrid(store.dir,e,date,picks);
    await rm(gridFiles(store.dir,e.id,date).mp4,{force:true}); // the old video no longer matches the grid
    res.json(store.saveGrid(e.id,date,{picks,kicker:body.kicker,category:body.category,holdSeconds:body.holdSeconds,style:body.style}));
  });
  app.post('/api/editions/:id/grids/:date/postiz',(req,res)=>{
    const kind=z.enum(['reel','story']).parse(req.body?.kind);
    const e=store.get(req.params.id), date=gridDate(e,req.params.date);
    try {res.status(202).json(store.queueGridVideo(e.id,date,kind,req.body?.resend===true));}
    catch(err) {if(err.alreadySent) return res.status(409).json({error:err.message,alreadySent:true}); throw err;}
  });
  app.post('/api/editions/:id/grids/:date/render',async(req,res)=>{
    if(!env.RENDER_URL) throw new Error('The render service is not configured (RENDER_URL)');
    const e=store.get(req.params.id), date=gridDate(e,req.params.date);
    if(!existsSync(gridFiles(store.dir,e.id,date).png)) throw new Error('Build the grid first');
    const grid=store.startGridRender(e.id,date);
    const job=(async()=>{
      try {
        const r=await fetcher(`${env.RENDER_URL.replace(/\/$/,'')}/render`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15*60000),
          body:JSON.stringify({style:grid.style,edition:e.id,date,day:gridDay(date),...ticketText(date),count:grid.picks.length,kicker:grid.kicker,category:grid.category,holdSeconds:grid.holdSeconds})});
        const out=await r.json().catch(()=>({}));
        store.finishGridRender(e.id,date,r.ok?null:(out.error||`Render service returned HTTP ${r.status}`));
      } catch(err) {store.finishGridRender(e.id,date,err.name==='TimeoutError'?'Rendering took too long':`Render service unreachable: ${err.message}`);}
    })();
    app.locals.renders.add(job); job.finally(()=>app.locals.renders.delete(job));
    res.status(202).json(store.grid(e.id,date));
  });
  // Approving with a list of event indexes publishes only those; the covers, captions and
  // WhatsApp digest are redrawn to match before any job can run.
  app.post('/api/editions/:id/approve',async(req,res)=>{
    const picks=req.body?.events==null?null:z.array(z.number().int().min(0)).min(1).parse(req.body.events);
    const stories=req.body?.stories==null?[]:z.array(z.number().int().min(0)).parse(req.body.stories);
    // Check the selection first, make ej.uz links only for the events that will publish, and only then
    // approve: approval queues the hand-over to Postiz, so the captions must already have their links.
    const plan=store.planApproval(req.params.id,undefined,picks,stories);
    if(!plan.e.approved) await prepareLinks(store,plan.urls,env,fetcher,env.EJUZ_TEST_NO_WAIT?{sleep:async()=>{}}:{});
    const jobs=store.approve(req.params.id,undefined,picks,stories);
    await renderEdition(store.get(req.params.id),store.dir,fetch,{link});
    res.json(jobs);
  });
  // Mark the other weekend days an event is on; the cover and caption are redrawn to match.
  app.post('/api/editions/:id/events/:index/also-on',async(req,res)=>{
    const e=store.get(req.params.id), i=Number(req.params.index);
    if(!e.data.events[i]) throw new Error('That event is not in this edition');
    const dates=checkAlsoOn(e.weekend,e.data.events[i],z.array(z.string()).max(2).parse(req.body?.alsoOn??[]));
    const updated=store.updateEvent(e.id,i,{alsoOn:dates});
    await renderEdition(updated,store.dir,fetch,{link});
    res.json({alsoOn:dates});
  });
  // The WhatsApp digest is sent only when you ask, never on a schedule.
  app.post('/api/editions/:id/whatsapp',(req,res)=>{
    try {res.status(202).json(store.queueWhatsApp(req.params.id,req.body?.resend===true));}
    catch(err) {if(err.alreadySent) return res.status(409).json({error:err.message,alreadySent:true}); throw err;}
  });
  // Your own photo for an event. It replaces whatever the organiser page offered, on the feed
  // slide and the story, and is the only way a picture from anywhere else reaches a card.
  const eventIndex=(e,raw)=>{const i=Number(raw);if(!Number.isInteger(i)||i<0||i>=e.data.events.length) throw new Error('That event is not in this edition');return i;};
  app.post('/api/editions/:id/events/:index/photo',express.raw({type:['image/*','application/octet-stream'],limit:'15mb'}),async(req,res)=>{
    const e=store.get(req.params.id), i=eventIndex(e,req.params.index);
    if(e.approved) throw new Error('This edition is approved, so its images are already in Postiz. Change the photo there');
    if(!Buffer.isBuffer(req.body)||!req.body.length) throw new Error('Choose an image to upload');
    let meta; try {meta=await sharp(req.body).metadata();} catch {throw new Error('That file is not an image this server can read. Export it as JPEG or PNG and try again');}
    if(Math.min(meta.width||0,meta.height||0)<400) throw new Error(`That image is too small: it needs at least 400 pixels on its shorter side, and this one has ${Math.min(meta.width||0,meta.height||0)}`);
    const file=uploadPath(store.dir,e.id,i); await mkdir(dirname(file),{recursive:true});
    // Re-encoding applies the phone's rotation and drops every piece of metadata, including GPS location.
    await sharp(req.body).rotate().resize(2160,2160,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toFile(file);
    await dropTiles(store.dir,e.id,i); // the grid tiles are redrawn from the new photo
    await renderEdition(e,store.dir,fetch,{only:i,link});
    res.status(201).json({ok:true});
  });
  app.delete('/api/editions/:id/events/:index/photo',async(req,res)=>{
    const e=store.get(req.params.id), i=eventIndex(e,req.params.index);
    if(e.approved) throw new Error('This edition is approved, so its images are already in Postiz. Change the photo there');
    await rm(uploadPath(store.dir,e.id,i),{force:true});
    await dropTiles(store.dir,e.id,i); // the grid tiles are redrawn from the new photo
    await renderEdition(e,store.dir,fetch,{only:i,link});
    res.json({ok:true});
  });
  let researching=false;
  app.post('/api/research',async(req,res)=>{
    if(researching) return res.status(409).json({error:'Research is already running'});
    researching=true;try {res.json(await researchInto(store,req.body.weekend||weekendFor(),env));} finally {researching=false;}
  });
  app.post('/api/jobs/:id/resolve',(req,res)=>{const action=z.enum(['retry','confirm_sent']).parse(req.body.action);store.resolve(Number(req.params.id),action);res.json({ok:true});});
  app.get('/api/integrations',async(_req,res)=>{
    if(!env.POSTIZ_API_URL||!env.POSTIZ_API_KEY) throw new Error('Configure Postiz first');
    res.json(await request(`${env.POSTIZ_API_URL.replace(/\/$/,'')}/integrations`,{headers:{Authorization:env.POSTIZ_API_KEY}}));
  });
  // Small copies for the review page; the full image is one click away.
  app.get('/thumb/:id/:file',async(req,res,next)=>{
    try {res.type('jpeg').sendFile(await ensureThumb(store.dir,req.params.id,req.params.file));}
    catch(err) {if(err.code==='ENOENT') return next(); throw err;}
  });
  app.use('/media',express.static(resolve(store.dir,'media'),{dotfiles:'deny'}));
  app.use(express.static(resolve('public')));
  app.use((err,_req,res,_next)=>{console.error(err.message);if(err.type==='entity.too.large') return res.status(413).json({error:'That file is too large; keep uploads under 15 MB'});res.status(400).json({error:err instanceof z.ZodError?err.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; '):err.message});});
  return app;
}