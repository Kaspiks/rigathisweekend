import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, validateSubmission, plannedJobs, eventsByDay, validatePublication } from './domain.js';
import { GRID_KINDS } from './providers.js';
import { FAMILY_KEYS, TONES } from './themes.js';
import { DateTime } from 'luxon';

export class Store {
  constructor(dir) {
    mkdirSync(dir, {recursive:true}); this.dir = dir;
    this.db = new DatabaseSync(join(dir,'riga.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY, weekend TEXT NOT NULL, data TEXT NOT NULL, demo INTEGER NOT NULL, approved INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS day_locks(date TEXT PRIMARY KEY, edition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ejuz_calls(at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS short_links(code TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, created TEXT NOT NULL, clicks INTEGER NOT NULL DEFAULT 0, last_click TEXT);
      CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, edition TEXT NOT NULL, target TEXT NOT NULL, due TEXT NOT NULL, status TEXT DEFAULT 'queued', result TEXT, UNIQUE(edition,target));
      CREATE TABLE IF NOT EXISTS runs(weekend TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS grids(edition TEXT NOT NULL, date TEXT NOT NULL, picks TEXT NOT NULL, kicker TEXT NOT NULL, category TEXT NOT NULL, hold_seconds REAL NOT NULL DEFAULT 6, status TEXT NOT NULL DEFAULT 'built', error TEXT, updated TEXT NOT NULL, PRIMARY KEY(edition,date));
      CREATE TABLE IF NOT EXISTS footage(id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, error TEXT, progress REAL, info TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS footage_edits(footage TEXT NOT NULL, version INTEGER NOT NULL, spec TEXT NOT NULL, note TEXT, created TEXT NOT NULL, PRIMARY KEY(footage,version));
      CREATE TABLE IF NOT EXISTS graphics(name TEXT PRIMARY KEY, def TEXT NOT NULL, note TEXT, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS guide_notes(title TEXT PRIMARY KEY, text TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS upload_links(token TEXT PRIMARY KEY, footage TEXT NOT NULL, name TEXT NOT NULL, expires TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open');
      CREATE TABLE IF NOT EXISTS footage_renders(id INTEGER PRIMARY KEY, footage TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT, result TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS animations(id TEXT PRIMARY KEY, name TEXT NOT NULL, composition TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', hold_seconds REAL NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'new', error TEXT, postiz TEXT, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_cache(hash TEXT PRIMARY KEY, kind TEXT NOT NULL, file TEXT NOT NULL, seconds REAL, meta TEXT, created TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS voice_spend(id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, credits INTEGER NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS voice_styles(style TEXT PRIMARY KEY, voice TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    // Instagram posts are per day, so the approval rule moved from one edition per weekend
    // to one per weekend day. Editions approved under the old rule keep their days.
    this.db.exec('DROP INDEX IF EXISTS one_approved_weekend');
    try {this.db.exec('ALTER TABLE editions ADD COLUMN selected TEXT');} catch {} // added with per-event selection
    try {this.db.exec('ALTER TABLE editions ADD COLUMN stories TEXT');} catch {} // added with opt-in stories
    try {this.db.exec('ALTER TABLE editions ADD COLUMN themes TEXT');} catch {} // colours: {palette, days:{date:tone}}
    try {this.db.exec('ALTER TABLE jobs ADD COLUMN publish_at TEXT');} catch {} // when Postiz should publish it
    try {this.db.exec('ALTER TABLE jobs ADD COLUMN finished_at TEXT');} catch {}
    try {this.db.exec("ALTER TABLE grids ADD COLUMN style TEXT NOT NULL DEFAULT 'ticket'");} catch {} // added with the ticket opener
    try {this.db.exec("ALTER TABLE upload_links ADD COLUMN kind TEXT NOT NULL DEFAULT 'picture'");} catch {} // picture, model, depth or download
    for(const column of ['ejuz TEXT','ejuz_error TEXT','ejuz_tried TEXT','ejuz_clicks INTEGER NOT NULL DEFAULT 0','ejuz_display TEXT'])
      try {this.db.exec(`ALTER TABLE short_links ADD COLUMN ${column}`);} catch {} // ej.uz links alongside the app's own
    if(!this.db.prepare('SELECT count(*) n FROM day_locks').get().n)
      for(const row of this.db.prepare('SELECT id,data FROM editions WHERE approved=1 AND demo=0').all())
        if(!JSON.parse(row.data).headline) for(const day of eventsByDay(JSON.parse(row.data)))
          this.db.prepare('INSERT OR IGNORE INTO day_locks(date,edition) VALUES(?,?)').run(day.date,row.id);
  }
  submit(input, demo=false) {
    const data=validateSubmission(input); const id=digest({data,demo});
    this.db.prepare('INSERT OR IGNORE INTO editions(id,weekend,data,demo) VALUES(?,?,?,?)').run(id,data.weekend,JSON.stringify(data),+demo);
    return this.get(id);
  }
  get(id) { const row=this.db.prepare('SELECT * FROM editions WHERE id=?').get(id); if(!row) throw new Error('Edition not found'); return {...row,data:JSON.parse(row.data),selected:row.selected?JSON.parse(row.selected):null,stories:row.stories?JSON.parse(row.stories):[],themes:colours(row.themes)}; }
  list() { return this.db.prepare('SELECT id FROM editions ORDER BY created DESC, rowid DESC').all().map(r=>this.get(r.id)); }
  jobs(id) { return this.db.prepare('SELECT * FROM jobs WHERE edition=? ORDER BY id').all(id); }
  // `selected` lists the events to publish (omit for all); `stories` lists which of those also get a story draft.
  // Every check approval makes, without writing anything. Used before creating short links, so a
  // selection that would be refused never produces links nobody publishes.
  planApproval(id, now=DateTime.now(), selected=null, stories=[]) {
    const e=this.get(id);
    if(e.demo) throw new Error('Demo editions cannot be published');
    if(DateTime.fromISO(e.weekend,{zone:'Europe/Riga'}).plus({days:3}) <= now) throw new Error('Weekend has ended');
    let picks=null;
    if(selected!=null) {
      picks=[...new Set(selected.map(Number))].sort((a,b)=>a-b);
      if(picks.some(i=>!Number.isInteger(i)||i<0||i>=e.data.events.length)) throw new Error('Selection refers to an event that is not in this edition');
    }
    const pool=new Set(picks??e.data.events.map((_,i)=>i));
    const storyPicks=[...new Set((stories||[]).map(Number))].sort((a,b)=>a-b);
    if(storyPicks.some(i=>!pool.has(i))) throw new Error('A story was ticked for an event that is not being published');
    const publishing=validatePublication(e.data,picks);
    // Only the events you chose have to still be in the future; skipping a started one is the point of selecting.
    if(publishing.some(d=>d.items.some(x=>Date.parse(x.event.startsAt)<=now.toMillis()))) throw new Error('Selection contains events that already started; deselect them or submit an updated edition');
    // A special post (one with a headline) sits alongside the day's regular post, so it neither needs nor takes the day.
    if(!e.data.headline) for(const date of new Set(publishing.map(p=>p.date))) {
      const owner=this.db.prepare('SELECT edition FROM day_locks WHERE date=?').get(date)?.edition;
      if(owner&&owner!==id) throw new Error(`Another approved edition already covers ${date}; submit an updated edition for the remaining days`);
    }
    return {e,picks,storyPicks,publishing,urls:[...pool].map(i=>e.data.events[i].sourceUrl)};
  }
  approve(id, now=DateTime.now(), selected=null, stories=[]) {
    if(this.get(id).approved) return this.jobs(id); // already queued; a second call must not change what was published
    const {e,picks,storyPicks,publishing}=this.planApproval(id,now,selected,stories);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE editions SET selected=?, stories=? WHERE id=?').run(picks?JSON.stringify(picks):null,JSON.stringify(storyPicks),id);
      // One approved edition per weekend day: a later edition may cover a day nothing has claimed,
      // but two editions can never publish the same day twice.
      if(!e.data.headline) for(const day of [...new Map(publishing.map(p=>[p.date,p])).values()]) {
        this.db.prepare('INSERT OR IGNORE INTO day_locks(date,edition) VALUES(?,?)').run(day.date,id);
        if(this.db.prepare('SELECT edition FROM day_locks WHERE date=?').get(day.date).edition!==id)
          throw new Error(`Another approved edition already covers ${day.date}; submit an updated edition for the remaining days`);
      }
      this.db.prepare('UPDATE editions SET approved=1 WHERE id=?').run(id);
      // Every Instagram item is handed to Postiz at once (due now), carrying the time Postiz should publish it.
      const handover=now.toUTC().toISO();
      for(const j of plannedJobs(e.data,now,picks,storyPicks)) this.db.prepare('INSERT OR IGNORE INTO jobs(edition,target,due,publish_at) VALUES(?,?,?,?)').run(id,j.target,handover,j.due);
      this.db.exec('COMMIT');
    } catch(err) {this.db.exec('ROLLBACK');throw err;}
    return this.jobs(id);
  }
  claim(now=new Date().toISOString()) {
    return this.db.prepare("UPDATE jobs SET status='processing' WHERE id=(SELECT id FROM jobs WHERE status='queued' AND due<=? ORDER BY due,id LIMIT 1) AND status='queued' RETURNING *").get(now);
  }
  finish(id,status,result) {this.db.prepare('UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?').run(status,JSON.stringify(result),new Date().toISOString(),id);}
  requeue(id,minutes,note) {this.db.prepare("UPDATE jobs SET status='queued',due=?,result=? WHERE id=?").run(new Date(Date.now()+minutes*60000).toISOString(),JSON.stringify({note}),id);}
  // The WhatsApp digest goes out only when you press its button, using the events chosen at approval.
  // Sending again is allowed, but only when asked for explicitly.
  queueWhatsApp(id, resend=false, now=new Date()) {
    const e=this.get(id);
    if(e.demo) throw new Error('Demo editions cannot be sent');
    if(!e.approved) throw new Error('Approve the edition first: the digest lists the events you chose');
    const previous=this.db.prepare("SELECT * FROM jobs WHERE edition=? AND (target='whatsapp' OR target LIKE 'whatsapp#%') ORDER BY id DESC").all(id);
    const last=previous[0];
    if(last&&['queued','processing'].includes(last.status)) return last;
    if(last&&['uncertain','blocked'].includes(last.status)) throw new Error('The last WhatsApp send needs checking first: use Retry or Confirm on it below');
    if(last?.status==='sent'&&!resend) {const err=new Error(`The digest was already sent${last.finished_at?` at ${new Date(last.finished_at).toLocaleString('en-GB',{timeZone:'Europe/Riga'})}`:''}`);err.alreadySent=true;throw err;}
    const target=previous.length?`whatsapp#${previous.length+1}`:'whatsapp';
    this.db.prepare('INSERT INTO jobs(edition,target,due,publish_at) VALUES(?,?,?,?)').run(id,target,now.toISOString(),now.toISOString());
    return this.db.prepare('SELECT * FROM jobs WHERE edition=? AND target=?').get(id,target);
  }
  // A rendered story video, handed to Postiz as a draft when you press its button. One job per kind
  // per day; sending again is allowed but has to be asked for, like the WhatsApp digest.
  queueGridVideo(edition,date,kind,resend=false,now=new Date()) {
    const e=this.get(edition);
    if(e.demo) throw new Error('Demo editions cannot be published');
    const grid=this.grid(edition,date);
    if(!grid) throw new Error('Build the grid first');
    if(grid.status!=='ready') throw new Error('Render the story video first');
    const prefix=GRID_KINDS[kind]; if(!prefix) throw new Error(`Unknown story kind ${kind}`);
    const previous=this.db.prepare('SELECT * FROM jobs WHERE edition=? AND (target=? OR target LIKE ?) ORDER BY id DESC').all(edition,`${prefix}:${date}`,`${prefix}:${date}#%`);
    const last=previous[0];
    if(last&&['queued','processing'].includes(last.status)) return last;
    if(last&&['uncertain','blocked'].includes(last.status)) throw new Error('The last send of this video needs checking first: use Retry or Confirm on it below');
    if(last?.status==='sent'&&!resend) {const err=new Error('This video is already in Postiz as a draft');err.alreadySent=true;throw err;}
    const target=previous.length?`${prefix}:${date}#${previous.length+1}`:`${prefix}:${date}`;
    this.db.prepare('INSERT INTO jobs(edition,target,due,publish_at) VALUES(?,?,?,?)').run(edition,target,now.toISOString(),now.toISOString());
    return this.db.prepare('SELECT * FROM jobs WHERE edition=? AND target=?').get(edition,target);
  }
  recover() {this.db.prepare("UPDATE jobs SET status='uncertain',result=? WHERE status='processing'").run(JSON.stringify({error:'Worker interrupted. Check provider before retrying.'}));}
  resolve(id,action) {
    const status=action==='retry'?'queued':'sent';
    const r=this.db.prepare("UPDATE jobs SET status=?,result=NULL WHERE id=? AND status IN ('uncertain','blocked')").run(status,id);
    if(!r.changes) throw new Error('Only blocked or uncertain jobs can be resolved');
  }
  // One short code per organiser URL, reused across editions. Codes avoid look-alike characters
  // (0/o, 1/l/i) and always contain a digit, so they can never collide with a route like /media.
  shortCode(url) {
    const known=this.db.prepare('SELECT code FROM short_links WHERE url=?').get(url); if(known) return known.code;
    const letters='abcdefghjkmnpqrstuvwxyz', digits='23456789', all=letters+digits;
    for(let attempt=0;attempt<30;attempt++) {
      const chars=Array.from({length:5},()=>all[randomInt(all.length)]);
      chars[randomInt(5)]=digits[randomInt(digits.length)];
      const code=chars.join('');
      if(this.db.prepare('INSERT OR IGNORE INTO short_links(code,url,created) VALUES(?,?,?)').run(code,url,new Date().toISOString()).changes) return code;
      const raced=this.db.prepare('SELECT code FROM short_links WHERE url=?').get(url); if(raced) return raced.code;
    }
    throw new Error('Could not allocate a short link');
  }
  linker(base) {return url=>`${base}/${this.shortCode(url)}`;}
  follow(code) {
    const row=this.db.prepare('SELECT url FROM short_links WHERE code=?').get(code); if(!row) return null;
    this.db.prepare('UPDATE short_links SET clicks=clicks+1,last_click=? WHERE code=?').run(new Date().toISOString(),code);
    return row.url;
  }
  clicks(url) {return this.db.prepare('SELECT code,clicks,last_click FROM short_links WHERE url=?').get(url)||null;}
  linkRow(url) {return this.db.prepare('SELECT * FROM short_links WHERE url=?').get(url)||null;}
  setEjuz(url,smurl,error,display=null) {this.db.prepare('UPDATE short_links SET ejuz=coalesce(?,ejuz), ejuz_display=coalesce(?,ejuz_display), ejuz_error=?, ejuz_tried=? WHERE url=?').run(smurl,display,error,new Date().toISOString(),url);}
  clearEjuz(url) {this.db.prepare('UPDATE short_links SET ejuz=NULL, ejuz_display=NULL, ejuz_error=NULL, ejuz_tried=NULL, ejuz_clicks=0 WHERE url=?').run(url);}
  // Every link-creation request to ej.uz, so the limits its developer set can be respected across runs.
  logEjuzCall(at=new Date()) {this.db.prepare('INSERT INTO ejuz_calls(at) VALUES(?)').run(at.toISOString());this.db.prepare('DELETE FROM ejuz_calls WHERE at<?').run(new Date(at-2*86400000).toISOString());}
  ejuzCallsSince(ms,now=Date.now()) {return this.db.prepare('SELECT count(*) n FROM ejuz_calls WHERE at>=?').get(new Date(now-ms).toISOString()).n;}
  setEjuzClicks(url,total) {this.db.prepare('UPDATE short_links SET ejuz_clicks=? WHERE url=?').run(total,url);}
  // Correct a single field of a candidate event. Approved editions are already in Postiz, so they are left alone.
  updateEvent(id,index,fields) {
    const e=this.get(id);
    if(e.approved) throw new Error('This edition is approved and already in Postiz, so it can no longer be changed here');
    if(!Number.isInteger(index)||!e.data.events[index]) throw new Error('That event is not in this edition');
    for(const [k,v] of Object.entries(fields)) {if(v==null||(Array.isArray(v)&&!v.length)) delete e.data.events[index][k]; else e.data.events[index][k]=v;}
    this.db.prepare('UPDATE editions SET data=? WHERE id=?').run(JSON.stringify(e.data),id);
    return this.get(id);
  }
  // Colours: the week's family for the whole edition, and a tone of it per day. Images go to Postiz at
  // approval, so the colours are fixed from then on.
  #colourable(id) {
    const e=this.get(id);
    if(e.approved) throw new Error('This edition is approved and its images are already in Postiz, so its colours can no longer be changed here');
    return e;
  }
  setPalette(id,palette) {
    const e=this.#colourable(id);
    if(!FAMILY_KEYS.includes(palette)) throw new Error(`Unknown colour family ${palette}`);
    this.db.prepare('UPDATE editions SET themes=? WHERE id=?').run(JSON.stringify({...e.themes,palette}),id);
    return this.get(id);
  }
  setTone(id,date,tone) {
    const e=this.#colourable(id);
    if(!TONES[tone]) throw new Error(`Unknown tone ${tone}`);
    if(!eventsByDay(e.data).some(d=>d.date===date)) throw new Error(`No events on ${date} in this edition`);
    this.db.prepare('UPDATE editions SET themes=? WHERE id=?').run(JSON.stringify({...e.themes,days:{...e.themes.days,[date]:tone}}),id);
    return this.get(id);
  }
  // Story grids, one per edition day: the cards you picked, the envelope label, and the render state.
  grid(edition,date) {
    const row=this.db.prepare('SELECT * FROM grids WHERE edition=? AND date=?').get(edition,date);
    return row?{date:row.date,picks:JSON.parse(row.picks),kicker:row.kicker,category:row.category,holdSeconds:row.hold_seconds,style:row.style,status:row.status,error:row.error,updated:row.updated}:null;
  }
  // Every event that is already in a grid somebody built, keyed by its organiser link so the same event is
  // recognised from one weekend to the next (a run of an exhibition is submitted again each week). Used to
  // grey it out in the pickers: a story video should not go out twice with the same card in it.
  gridUsage() {
    const used=new Map();
    for(const row of this.db.prepare('SELECT edition,date,picks FROM grids').all()) {
      const e=this.db.prepare('SELECT weekend,data FROM editions WHERE id=?').get(row.edition);
      if(!e) continue;
      const events=JSON.parse(e.data).events;
      for(const i of JSON.parse(row.picks)) {
        const url=events[i]?.sourceUrl; if(!url) continue;
        if(!used.has(url)) used.set(url,[]);
        used.get(url).push({edition:row.edition,date:row.date,weekend:e.weekend});
      }
    }
    return used;
  }
  grids(edition) {return this.db.prepare('SELECT date FROM grids WHERE edition=? ORDER BY date').all(edition).map(r=>this.grid(edition,r.date));}
  saveGrid(edition,date,{picks,kicker,category,holdSeconds,style='ticket'}) {
    if(this.grid(edition,date)?.status==='rendering') throw new Error('This story is rendering; wait for it to finish before changing the grid');
    this.db.prepare(`INSERT INTO grids(edition,date,picks,kicker,category,hold_seconds,style,status,error,updated) VALUES(?,?,?,?,?,?,?,'built',NULL,?)
      ON CONFLICT(edition,date) DO UPDATE SET picks=excluded.picks,kicker=excluded.kicker,category=excluded.category,hold_seconds=excluded.hold_seconds,style=excluded.style,status='built',error=NULL,updated=excluded.updated`)
      .run(edition,date,JSON.stringify(picks),kicker,category,holdSeconds,style,new Date().toISOString());
    return this.grid(edition,date);
  }
  // Claims the render atomically, so two clicks cannot start two renders of the same story.
  startGridRender(edition,date) {
    const r=this.db.prepare("UPDATE grids SET status='rendering',error=NULL,updated=? WHERE edition=? AND date=? AND status!='rendering'").run(new Date().toISOString(),edition,date);
    if(!r.changes) throw new Error(this.grid(edition,date)?'This story is already rendering':'Build the grid first');
    return this.grid(edition,date);
  }
  // The app runs renders, so only its start-up clears them: a render cut short by a restart never reports back.
  recoverGrids() {this.db.prepare("UPDATE grids SET status='failed', error='Rendering was interrupted; render again' WHERE status='rendering'").run();}
  finishGridRender(edition,date,error=null) {this.db.prepare('UPDATE grids SET status=?,error=?,updated=? WHERE edition=? AND date=?').run(error?'failed':'ready',error,new Date().toISOString(),edition,date);}
  // Footage for animated edits. A clip goes uploading → processing (the 30 fps working copy) → ready, or failed.
  addFootage(id,name) {const now=new Date().toISOString();this.db.prepare("INSERT INTO footage(id,name,status,created,updated) VALUES(?,?,'uploading',?,?)").run(id,name,now,now);return this.footage(id);}
  footage(id) {
    const row=this.db.prepare('SELECT * FROM footage WHERE id=?').get(id); if(!row) throw Object.assign(new Error('Footage not found'),{httpStatus:404});
    return {...row,info:row.info?JSON.parse(row.info):null};
  }
  footageList() {return this.db.prepare('SELECT id FROM footage ORDER BY created DESC, rowid DESC').all().map(r=>this.footage(r.id));}
  updateFootage(id,fields) {
    const allowed=['name','status','error','progress','info'], keys=Object.keys(fields).filter(k=>allowed.includes(k));
    const values=keys.map(k=>k==='info'&&fields[k]!=null?JSON.stringify(fields[k]):fields[k]);
    this.db.prepare(`UPDATE footage SET ${keys.map(k=>`${k}=?`).join(',')}${keys.length?',':''}updated=? WHERE id=?`).run(...values,new Date().toISOString(),id);
    return this.footage(id);
  }
  deleteFootage(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {for(const t of ['footage_renders','footage_edits']) this.db.prepare(`DELETE FROM ${t} WHERE footage=?`).run(id);this.db.prepare('DELETE FROM footage WHERE id=?').run(id);this.db.exec('COMMIT');}
    catch(err) {this.db.exec('ROLLBACK');throw err;}
  }
  // Every save is a new version, so an edit can be compared with, or rolled back to, an earlier one.
  saveEdit(footage,spec,note=null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const version=(this.db.prepare('SELECT max(version) v FROM footage_edits WHERE footage=?').get(footage).v||0)+1;
      this.db.prepare('INSERT INTO footage_edits(footage,version,spec,note,created) VALUES(?,?,?,?,?)').run(footage,version,JSON.stringify(spec),note,new Date().toISOString());
      this.db.exec('COMMIT');
      return this.edit(footage,version);
    } catch(err) {this.db.exec('ROLLBACK');throw err;}
  }
  edit(footage,version=null) {
    const row=version==null?this.db.prepare('SELECT * FROM footage_edits WHERE footage=? ORDER BY version DESC LIMIT 1').get(footage):this.db.prepare('SELECT * FROM footage_edits WHERE footage=? AND version=?').get(footage,version);
    if(!row) throw Object.assign(new Error(version==null?'This footage has no edit yet; save one first':`Edit version ${version} does not exist`),{httpStatus:404});
    return {version:row.version,spec:JSON.parse(row.spec),note:row.note,created:row.created};
  }
  edits(footage) {return this.db.prepare('SELECT version,note,created FROM footage_edits WHERE footage=? ORDER BY version').all(footage);}
  // Renders of an edit, run one at a time by the app: stills for a quick look, or the video itself.
  queueFootageRender(footage,version,kind,request) {
    const now=new Date().toISOString();
    const {lastInsertRowid}=this.db.prepare('INSERT INTO footage_renders(footage,version,kind,request,created,updated) VALUES(?,?,?,?,?,?)').run(footage,version,kind,JSON.stringify(request),now,now);
    return this.footageRender(Number(lastInsertRowid));
  }
  footageRender(id) {
    const row=this.db.prepare('SELECT * FROM footage_renders WHERE id=?').get(id); if(!row) throw Object.assign(new Error('Render not found'),{httpStatus:404});
    return {...row,request:JSON.parse(row.request),result:row.result?JSON.parse(row.result):null};
  }
  footageRenders(footage) {return this.db.prepare('SELECT id FROM footage_renders WHERE footage=? ORDER BY id DESC').all(footage).map(r=>this.footageRender(r.id));}
  // Every render ever made, newest first, whichever clip or canvas it belongs to: the history page.
  allRenders(limit=200) {return this.db.prepare('SELECT id FROM footage_renders ORDER BY id DESC LIMIT ?').all(limit).map(r=>this.footageRender(r.id));}
  claimFootageRender() {
    const row=this.db.prepare("UPDATE footage_renders SET status='rendering',updated=? WHERE id=(SELECT id FROM footage_renders WHERE status='queued' ORDER BY id LIMIT 1) AND status='queued' RETURNING id").get(new Date().toISOString());
    return row?this.footageRender(row.id):null;
  }
  // Back in the queue when the renderer is busy with a story video; nothing was made.
  requeueFootageRender(id) {this.db.prepare("UPDATE footage_renders SET status='queued',updated=? WHERE id=?").run(new Date().toISOString(),id);}
  finishFootageRender(id,error,result=null) {this.db.prepare('UPDATE footage_renders SET status=?,error=?,result=?,updated=? WHERE id=?').run(error?'failed':'ready',error,result?JSON.stringify(result):null,new Date().toISOString(),id);}
  // Saved graphics: animations ChatGPT drew and named, shared by every clip. Saving a name again replaces it;
  // edits that already used it keep their own copy.
  saveGraphic(name,def,note=null) {this.db.prepare('INSERT INTO graphics(name,def,note,updated) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET def=excluded.def,note=excluded.note,updated=excluded.updated').run(name,JSON.stringify(def),note,new Date().toISOString());}
  graphics() {return Object.fromEntries(this.db.prepare('SELECT name,def FROM graphics').all().map(r=>[r.name,JSON.parse(r.def)]));}
  graphicList() {return this.db.prepare('SELECT name,note,updated,def FROM graphics ORDER BY name').all().map(r=>({name:r.name,note:r.note,updated:r.updated,definition:JSON.parse(r.def)}));}
  deleteGraphic(name) {return this.db.prepare('DELETE FROM graphics WHERE name=?').run(name).changes>0;}
  // House rules ChatGPT keeps for itself, shown at the end of the edit guide in every later chat.
  saveGuideNote(title,text) {this.db.prepare('INSERT INTO guide_notes(title,text,updated) VALUES(?,?,?) ON CONFLICT(title) DO UPDATE SET text=excluded.text,updated=excluded.updated').run(title,text,new Date().toISOString());}
  guideNotes() {return this.db.prepare('SELECT title,text,updated FROM guide_notes ORDER BY rowid').all().map(r=>({...r}));}
  deleteGuideNote(title) {return this.db.prepare('DELETE FROM guide_notes WHERE title=?').run(title).changes>0;}
  // One-time upload links, so ChatGPT can send a file it made straight from its sandbox. Only a hash of
  // the token is kept; a link works once, for one named picture of one clip, until it expires.
  addUploadLink(hash,footage,name,expires,kind='picture') {
    this.db.prepare("DELETE FROM upload_links WHERE expires<?").run(new Date().toISOString());
    this.db.prepare('INSERT INTO upload_links(token,footage,name,expires,kind) VALUES(?,?,?,?,?)').run(hash,footage,name,expires.toISOString(),kind);
  }
  // A download link can be used repeatedly until it expires, so an interrupted download can be retried.
  downloadLink(hash,now=new Date()) {return this.db.prepare("SELECT * FROM upload_links WHERE token=? AND kind='download' AND expires>?").get(hash,now.toISOString())||null;}
  // Claimed before the upload is read, so two uploads to one link cannot both land.
  claimUploadLink(hash,now=new Date()) {return this.db.prepare("UPDATE upload_links SET state='receiving' WHERE token=? AND state='open' AND kind!='download' AND expires>? RETURNING *").get(hash,now.toISOString())||null;}
  releaseUploadLink(hash) {this.db.prepare("UPDATE upload_links SET state='open' WHERE token=? AND state='receiving'").run(hash);}
  finishUploadLink(hash) {this.db.prepare("UPDATE upload_links SET state='used' WHERE token=?").run(hash);}
  // Only the app processes clips and runs their renders, so only its start-up clears what a restart cut short.
  recoverFootage() {
    this.db.prepare("UPDATE footage SET status='failed', error='The upload was interrupted; delete this clip and upload it again', progress=NULL WHERE status='uploading'").run();
    this.db.prepare("UPDATE footage SET status='failed', error='Processing was interrupted; press Retry', progress=NULL WHERE status='processing'").run();
    this.db.prepare("UPDATE footage_renders SET status='failed', error='Rendering was interrupted; render again' WHERE status='rendering'").run();
  }
  // Standalone animations: a Remotion composition rendered on its own, with no edition, no weekend and
  // no day lock behind it. The grid flow exists to stop two editions publishing the same day twice;
  // a one-off clip has nothing to collide with, so it deliberately sits outside all of that.
  #animation(row) {
    return row?{id:row.id,name:row.name,composition:row.composition,caption:row.caption,holdSeconds:row.hold_seconds,
      status:row.status,error:row.error,postiz:row.postiz?JSON.parse(row.postiz):null,updated:row.updated}:null;
  }
  // Generated sound (src/voice.js, src/eleven.js). Three small tables, and the reason for each:
  //
  // voice_cache  The same words in the same delivery cost credits every time they are asked for, and
  //              come back subtly different each time, so a line regenerated after an edit no longer
  //              matches the take beside it. Keyed on everything that went into the request, the audio
  //              is made once and kept; asking again is a file copy. This is the whole cost story.
  // voice_spend  What was spent on what, so a month can be accounted for rather than guessed at.
  // voice_styles Which voice a named delivery uses. The board in src/voice.js carries the SETTINGS,
  //              which are the same whoever is speaking; the voice itself belongs to the account.
  cachedVoice(hash) {
    const row=this.db.prepare('SELECT * FROM voice_cache WHERE hash=?').get(hash);
    if(!row) return null;
    this.db.prepare('UPDATE voice_cache SET used=used+1 WHERE hash=?').run(hash);
    return {hash:row.hash,kind:row.kind,file:row.file,seconds:row.seconds,meta:row.meta?JSON.parse(row.meta):null,created:row.created,used:row.used+1};
  }
  rememberVoice(hash,{kind,file,seconds=null,meta=null}) {
    this.db.prepare('INSERT INTO voice_cache(hash,kind,file,seconds,meta,created) VALUES(?,?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET file=excluded.file,seconds=excluded.seconds,meta=excluded.meta')
      .run(hash,kind,file,seconds,meta?JSON.stringify(meta):null,new Date().toISOString());
  }
  forgetVoice(hash) {return this.db.prepare('DELETE FROM voice_cache WHERE hash=?').run(hash).changes>0;}
  logVoiceSpend(kind,credits,detail=null) {this.db.prepare('INSERT INTO voice_spend(at,kind,credits,detail) VALUES(?,?,?,?)').run(new Date().toISOString(),kind,Math.round(credits),detail);}
  voiceSpend(since) {
    const r=this.db.prepare('SELECT coalesce(sum(credits),0) credits, count(*) calls FROM voice_spend WHERE at>=?').get(since);
    return {credits:r.credits,calls:r.calls};
  }
  voiceSpendByKind(since) {return this.db.prepare('SELECT kind, sum(credits) credits, count(*) calls FROM voice_spend WHERE at>=? GROUP BY kind ORDER BY credits DESC').all(since).map(r=>({...r}));}
  styleVoice(style) {return this.db.prepare('SELECT voice FROM voice_styles WHERE style=?').get(style)?.voice||null;}
  styleVoices() {return Object.fromEntries(this.db.prepare('SELECT style,voice FROM voice_styles').all().map(r=>[r.style,r.voice]));}
  setStyleVoice(style,voice) {this.db.prepare('INSERT INTO voice_styles(style,voice) VALUES(?,?) ON CONFLICT(style) DO UPDATE SET voice=excluded.voice').run(style,voice);}
  voiceMeta(key) {return this.db.prepare('SELECT value FROM voice_meta WHERE key=?').get(key)?.value??null;}
  setVoiceMeta(key,value) {this.db.prepare('INSERT INTO voice_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  animations() {return this.db.prepare('SELECT * FROM animations ORDER BY updated DESC').all().map(r=>this.#animation(r));}
  animation(id) {const a=this.#animation(this.db.prepare('SELECT * FROM animations WHERE id=?').get(id)); if(!a) throw new Error('Animation not found'); return a;}
  saveAnimation({id,name,composition,caption='',holdSeconds=5}) {
    const key=id||[...Array(12)].map(()=>randomInt(16).toString(16)).join('');
    if(id&&this.animation(id).status==='rendering') throw new Error('This animation is rendering; wait for it to finish before changing it');
    this.db.prepare(`INSERT INTO animations(id,name,composition,caption,hold_seconds,status,error,updated) VALUES(?,?,?,?,?,'new',NULL,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,composition=excluded.composition,caption=excluded.caption,hold_seconds=excluded.hold_seconds,updated=excluded.updated`)
      .run(key,name,composition,caption,holdSeconds,new Date().toISOString());
    return this.animation(key);
  }
  // Claims the render atomically, so two clicks cannot start two renders of the same clip.
  startAnimationRender(id) {
    const r=this.db.prepare("UPDATE animations SET status='rendering',error=NULL,updated=? WHERE id=? AND status!='rendering'").run(new Date().toISOString(),id);
    if(!r.changes) throw new Error('This animation is already rendering');
    return this.animation(id);
  }
  finishAnimationRender(id,error=null) {this.db.prepare('UPDATE animations SET status=?,error=?,updated=? WHERE id=?').run(error?'failed':'ready',error,new Date().toISOString(),id); return this.animation(id);}
  recoverAnimations() {this.db.prepare("UPDATE animations SET status='failed', error='Rendering was interrupted; render again' WHERE status='rendering'").run();}
  setAnimationPostiz(id,info) {this.db.prepare('UPDATE animations SET postiz=?,updated=? WHERE id=?').run(JSON.stringify(info),new Date().toISOString(),id); return this.animation(id);}
  deleteAnimation(id) {this.animation(id); this.db.prepare('DELETE FROM animations WHERE id=?').run(id);}
  close(){this.db.close();}
}

// The stored colour choices. The first version kept one whole theme per day ({date: key}); those picks
// predate week families and are dropped, so such an edition falls back to its week's defaults.
function colours(json) {
  const c=json?JSON.parse(json):{};
  return {...(c.palette?{palette:c.palette}:{}),days:c.days||{}};
}
// Where short links point: SHORT_LINK_BASE (a bare host such as kurejam.lv) once you own a short
// domain, otherwise the dashboard's own host, which already serves them.
export function shortBase(env=process.env) {
  if(env.SHORT_LINK_BASE) return env.SHORT_LINK_BASE.replace(/^https?:\/\//,'').replace(/\/+$/,'');
  try {return new URL(env.APP_ORIGIN||'http://localhost:3100').host;} catch {return 'localhost:3100';}
}
