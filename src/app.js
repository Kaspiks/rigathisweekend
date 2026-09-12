import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Submission, whatsappText, caption, weekendFor } from './domain.js';
import { renderEdition } from './render.js';
import { researchInto } from './research.js';
import { request } from './providers.js';

function equal(a,b) {const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function createApp(store,env=process.env) {
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<24) throw new Error('ADMIN_TOKEN must be at least 24 characters');
  const app=express(); app.disable('x-powered-by');
  app.get('/healthz',(_req,res)=>res.json({ok:true}));
  app.use((req,res,next)=>{
    const auth=req.headers.authorization||'';
    const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
    const basic=auth.startsWith('Basic ')?Buffer.from(auth.slice(6),'base64').toString():'';
    const password=basic.slice(basic.indexOf(':')+1);
    if(!equal(bearer,env.ADMIN_TOKEN)&&!(basic.startsWith('admin:')&&equal(password,env.ADMIN_TOKEN))) {
      res.set('WWW-Authenticate','Basic realm="Riga Weekend"');return res.status(401).send('Authentication required');
    }
    if(req.headers.origin && req.headers.origin!==(env.APP_ORIGIN||'http://localhost:3100')) return res.status(403).send('Origin not allowed');
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Security-Policy',"default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({limit:'100kb'}));
  const submit=async input=>{const e=store.submit(input);await renderEdition(e,store.dir);return e;};
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
  app.get('/api/status',(_req,res)=>res.json({live:env.LIVE_PUBLISH==='true',researchEnabled:env.RESEARCH_SCHEDULE_ENABLED==='true',weekend:weekendFor(),postizConfigured:!!env.POSTIZ_API_KEY,whatsappConfigured:!!env.WAHA_CHAT_ID,researchConfigured:!!env.OPENAI_API_KEY,runs:store.db.prepare('SELECT * FROM runs ORDER BY weekend DESC').all()}));
  app.get('/api/editions',(_req,res)=>res.json(store.list().map(e=>({...e,jobs:store.jobs(e.id),caption:caption(e.data),whatsapp:whatsappText(e.data)}))));
  app.post('/api/editions',async(req,res)=>res.status(201).json(await submit(req.body)));
  app.post('/api/editions/:id/approve',(req,res)=>res.json(store.approve(req.params.id)));
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
  app.use('/media',express.static(resolve(store.dir,'media'),{dotfiles:'deny'}));
  app.use(express.static(resolve('public')));
  app.use((err,_req,res,_next)=>{console.error(err.message);res.status(400).json({error:err instanceof z.ZodError?err.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; '):err.message});});
  return app;
}
