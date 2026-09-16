import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml as esc, eventTime, postCaptionPreview, whatsappText, postsFor, dayName, languageTag, dayTag } from './domain.js';
import { eventPhoto } from './photos.js';

const INK='#17352d', LIME='#d4ed86', PAPER='#f4f0e6', MUTED='#c1cbbb';
function lines(text, width) {
  const out=[]; let line='';
  for(const word of text.split(/\s+/)) {
    if(word.length>width) { if(line) out.push(line); line=''; for(let i=0;i<word.length;i+=width) out.push(word.slice(i,i+width)); continue; }
    if((line+' '+word).trim().length>width) {out.push(line);line=word;} else line=(line+' '+word).trim();
  }
  if(line) out.push(line); return out;
}
// Fit the title at the largest size that still leaves it readable, measuring at each step.
function titleLayout(text, max) {
  for (const size of [76, 66, 58, 50, 44, 38]) {
    const width = Math.floor(920 / (size * 0.54));
    const ls = lines(text, width);
    if (ls.length <= max || size === 38) return { size, ls };
  }
}
// Hierarchy: the name carries the card, the date and price come next, the venue sits under them.
// Everything else belongs in the caption, where there is room to read it.
function textStack(event, story=false) {
  const items=[]; let y=0;
  const put=(text,size,width,color,gap=0)=>{
    y+=gap;
    const ls=lines(text,width);
    ls.forEach((s,i)=>items.push(`<text x="80" y="${(y+size+i*size*1.22).toFixed(1)}" font-size="${size}" fill="${color}">${esc(s)}</text>`));
    y+=ls.length*size*1.22;
  };
  const title=titleLayout(event.title, story?5:4);
  title.ls.forEach((s,i)=>items.push(`<text x="80" y="${(y+title.size+i*title.size*1.18).toFixed(1)}" font-size="${title.size}" fill="${PAPER}" letter-spacing="-1">${esc(s)}</text>`));
  y+=title.ls.length*title.size*1.18;
  items.push(`<rect x="80" y="${(y+40).toFixed(1)}" width="100" height="8" fill="${LIME}"/>`); y+=92;

  put(eventTime(event),48,26,LIME);
  put(event.price,48,26,PAPER,14);
  put(event.venue,30,42,MUTED,26);
  return {body:items.join(''),height:y};
}

// Pills in the top corner: which languages the event suits, and which weekend days it is on.
function pill(text,y){const w=text.length*17+48;return `<rect x="${(1000-w).toFixed(0)}" y="${y}" width="${w.toFixed(0)}" height="48" rx="24" fill="${LIME}"/><text x="${(1000-w/2).toFixed(0)}" y="${y+33}" font-size="26" letter-spacing="3" text-anchor="middle" fill="${INK}" font-weight="bold">${esc(text)}</text>`;}
function pills(event, story) {
  const top=story?138:58, lang=languageTag(event), days=dayTag(event);
  return (lang?pill(lang,top):'')+(days?pill(days,lang?top+60:top):'');
}
const frame=(height,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}"><g font-family="DejaVu Sans,Arial,sans-serif">${body}</g></svg>`;
const plate=height=>`<rect width="1080" height="${height}" fill="${INK}"/><circle cx="1030" cy="80" r="320" fill="#264a3e"/>`;

// The opening slide of each day's post: the date, large, with the day's line-up underneath.
export function coverSvg(post, weekend, demo=false) {
  const height=1350, [weekday,...rest]=dayName(post.date).split(' ');
  const size=Math.min(150,920/(weekday.length*0.56));
  const many=post.parts>1;
  const count=many?`${post.items.length} OF ${post.dayTotal} EVENTS`:`${post.items.length} ${post.items.length===1?'EVENT':'EVENTS'}`;
  const part=many?`PART ${post.part} OF ${post.parts}`:(demo?'DEMO':'');
  // One line per drawn element, joined without separators: SVG is whitespace-sensitive between text nodes.
  return frame(height, [
    plate(height),
    `<text x="80" y="100" font-size="30" letter-spacing="6" fill="${LIME}">RĪGA / WEEKEND</text>`,
    `<text x="80" y="150" font-size="25" fill="${MUTED}">WEEKEND OF ${esc(weekend)}${many&&demo?' · DEMO':''}</text>`,
    // The weekday, as large as it can be without running past the margin.
    `<text x="80" y="620" font-size="${size.toFixed(0)}" fill="${PAPER}" letter-spacing="-3">${esc(weekday.toUpperCase())}</text>`,
    `<text x="80" y="720" font-size="60" fill="${LIME}">${esc(rest.join(' ').toUpperCase())}</text>`,
    `<rect x="80" y="790" width="100" height="8" fill="${LIME}"/>`,
    `<text x="80" y="895" font-size="44" letter-spacing="3" fill="${PAPER}">${esc(count)}</text>`,
    part ? `<text x="80" y="955" font-size="34" letter-spacing="4" fill="${MUTED}">${esc(part)}</text>` : '',
    // The note about multi-day events, boxed.
    `<rect x="80" y="1000" width="920" height="126" rx="18" fill="none" stroke="${LIME}" stroke-width="3"/>`,
    `<text x="116" y="1052" font-size="30" letter-spacing="2" font-weight="bold" fill="${LIME}">EXHIBITIONS MAY RUN SEVERAL DAYS</text>`,
    `<text x="116" y="1098" font-size="28" letter-spacing="2" fill="${PAPER}">CHECK THE CAPTION FOR DATES</text>`,
    `<text x="80" y="${height-150}" font-size="22" fill="${MUTED}">SWIPE FOR THE DETAILS · CHECK ORGANISER FOR UPDATES</text>`,
  ].join(''));
}

// Dark gradients over a photo: one at the top for the tags, one under the copy so it stays readable.
function photoScrim(height, top, story) {
  return [
    '<defs>',
    '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#0c1c17" stop-opacity="0"/>',
    '<stop offset="0.4" stop-color="#0c1c17" stop-opacity="0.74"/>',
    '<stop offset="1" stop-color="#0c1c17" stop-opacity="0.97"/>',
    '</linearGradient>',
    '<linearGradient id="t" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#0c1c17" stop-opacity="0.8"/>',
    '<stop offset="1" stop-color="#0c1c17" stop-opacity="0"/>',
    '</linearGradient>',
    '</defs>',
    `<rect width="1080" height="${story?320:220}" fill="url(#t)"/>`,
    `<rect y="${Math.max(0,top-190)}" width="1080" height="${height-Math.max(0,top-190)}" fill="url(#b)"/>`,
  ].join('');
}

// The lime circle with the slide's position in its post ("3 OF 5"). Delete this to drop the numbers;
// the captions number their entries the same way, so change those too if you do.
function slideNumber(index, total, demo, story) {
  if(story||total<=0) return demo?`<text x="80" y="${story?240:150}" font-size="25" fill="${MUTED}">DEMO</text>`:'';
  return [
    `<circle cx="124" cy="208" r="46" fill="${LIME}"/>`,
    `<text x="124" y="226" font-size="50" font-weight="bold" text-anchor="middle" fill="${INK}">${index+1}</text>`,
    `<text x="190" y="222" font-size="28" letter-spacing="3" fill="${MUTED}">OF ${total}${demo?' · DEMO':''}</text>`,
  ].join('');
}

// index/total number the slide within its post, matching the caption; total 0 draws no number.
export function cardSvg(event, index, total, weekend, story=false, demo=false, credit=null, height=null) {
  // credit: null draws the plain card; '' is a photo you uploaded, so nothing is credited; a string credits the organiser.
  height=height||(story?1920:1350);
  const stack=textStack(event,story), photo=credit!=null;
  const footer=story?200:150, label=photo?(credit?`${credit.toUpperCase()} · CHECK ORGANISER FOR UPDATES`:'CHECK ORGANISER FOR UPDATES'):'SAVE YOUR WEEKEND · CHECK ORGANISER FOR UPDATES';
  // Over a photo the copy is anchored to the bottom under a scrim; the plain card keeps its original top-down layout.
  const top=photo?Math.max(story?420:300,height-footer-60-stack.height):(story?450:350);
  return frame(height, [
    photo ? photoScrim(height, top, story) : plate(height),
    pills(event,story),
    `<text x="80" y="${story?180:100}" font-size="30" letter-spacing="6" fill="${LIME}">RĪGA / WEEKEND</text>`,
    slideNumber(index, total, demo, story),
    // Title, date, price and venue, positioned as a block by textStack().
    `<g transform="translate(0,${top.toFixed(1)})">${stack.body}</g>`,
    `<text x="80" y="${height-footer}" font-size="22" fill="${MUTED}">${esc(label)}</text>`,
  ].join(''));
}

export const uploadPath=(dir,id,index)=>join(dir,'media',id,`upload-${index}.jpg`);

// Draws one slide to `file`. `total` 0 leaves the number badge off, which is what the story grid wants:
// in a carousel the number ties a slide to its caption entry, but in a grid every card is on screen at once.
// `photo` is {buffer,label} for the organiser's image (label '' for one you uploaded), or null for the plain card.
export async function drawCard(file,{event,index=0,total=0,weekend,story=false,demo=false,photo=null,height=null}) {
  height=height||(story?1920:1350);
  const credit=photo?photo.label:null;
  const draw=async use=>{
    const svg=Buffer.from(cardSvg(event,index,total,weekend,story,demo,use?credit:null,height));
    if(!use) return sharp(svg).jpeg({quality:90}).toFile(file);
    const base=await sharp(photo.buffer).resize(1080,height,{fit:'cover',position:'attention'}).toBuffer();
    return sharp(base).composite([{input:svg,top:0,left:0}]).jpeg({quality:88}).toFile(file);
  };
  // A decodable-but-unrenderable photo must not cost us the card.
  if(photo) {try {return await draw(true);} catch(err) {console.error(`Photo render failed for ${event.title}: ${err.message}`);}}
  return draw(false);
}

// The photo behind an event's card, if there is one: your upload first, then the organiser's cached image.
export async function cardPhoto(dir,editionId,index) {
  try {return {buffer:await readFile(uploadPath(dir,editionId,index)),label:''};} catch {}
  const dest=join(dir,'media',editionId);
  try {return {buffer:await readFile(join(dest,`photo-${index}.jpg`)),label:await readFile(join(dest,`photo-${index}.label`),'utf8')};} catch {}
  return null;
}
// `only` redraws a single event's slides, which is all a photo upload changes.
// `link` shortens organiser URLs for Instagram captions; without it captions carry full links.
export async function renderEdition(edition,dir,fetcher=fetch,{only=null,link=null}={}) {
  const dest=join(dir,'media',edition.id); await mkdir(dest,{recursive:true});
  const events=edition.data.events, selected=edition.selected||null;
  // A photo you uploaded always wins and never touches the network. Otherwise the organiser's
  // image is cached on disk, including the misses, so re-rendering costs no further requests.
  const photos=await Promise.all(events.map(async(e,i)=>{
    if(only!=null&&i!==only) return null;
    try {return {buffer:await readFile(uploadPath(dir,edition.id,i)),label:''};} catch {}
    const jpg=join(dest,`photo-${i}.jpg`), src=join(dest,`photo-${i}.label`), miss=join(dest,`photo-${i}.none`);
    try {return {buffer:await readFile(jpg),label:await readFile(src,'utf8')};} catch {}
    try {await readFile(miss); return null;} catch {}
    if(edition.demo) return null; // demo editions cite example.com and never reach the network
    const found=await eventPhoto(e,fetcher);
    if(found) {await writeFile(jpg,found.buffer); await writeFile(src,found.label);} else await writeFile(miss,'');
    return found;
  }));

  // Covers and captions describe what will publish; the event cards cover everything, so the
  // review page can show the full list before you choose.
  if(only==null) for(const post of postsFor(edition.data,selected)) {
    await sharp(Buffer.from(coverSvg(post,edition.weekend,edition.demo))).jpeg({quality:90}).toFile(join(dest,`cover-${post.date}-${post.part}.jpg`));
    await writeFile(join(dest,`instagram-${post.date}-${post.part}.txt`),postCaptionPreview(edition.data,post,link));
  }

  // Each slide carries its position within its own post, the same number its caption entry uses.
  const numbers=new Map();
  for(const post of postsFor(edition.data,selected)) post.items.forEach((x,k)=>numbers.set(x.index,{n:k,of:post.items.length}));
  for(const [i,e] of events.entries()) {
    if(only!=null&&i!==only) continue;
    const number=numbers.get(i)||{n:0,of:0};
    for(const story of [false,true])
      await drawCard(join(dest,`${story?'story':'feed'}-${i}.jpg`),{event:e,index:number.n,total:number.of,weekend:edition.weekend,story,demo:edition.demo,photo:photos[i]});
  }

  if(only==null) await writeFile(join(dest,'whatsapp.txt'),whatsappText(edition.data,selected));
  return dest;
}
