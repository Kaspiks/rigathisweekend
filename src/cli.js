import { DateTime } from 'luxon';
import { Store } from './store.js';
import { captionLinker, refreshClicks, prepareLinks } from './shortlinks.js';
import { weekendFor, ZONE } from './domain.js';
import { renderEdition } from './render.js';
import { researchInto, scheduledResearch } from './research.js';
import { runJobs, listIntegrations, listGroups, checkConfig } from './providers.js';
const store=new Store(process.env.DATA_DIR||'data');
const command=process.argv[2];
if(command==='demo') {
  const friday=DateTime.fromISO(weekendFor(),{zone:ZONE});
  const e=store.submit({weekend:friday.toISODate(),events:[
    {title:'An evening by the Daugava',venue:'Demo venue · Riga',price:'Demo · free entry',summary:'A sample event showing how your weekly recommendations will look. This is not a real event listing.',startsAt:friday.plus({days:1}).set({hour:18}).toISO(),sourceUrl:'https://example.com/demo-river'},
    {title:'Sunday design & makers market',venue:'Demo market · Riga',price:'Demo · €5',summary:'A second fictional listing, with space for local makers, food and something new to discover.',startsAt:friday.plus({days:2}).set({hour:11}).toISO(),sourceUrl:'https://example.com/demo-market'},
  ]},true);
  await renderEdition(e,store.dir);console.log(`Demo ready: ${e.id}. Open the dashboard to review.`);store.close();
} else if(command==='research') {
  try{console.log((await researchInto(store,process.argv[3]||weekendFor())).id);}finally{store.close();}
} else if(command==='worker') {
  // Exactly one worker replica: interrupted sends need manual reconciliation.
  store.recover();
  store.db.prepare("UPDATE runs SET status='failed',detail='Worker interrupted; rerun research manually' WHERE status='running'").run();
  let stopping=false;process.on('SIGTERM',()=>{stopping=true;});
  let clicksAt=0;
  while(!stopping) {
    try {await runJobs(store);await scheduledResearch(store);}catch(err){console.error('Worker error:',err.message);}
    // ej.uz click totals only when explicitly enabled, every six hours, paced. The app's own clicks count as they happen.
    if(process.env.EJUZ_CLICK_REFRESH==='true'&&clicksAt&&Date.now()-clicksAt>6*3600000) {clicksAt=Date.now(); try {await refreshClicks(store,process.env,fetch,{pauseMs:1500});} catch(err) {console.error('Click refresh:',err.message);}}
    if(!clicksAt) clicksAt=Date.now(); // never on start-up, so a restart or deploy sends nothing to ej.uz
    await new Promise(r=>setTimeout(r,15000));
  }
  store.close();
} else if(command==='render') {
  // Re-draw an existing edition after a design change; never re-sends anything.
  try {
    const list=process.argv[3]?[store.get(process.argv[3])]:store.list();
    for(const e of list) {await renderEdition(e,store.dir,fetch,{link:captionLinker(store,process.env)});console.log(`rendered ${e.id} (${e.weekend}${e.demo?', demo':''})`);}
  } finally {store.close();}
} else if(command==='links') {
  // Fill in ej.uz links for approved editions, for the events they publish. Drafts are skipped, because
  // ej.uz asks that no link is made for something that is never published.
  try {
    const target=process.argv[3], now=DateTime.now();
    const list=store.list().filter(e=>!e.demo&&e.approved&&(target?e.id.startsWith(target):DateTime.fromISO(e.weekend,{zone:ZONE}).plus({days:3})>now));
    if(!list.length) throw new Error('No approved edition to fill in. Links for a draft are made when you approve it.');
    for(const e of list) {
      const indexes=e.selected??e.data.events.map((_,i)=>i);
      const r=await prepareLinks(store,indexes.map(i=>e.data.events[i].sourceUrl),process.env,fetch);
      await renderEdition(e,store.dir,fetch,{link:captionLinker(store,process.env)});
      console.log(`${e.id} (${e.weekend}): ${r.created} ej.uz links created, ${r.fellBack} using the app's own link${r.stopped?` (stopped: ${r.stopped})`:''}`);
    }
  } finally {store.close();}
} else if(command==='integrations') {
  try{for(const i of await listIntegrations()) console.log(`${i.id}\t${i.provider}\t${i.name}${i.disabled?'\t(disabled)':''}`);}catch(err){console.error(err.message);process.exitCode=1;}finally{store.close();}
} else if(command==='groups') {
  try{for(const g of await listGroups()) console.log(`${g.id}\t${g.name}`);}catch(err){console.error(err.message);process.exitCode=1;}finally{store.close();}
} else if(command==='check') {
  store.close();
  const report=checkConfig(); let missing=0;
  for(const r of report){if(!r.ok)missing++;console.log(`${r.ok?'ok     ':'MISSING'} ${r.area.padEnd(9)} ${r.key.padEnd(28)} ${r.hint}`);}
  console.log(missing?`\n${missing} item(s) still need configuration.`:'\nConfiguration complete.');
  process.exitCode=missing?1:0;
} else if(command==='user') {
  // Logins for other people, who share this workspace with the owner. The password is printed once, here,
  // and only its hash is kept; to replace one, remove the user and add them again.
  try {
    const [action,name]=process.argv.slice(3);
    if(action==='add') {
      const u=store.addUser(name);
      console.log(`Name:     ${u.name}\nPassword: ${u.password}\n\nThis password is not shown again. It opens the dashboard, and the sign-in page ChatGPT shows when the plugin is connected.`);
    } else if(action==='remove') {
      if(!store.removeUser(name)) throw new Error(`No user called '${name||''}'`);
      console.log(`Removed ${name}. Their dashboard login and their ChatGPT connection no longer work.`);
    } else if(action==='list') {
      const list=store.users();
      for(const u of list) console.log(`${u.name}\tadded ${u.created.slice(0,10)}`);
      if(!list.length) console.log('No users besides admin.');
    } else throw new Error('Usage: cli.js user add <name> | remove <name> | list');
  } catch(err){console.error(err.message);process.exitCode=1;} finally{store.close();}
} else {store.close();throw new Error('Usage: cli.js demo | research [Friday YYYY-MM-DD] | worker | check | render [id] | links [id] | integrations | groups | user add|remove|list [name]');}
