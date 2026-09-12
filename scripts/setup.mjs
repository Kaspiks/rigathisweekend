import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
let template=await readFile('.env.example','utf8');
for(const key of ['ADMIN_TOKEN','POSTIZ_JWT_SECRET','POSTGRES_PASSWORD','TEMPORAL_PASSWORD','WAHA_API_KEY','WAHA_DASHBOARD_PASSWORD']) template=template.replace(`${key}=\n`,`${key}=${randomBytes(32).toString('hex')}\n`);
try {await writeFile('.env',template,{flag:'wx',mode:0o600});console.log('Created .env with private random secrets. Existing configuration is never overwritten.');}
catch(e){if(e.code==='EEXIST')console.log('.env already exists; left unchanged.');else throw e;}
