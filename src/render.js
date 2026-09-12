import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml as esc, eventTime, caption, whatsappText } from './domain.js';
import { writeFile } from 'node:fs/promises';

function lines(text, width) {
  const out=[]; let line='';
  for(const word of text.split(/\s+/)) {
    if(word.length>width) { if(line) out.push(line); line=''; for(let i=0;i<word.length;i+=width) out.push(word.slice(i,i+width)); continue; }
    if((line+' '+word).trim().length>width) {out.push(line);line=word;} else line=(line+' '+word).trim();
  }
  if(line) out.push(line); return out;
}
function textBlock(text,x,y,size,width,color='#f4f0e6') {
  return lines(text,width).map((s,i)=>`<text x="${x}" y="${y+i*size*1.22}" font-size="${size}" fill="${color}">${esc(s)}</text>`).join('');
}
export function cardSvg(event, index, total, weekend, story=false, demo=false) {
  const height=story?1920:1350, top=story?330:230;
  const titleSize=Math.min(60,260/(lines(event.title,24).length*1.22));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}"><rect width="1080" height="${height}" fill="#17352d"/><circle cx="1030" cy="80" r="320" fill="#264a3e"/><g font-family="DejaVu Sans,Arial,sans-serif"><text x="80" y="${story?180:100}" font-size="30" letter-spacing="6" fill="#d4ed86">RĪGA / WEEKEND</text><text x="80" y="${top}" font-size="25" fill="#c1cbbb">${esc(weekend)} · ${index+1} / ${total}${demo?' · DEMO':''}</text>${textBlock(event.title,80,top+120,titleSize,24)}<rect x="80" y="${top+390}" width="100" height="8" fill="#d4ed86"/>${textBlock(eventTime(event),80,top+465,32,40,'#d4ed86')}${textBlock(event.venue,80,top+535,32,40)}${textBlock(event.price,80,top+640,30,42,'#d4ed86')}${textBlock(event.summary,80,top+740,30,43)}<text x="80" y="${height-(story?200:75)}" font-size="22" fill="#c1cbbb">SAVE YOUR WEEKEND · CHECK ORGANISER FOR UPDATES</text></g></svg>`;
}
export async function renderEdition(edition,dir) {
  const dest=join(dir,'media',edition.id); await mkdir(dest,{recursive:true});
  for(const [i,e] of edition.data.events.entries()) for(const story of [false,true]) {
    await sharp(Buffer.from(cardSvg(e,i,edition.data.events.length,edition.weekend,story,edition.demo))).jpeg({quality:90}).toFile(join(dest,`${story?'story':'feed'}-${i}.jpg`));
  }
  await writeFile(join(dest,'instagram.txt'),caption(edition.data));
  await writeFile(join(dest,'whatsapp.txt'),whatsappText(edition.data));
  return dest;
}
