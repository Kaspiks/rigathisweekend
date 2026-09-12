import { DateTime } from 'luxon';
import { Store } from './store.js';
import { weekendFor, ZONE } from './domain.js';
import { renderEdition } from './render.js';
import { researchInto, scheduledResearch } from './research.js';
import { runJobs } from './providers.js';
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
  while(!stopping) {
    try {await runJobs(store);await scheduledResearch(store);}catch(err){console.error('Worker error:',err.message);}
    await new Promise(r=>setTimeout(r,15000));
  }
  store.close();
} else {store.close();throw new Error('Usage: cli.js demo | research [Friday YYYY-MM-DD] | worker');}
