import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, validateSubmission, plannedJobs } from './domain.js';
import { DateTime } from 'luxon';

export class Store {
  constructor(dir) {
    mkdirSync(dir, {recursive:true}); this.dir = dir;
    this.db = new DatabaseSync(join(dir,'riga.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY, weekend TEXT NOT NULL, data TEXT NOT NULL, demo INTEGER NOT NULL, approved INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE UNIQUE INDEX IF NOT EXISTS one_approved_weekend ON editions(weekend) WHERE approved=1 AND demo=0;
      CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, edition TEXT NOT NULL, target TEXT NOT NULL, due TEXT NOT NULL, status TEXT DEFAULT 'queued', result TEXT, UNIQUE(edition,target));
      CREATE TABLE IF NOT EXISTS runs(weekend TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT);`);
  }
  submit(input, demo=false) {
    const data=validateSubmission(input); const id=digest({data,demo});
    this.db.prepare('INSERT OR IGNORE INTO editions(id,weekend,data,demo) VALUES(?,?,?,?)').run(id,data.weekend,JSON.stringify(data),+demo);
    return this.get(id);
  }
  get(id) { const row=this.db.prepare('SELECT * FROM editions WHERE id=?').get(id); if(!row) throw new Error('Edition not found'); return {...row,data:JSON.parse(row.data)}; }
  list() { return this.db.prepare('SELECT id FROM editions ORDER BY created DESC, rowid DESC').all().map(r=>this.get(r.id)); }
  jobs(id) { return this.db.prepare('SELECT * FROM jobs WHERE edition=? ORDER BY id').all(id); }
  approve(id, now=DateTime.now()) {
    const e=this.get(id);
    if(e.demo) throw new Error('Demo editions cannot be published');
    if(DateTime.fromISO(e.weekend,{zone:'Europe/Riga'}).plus({days:3}) <= now) throw new Error('Weekend has ended');
    if(e.data.events.some(x=>Date.parse(x.startsAt)<=now.toMillis())) throw new Error('Edition contains past events; submit an updated edition');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE editions SET approved=1 WHERE id=?').run(id);
      for(const j of plannedJobs(e.data,now)) this.db.prepare('INSERT OR IGNORE INTO jobs(edition,target,due) VALUES(?,?,?)').run(id,j.target,j.due);
      this.db.exec('COMMIT');
    } catch(err) {this.db.exec('ROLLBACK');throw err;}
    return this.jobs(id);
  }
  claim(now=new Date().toISOString()) {
    return this.db.prepare("UPDATE jobs SET status='processing' WHERE id=(SELECT id FROM jobs WHERE status='queued' AND due<=? ORDER BY due,id LIMIT 1) AND status='queued' RETURNING *").get(now);
  }
  finish(id,status,result) {this.db.prepare('UPDATE jobs SET status=?,result=? WHERE id=?').run(status,JSON.stringify(result),id);}
  recover() {this.db.prepare("UPDATE jobs SET status='uncertain',result=? WHERE status='processing'").run(JSON.stringify({error:'Worker interrupted. Check provider before retrying.'}));}
  resolve(id,action) {
    const status=action==='retry'?'queued':'sent';
    const r=this.db.prepare("UPDATE jobs SET status=?,result=NULL WHERE id=? AND status IN ('uncertain','blocked')").run(status,id);
    if(!r.changes) throw new Error('Only blocked or uncertain jobs can be resolved');
  }
  close(){this.db.close();}
}
