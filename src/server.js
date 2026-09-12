import { Store } from './store.js';
import { createApp } from './app.js';
const store=new Store(process.env.DATA_DIR||'data');
const server=createApp(store).listen(Number(process.env.PORT||3100),process.env.HOST||'127.0.0.1',()=>console.log(`Riga Weekend listening on port ${process.env.PORT||3100}`));
process.on('SIGTERM',()=>server.close(()=>{store.close();process.exit(0);}));
