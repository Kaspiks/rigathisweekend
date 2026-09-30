import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml as esc, eventTime, eventClock, eventDayClock, postCaptionPreview, whatsappText, postsFor, dayName, languageTag, dayTag, eventDate } from './domain.js';
import { eventPhoto } from './photos.js';
import { THEMES, DEFAULT_THEME, themeFor } from './themes.js';

// `t` in the drawing functions below is a colour theme from themes.js; the forest one is the original look.
const FOREST=THEMES[DEFAULT_THEME];
function lines(text, width) {
  const out=[]; let line='';
  for(const word of text.split(/\s+/)) {
    if(word.length>width) { if(line) out.push(line); line=''; for(let i=0;i<word.length;i+=width) out.push(word.slice(i,i+width)); continue; }
    if((line+' '+word).trim().length>width) {out.push(line);line=word;} else line=(line+' '+word).trim();
  }
  if(line) out.push(line); return out;
}
// Fit the title at the largest size that still leaves it readable, measuring at each step.
function titleLayout(text, max, lineWidth = 920) {
  for (const size of [76, 66, 58, 50, 44, 38]) {
    const width = Math.floor(lineWidth / (size * 0.54));
    const ls = lines(text, width);
    if (ls.length <= max || size === 38) return { size, ls };
  }
}
// Hierarchy: the name carries the card, the date and price come next, the venue sits under them.
// Everything else belongs in the caption, where there is room to read it.
// `wv` is the width the copy is laid out across: 1080 normally, wider on a grid tile whose text is drawn
// smaller to match its neighbours, so lines wrap where they will actually end.
function textStack(event, story=false, timeOnly=false, t=FOREST, wv=1080) {
  const items=[]; let y=0, k=wv/1080;
  const put=(text,size,width,color,gap=0)=>{
    y+=gap;
    const ls=lines(text,width);
    ls.forEach((s,i)=>items.push(`<text x="80" y="${(y+size+i*size*1.22).toFixed(1)}" font-size="${size}" fill="${color}">${esc(s)}</text>`));
    y+=ls.length*size*1.22;
  };
  const title=titleLayout(event.title, story?5:4, wv-160);
  title.ls.forEach((s,i)=>items.push(`<text x="80" y="${(y+title.size+i*title.size*1.18).toFixed(1)}" font-size="${title.size}" fill="${t.paper}" letter-spacing="-1">${esc(s)}</text>`));
  y+=title.ls.length*title.size*1.18;
  items.push(`<rect x="80" y="${(y+40).toFixed(1)}" width="100" height="8" fill="${t.accent}"/>`); y+=92;

  put(timeOnly==='day'?eventDayClock(event):timeOnly?eventClock(event):eventTime(event),48,Math.floor(26*k),t.accent);
  put(event.price,48,Math.floor(26*k),t.paper,14);
  put(event.venue,30,Math.floor(42*k),t.muted,26);
  return {body:items.join(''),height:y};
}

// Pills in the top corner: which languages the event suits, and which weekend days it is on.
function pill(text,y,t,wv=1080){const r=wv-80,w=text.length*17+48;return `<rect x="${(r-w).toFixed(0)}" y="${y}" width="${w.toFixed(0)}" height="48" rx="24" fill="${t.accent}"/><text x="${(r-w/2).toFixed(0)}" y="${y+33}" font-size="26" letter-spacing="3" text-anchor="middle" fill="${t.ink}" font-weight="bold">${esc(text)}</text>`;}
function pills(event, story, t, wv=1080) {
  const top=story?138:58, lang=languageTag(event), days=dayTag(event);
  return (lang?pill(lang,top,t,wv):'')+(days?pill(days,lang?top+60:top,t,wv):'');
}
const frame=(height,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}"><g font-family="DejaVu Sans,Arial,sans-serif">${body}</g></svg>`;
const plate=(height,t)=>`<rect width="1080" height="${height}" fill="${t.ink}"/><circle cx="1030" cy="80" r="320" fill="${t.glow}"/>`;
// A special post's own heading, up to two lines, as large as fits between the masthead and the weekday.
function headlineLines(text) {
  for (const size of [96, 84, 72, 62, 54]) {
    const ls = lines(text.toUpperCase(), Math.floor(920 / (size * 0.72)));
    if (ls.length <= 2) return { size, ls };
  }
  return { size: 54, ls: lines(text.toUpperCase(), 26).slice(0, 2) };
}

// The opening slide of each day's post: the date, large, with the day's line-up underneath.
// `headline` is a special post's own heading (Researchers' Night), drawn above the date in the accent colour.
export function coverSvg(post, weekend, demo=false, t=FOREST, headline=null) {
  const height=1350, [weekday,...rest]=dayName(post.date).split(' ');
  const size=Math.min(150,920/(weekday.length*0.56));
  const many=post.parts>1;
  const count=many?`${post.items.length} OF ${post.dayTotal} EVENTS`:`${post.items.length} ${post.items.length===1?'EVENT':'EVENTS'}`;
  const part=many?`PART ${post.part} OF ${post.parts}`:(demo?'DEMO':'');
  const head=headline?headlineLines(headline):null;
  // One line per drawn element, joined without separators: SVG is whitespace-sensitive between text nodes.
  return frame(height, [
    plate(height,t),
    `<text x="80" y="100" font-size="30" letter-spacing="6" fill="${t.accent}">RĪGA / WEEKEND</text>`,
    `<text x="80" y="150" font-size="25" fill="${t.muted}">WEEKEND OF ${esc(weekend)}${many&&demo?' · DEMO':''}</text>`,
    // The special post's heading, bottom-aligned just above the weekday so one or two lines both sit right.
    head ? head.ls.map((s,i)=>`<text x="80" y="${(440-(head.ls.length-1-i)*head.size*1.08).toFixed(0)}" font-size="${head.size}" font-weight="bold" letter-spacing="1" fill="${t.accent}">${esc(s)}</text>`).join('') : '',
    // The weekday, as large as it can be without running past the margin.
    `<text x="80" y="620" font-size="${size.toFixed(0)}" fill="${t.paper}" letter-spacing="-3">${esc(weekday.toUpperCase())}</text>`,
    `<text x="80" y="720" font-size="60" fill="${t.accent}">${esc(rest.join(' ').toUpperCase())}</text>`,
    `<rect x="80" y="790" width="100" height="8" fill="${t.accent}"/>`,
    `<text x="80" y="895" font-size="44" letter-spacing="3" fill="${t.paper}">${esc(count)}</text>`,
    part ? `<text x="80" y="955" font-size="34" letter-spacing="4" fill="${t.muted}">${esc(part)}</text>` : '',
    // The note about multi-day events, boxed.
    `<rect x="80" y="1000" width="920" height="126" rx="18" fill="none" stroke="${t.accent}" stroke-width="3"/>`,
    `<text x="116" y="1052" font-size="30" letter-spacing="2" font-weight="bold" fill="${t.accent}">EXHIBITIONS MAY RUN SEVERAL DAYS</text>`,
    `<text x="116" y="1098" font-size="28" letter-spacing="2" fill="${t.paper}">CHECK THE CAPTION FOR DATES</text>`,
    `<text x="80" y="${height-150}" font-size="22" fill="${t.muted}">SWIPE FOR THE DETAILS · CHECK ORGANISER FOR UPDATES</text>`,
  ].join(''));
}

// Dark gradients over a photo: one at the top for the tags, one under the copy so it stays readable.
function photoScrim(height, top, story, t=FOREST) {
  return [
    '<defs>',
    '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="${t.shade}" stop-opacity="0"/>',
    '<stop offset="0.4" stop-color="${t.shade}" stop-opacity="0.74"/>',
    '<stop offset="1" stop-color="${t.shade}" stop-opacity="0.97"/>',
    '</linearGradient>',
    '<linearGradient id="t" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="${t.shade}" stop-opacity="0.8"/>',
    '<stop offset="1" stop-color="${t.shade}" stop-opacity="0"/>',
    '</linearGradient>',
    '</defs>',
    `<rect width="1080" height="${story?320:220}" fill="url(#t)"/>`,
    `<rect y="${Math.max(0,top-190)}" width="1080" height="${height-Math.max(0,top-190)}" fill="url(#b)"/>`,
  ].join('');
}

// The lime circle with the slide's position in its post ("3 OF 5"). Delete this to drop the numbers;
// the captions number their entries the same way, so change those too if you do.
function slideNumber(index, total, demo, story, t=FOREST) {
  if(story||total<=0) return demo?`<text x="80" y="${story?240:150}" font-size="25" fill="${t.muted}">DEMO</text>`:'';
  return [
    `<circle cx="124" cy="208" r="46" fill="${t.accent}"/>`,
    `<text x="124" y="226" font-size="50" font-weight="bold" text-anchor="middle" fill="${t.ink}">${index+1}</text>`,
    `<text x="190" y="222" font-size="28" letter-spacing="3" fill="${t.muted}">OF ${total}${demo?' · DEMO':''}</text>`,
  ].join('');
}

// index/total number the slide within its post, matching the caption; total 0 draws no number.
// `timeOnly` drops the weekday and date from the time line, for grid tiles where the day is already known.
// `ui` scales everything drawn over the picture (tags, masthead, copy). A grid gives each tile the ui that makes
// its text print at the same size as the smallest tile's, so a full-width cell does not shout over the others.
// The overlay is laid out on a virtual canvas of 1080/ui by height/ui and then scaled down onto the card.
export function cardSvg(event, index, total, weekend, story=false, demo=false, credit=null, height=null, timeOnly=false, t=FOREST, ui=1) {
  // credit: null draws the plain card; '' is a photo you uploaded, so nothing is credited; a string credits the organiser.
  height=height||(story?1920:1350);
  const wv=1080/ui, hv=height/ui;
  const stack=textStack(event,story,timeOnly,t,wv), photo=credit!=null;
  // A grid tile (timeOnly) drops the "check organiser" line: the story has its own footer bar, and on a short
  // tile the line would repeat on every card and crowd the copy above it. An organiser's photo keeps its credit.
  const tileCredit=timeOnly&&photo&&credit?credit.toUpperCase():null;
  const footer=timeOnly?(tileCredit?64:40):(story?200:150), label=photo?(credit?`${credit.toUpperCase()} · CHECK ORGANISER FOR UPDATES`:'CHECK ORGANISER FOR UPDATES'):'SAVE YOUR WEEKEND · CHECK ORGANISER FOR UPDATES';
  // Over a photo the copy is anchored to the bottom under a scrim; the plain card keeps its original top-down
  // layout, but on a short grid tile it moves up just enough to clear the footer line instead of running into it.
  // The copy must fit between the tags at the top and the footer line. A long title with a long price on a
  // short grid tile can be taller than that, so the block is shrunk until it fits rather than run off the card.
  const minTop=timeOnly?170:photo?(story?420:300):(story?300:200);
  const room=hv-footer-60-minTop, fit=stack.height>room?room/stack.height:1, sh=stack.height*fit;
  const top=photo?Math.max(minTop,hv-footer-60-sh):Math.max(minTop,Math.min(story?450:350,hv-footer-60-sh));
  return frame(height, [
    photo ? photoScrim(height, top*ui, story, t) : plate(height, t),
    `<g transform="scale(${ui})">`,
    pills(event,story,t,wv),
    `<text x="80" y="${story?180:100}" font-size="30" letter-spacing="6" fill="${t.accent}">RĪGA / WEEKEND</text>`,
    slideNumber(index, total, demo, story, t),
    // Title, date, price and venue, positioned as a block by textStack(), and shrunk if it would not fit.
    `<g transform="translate(0,${top.toFixed(1)}) scale(${fit.toFixed(4)})">${stack.body}</g>`,
    timeOnly ? (tileCredit ? `<text x="80" y="${hv-footer+22}" font-size="22" fill="${t.muted}">${esc(tileCredit)}</text>` : '')
      : `<text x="80" y="${hv-footer}" font-size="22" fill="${t.muted}">${esc(label)}</text>`,
    '</g>',
  ].join(''));
}

export const uploadPath=(dir,id,index)=>join(dir,'media',id,`upload-${index}.jpg`);

// Draws one slide to `file`. `total` 0 leaves the number badge off, which is what the story grid wants:
// in a carousel the number ties a slide to its caption entry, but in a grid every card is on screen at once.
// `photo` is {buffer,label} for the organiser's image (label '' for one you uploaded), or null for the plain card.
export async function drawCard(file,{event,index=0,total=0,weekend,story=false,demo=false,photo=null,height=null,timeOnly=false,theme=FOREST,ui=1}) {
  height=height||(story?1920:1350);
  const credit=photo?photo.label:null;
  const draw=async use=>{
    const svg=Buffer.from(cardSvg(event,index,total,weekend,story,demo,use?credit:null,height,timeOnly,theme,ui));
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
// `date` redraws one day's covers and slides, which is all a colour change touches.
// `link` shortens organiser URLs for Instagram captions; without it captions carry full links.
export async function renderEdition(edition,dir,fetcher=fetch,{only=null,date=null,link=null}={}) {
  const dest=join(dir,'media',edition.id); await mkdir(dest,{recursive:true});
  const events=edition.data.events, selected=edition.selected||null;
  const skip=(e,i)=>(only!=null&&i!==only)||(date!=null&&eventDate(e)!==date);
  // A photo you uploaded always wins and never touches the network. Otherwise the organiser's
  // image is cached on disk, including the misses, so re-rendering costs no further requests.
  const photos=await Promise.all(events.map(async(e,i)=>{
    if(skip(e,i)) return null;
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
  if(only==null) for(const post of postsFor(edition.data,selected).filter(p=>date==null||p.date===date)) {
    await sharp(Buffer.from(coverSvg(post,edition.weekend,edition.demo,themeFor(edition,post.date),edition.data.headline))).jpeg({quality:90}).toFile(join(dest,`cover-${post.date}-${post.part}.jpg`));
    await writeFile(join(dest,`instagram-${post.date}-${post.part}.txt`),postCaptionPreview(edition.data,post,link));
  }

  // Each slide carries its position within its own post, the same number its caption entry uses.
  const numbers=new Map();
  for(const post of postsFor(edition.data,selected)) post.items.forEach((x,k)=>numbers.set(x.index,{n:k,of:post.items.length}));
  for(const [i,e] of events.entries()) {
    if(skip(e,i)) continue;
    const number=numbers.get(i)||{n:0,of:0};
    for(const story of [false,true])
      await drawCard(join(dest,`${story?'story':'feed'}-${i}.jpg`),{event:e,index:number.n,total:number.of,weekend:edition.weekend,story,demo:edition.demo,photo:photos[i],theme:themeFor(edition,eventDate(e))});
  }

  if(only==null&&date==null) await writeFile(join(dest,'whatsapp.txt'),whatsappText(edition.data,selected));
  return dest;
}
