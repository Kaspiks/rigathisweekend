import { MuseumComposition } from './MuseumComposition';
import { Composition } from 'remotion';
import { EnvelopeStory, FPS, durationFor, type EnvelopeStoryProps } from './EnvelopeStory';
import { TicketStory, TICKET_FPS, ticketDuration, type TicketStoryProps } from './TicketStory';
import { RyeStory, RYE_FPS, ryeDuration, type RyeStoryProps } from './RyeStory';
import { PressStory, ClothPlate, PRESS_FPS, pressDuration, type PressStoryProps } from './PressStory';
import { BURSTS } from './bursts';
import { AutumnStory, ParchmentPlate, AUTUMN_FPS, autumnDuration, type AutumnStoryProps } from './AutumnStory';
import { BaroqueStory, BAROQUE_FPS, baroqueDuration, type BaroqueStoryProps } from './BaroqueStory';
import { MosaicDemo } from './MosaicDemo';
import { MosaicStory, MOSAIC_FPS, mosaicDuration, type MosaicStoryProps } from './MosaicStory';
import { Practice } from './Practice';
import { Practice2x } from './Practice2';
import { Practice3x } from './Practice3';
import { Practice4x } from './Practice4';
import { EcgStory, ECG_FPS, ecgDuration, type EcgStoryProps } from './EcgStory';
import { ResearchersStory, RESEARCHERS_FPS, researchersDuration, type ResearchersStoryProps } from './ResearchersStory';
import { ArtFairStory, ARTFAIR_FPS, artFairDuration, type ArtFairStoryProps } from './ArtFairStory';
import { AUTUMN_FPS as OPENER_FPS } from './autumnOpener';
import { LeafGustStory, gustDuration } from './LeafGustStory';
import { HarvestBagStory, bagDuration } from './HarvestBagStory';
import { PressedLeafStory, pressedDuration } from './PressedLeafStory';
import { MarkStory, markDuration } from './MarkStory';
import { SketchStory, sketchDuration } from './SketchStory';
import { PinboardStory, pinboardDuration } from './PinboardStory';

const autumn: AutumnStoryProps = { holdSeconds: 8 };
// Riga Textile Mosaic 2026: the edition lists it from Friday 18 September, 9.00.
const mosaic: MosaicStoryProps = { title: ['RIGA TEXTILE', 'MOSAIC 2026'], kicker: 'textile art exhibition', when: 'OPENS 18 SEPTEMBER · 9.00', venue: 'VEF CULTURE PALACE · ROPAŽU IELA 2', price: 'FREE ENTRY', holdSeconds: 4 };
// Helsinki Baroque Orchestra, Friday 18 September.
const baroque: BaroqueStoryProps = { title: ['VICKY', 'CHOW'], kicker: "From New York With...", when: 'SUNDAY · 20 SEPTEMBER · 17.00', venue: 'HANZAS PERONS · HANZAS IELA 16A', price: '€40', holdSeconds: 8 };

const envelope: EnvelopeStoryProps = { day: 'FRIDAY', kicker: 'Overview', category: 'Arts & Culture', sheet: 'collage.png', holdSeconds: 6 };
const ticket: TicketStoryProps = { day: 'FRIDAY', date: '18 SEPTEMBER', number: '0918', kicker: 'Overview', category: 'Arts & Culture', count: 6, sheet: 'collage.png', holdSeconds: 6 };

// Rudzu Rīga, Saturday 19 September: a single-event story rather than the day grid.
const rye: RyeStoryProps = { day: 'SATURDAY', date: '19 SEPTEMBER', number: '0919', title: 'RUDZU RĪGA', kicker: 'rye & black humour', time: '14.00–16.00', price: 'FREE', sheet: 'collage.png', holdSeconds: 6 };

const press: PressStoryProps = { title: 'RUDZU RĪGA', kicker: 'rye & black humour', day: 'SATURDAY', date: '19 SEPTEMBER', time: '14.00–16.00', venue: 'TORŅA IELA 4/II B · VECRĪGA', price: 'FREE', holdSeconds: 5, burst: 'steamflour' };

// Medbaltica 2026, the medical fair at Ķīpsala, Thursday–Friday 24–25 September. Rust is that week's colour family.
const ecg: EcgStoryProps = { title: ['MEDBALTICA', '2026'], days: 'THU · FRI', when: '24–25 SEPTEMBER', venue: 'ĶĪPSALA · ĶĪPSALAS IELA 8', price: '€3–5', accent: '#ffcf70', background: '#1c0d06', holdSeconds: 4 };

// Researchers' Night, Friday 25 September, 16.00–22.00 at twelve venues. Same week as Medbaltica, so the same
// Rust family: its accent, and the darkest tone for the sky.
const researchers: ResearchersStoryProps = { title: ['RESEARCHERS’', 'NIGHT'], when: 'FRIDAY 25 SEPTEMBER', time: '16.00–22.00', where: '12 OPEN LABS ACROSS RĪGA', accent: '#ffcf70', background: ['#050304', '#140904'], liquid: ['#1fb5a5', '#7b4dff', '#ff3d7f', '#ff9d1f'], holdSeconds: 3 };

// Art Riga Fair 2026, Friday-Sunday 25-27 September at the Latvian Railway History Museum. Ember is the
// week's colour family, so the wash is its darkest tone and the accent its orange.
const artFair: ArtFairStoryProps = { title: ['ART RIGA', 'FAIR 2026'], when: 'FRI–SUN · 25–27 SEPTEMBER', time: '10.00–18.00', venue: ['LATVIAN RAILWAY HISTORY MUSEUM', 'UZVARAS BULVĀRIS 2A'], price: '€14.63 · CONCESSIONS €7.32', accent: '#c23a16', ink: '#241a14', rinse: '#6b5a72', canvas: '#e8dcc2', paints: ['#c9184a', '#0f8b86', '#e08a1e'], holdSeconds: 2 };

// The autumn and hands-on story openers take their sample props inline (below), not from a variable:
// Studio can only save edited default props back into this file when they're written out in place.

export const Root = () => (
  <>
    {/* Not a story: the source for public/cloth.png. See the note by ClothPlate. */}
    <Composition id="ClothPlate" component={ClothPlate} width={1080} height={1920} fps={30} durationInFrames={1} />
    {/* Source for public/parchment.png, same deal as ClothPlate. */}
    <Composition id="ParchmentPlate" component={ParchmentPlate} width={1080} height={1920} fps={30} durationInFrames={1} />
    <Composition
      id="MosaicStory"
      component={MosaicStory}
      width={1080}
      height={1920}
      fps={MOSAIC_FPS}
      durationInFrames={mosaicDuration(mosaic.holdSeconds)}
      defaultProps={mosaic}
      calculateMetadata={({ props }) => ({ durationInFrames: mosaicDuration(props.holdSeconds) })}
    />
    {/* Not a story: a test bench for public/mosaic-pieces. */}
    <Composition id="MosaicDemo" component={MosaicDemo} width={1080} height={1920} fps={30} durationInFrames={240} />
    <Composition
      id="BaroqueStory"
      component={BaroqueStory}
      width={1080}
      height={1920}
      fps={BAROQUE_FPS}
      durationInFrames={baroqueDuration(baroque.holdSeconds)}
      defaultProps={baroque}
      calculateMetadata={({ props }) => ({ durationInFrames: baroqueDuration(props.holdSeconds) })}
    />
    <Composition
      id="AutumnStory"
      component={AutumnStory}
      width={1080}
      height={1920}
      fps={AUTUMN_FPS}
      durationInFrames={autumnDuration(autumn.holdSeconds)}
      defaultProps={autumn}
      calculateMetadata={({ props }) => ({ durationInFrames: autumnDuration(props.holdSeconds) })}
    />
    {/* One composition per burst style, so comparing them is a click in the sidebar rather than an
        edit. `PressStory` itself keeps whichever style is set in `press` above. */}
    {['', ...BURSTS].map((k) => (
      <Composition
        key={k || 'default'}
        id={k ? `PressStory-${k}` : 'PressStory'}
        component={PressStory}
        width={1080}
        height={1920}
        fps={PRESS_FPS}
        durationInFrames={pressDuration(press.holdSeconds)}
        defaultProps={k ? { ...press, burst: k as typeof press.burst } : press}
        calculateMetadata={({ props }) => ({ durationInFrames: pressDuration(props.holdSeconds) })}
      />
    ))}
    <Composition
      id="RyeStory"
      component={RyeStory}
      width={1080}
      height={1920}
      fps={RYE_FPS}
      durationInFrames={ryeDuration(rye.holdSeconds)}
      defaultProps={rye}
      calculateMetadata={({ props }) => ({ durationInFrames: ryeDuration(props.holdSeconds) })}
    />
    <Composition
      id="TicketStory"
      component={TicketStory}
      width={1080}
      height={1920}
      fps={TICKET_FPS}
      durationInFrames={ticketDuration(ticket.holdSeconds)}
      defaultProps={ticket}
      calculateMetadata={({ props }) => ({ durationInFrames: ticketDuration(props.holdSeconds) })}
    />
    <Composition
      id="EnvelopeStory"
      component={EnvelopeStory}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={durationFor(envelope.holdSeconds)}
      defaultProps={envelope}
      calculateMetadata={({ props }) => ({ durationInFrames: durationFor(props.holdSeconds) })}
    />
    <Composition
      id="EcgStory"
      component={EcgStory}
      width={1080}
      height={1920}
      fps={ECG_FPS}
      durationInFrames={ecgDuration(ecg.holdSeconds)}
      defaultProps={ecg}
      calculateMetadata={({ props }) => ({ durationInFrames: ecgDuration(props.holdSeconds) })}
    />
    <Composition
      id="ResearchersStory"
      component={ResearchersStory}
      width={1080}
      height={1920}
      fps={RESEARCHERS_FPS}
      durationInFrames={researchersDuration(researchers.holdSeconds)}
      defaultProps={researchers}
      calculateMetadata={({ props }) => ({ durationInFrames: researchersDuration(props.holdSeconds) })}
    />
    <Composition
      id="ArtFairStory"
      component={ArtFairStory}
      width={1080}
      height={1920}
      fps={ARTFAIR_FPS}
      durationInFrames={artFairDuration(artFair.holdSeconds)}
      defaultProps={artFair}
      calculateMetadata={({ props }) => ({ durationInFrames: artFairDuration(props.holdSeconds) })}
    />
    <Composition id="LeafGustStory" component={LeafGustStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={gustDuration(3)} defaultProps={{ day: 'SATURDAY', date: '26 SEPTEMBER', kicker: 'Miķeļdiena', category: 'Harvest & markets', count: 4, sheet: 'collage.png', holdSeconds: 3 }}
      calculateMetadata={({ props }) => ({ durationInFrames: gustDuration(props.holdSeconds) })} />
    <Composition id="HarvestBagStory" component={HarvestBagStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={bagDuration(3)} defaultProps={{ day: 'SATURDAY', date: '26 SEPTEMBER', kicker: 'Miķeļdiena', category: 'Harvest & markets', count: 4, sheet: 'collage.png', holdSeconds: 3 }}
      calculateMetadata={({ props }) => ({ durationInFrames: bagDuration(props.holdSeconds) })} />
    <Composition id="MarkStory" component={MarkStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={markDuration(3)} defaultProps={{ day: 'SATURDAY', date: '26 SEPTEMBER', kicker: 'Hands-on', category: 'Workshops & dance', count: 4, sheet: 'collage.png', holdSeconds: 3 }}
      calculateMetadata={({ props }) => ({ durationInFrames: markDuration(props.holdSeconds) })} />
    <Composition id="SketchStory" component={SketchStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={sketchDuration(3)} defaultProps={{ day: 'SATURDAY', date: '26 SEPTEMBER', kicker: 'Hands-on', category: 'Workshops & dance', count: 4, sheet: 'collage.png', holdSeconds: 3 }}
      calculateMetadata={({ props }) => ({ durationInFrames: sketchDuration(props.holdSeconds) })} />
    <Composition id="PinboardStory" component={PinboardStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={pinboardDuration(3)}
      defaultProps={{
        day: 'SATURDAY',
        date: '26 SEPTEMBER',
        kicker: 'Hands-on',
        category: 'Workshops & dance',
        count: 4,
        sheet: 'collage.png',
        holdSeconds: 3,
        events: [{
          title: 'Churchill',
          when: 'Fri, 18 Sep · 19:00',
          price: '€30–40',
          venue: 'Dailes Theatre, New Hall, Brīvības iela 75',
          languages: ['LV'],
        }, {
          title: 'Helsinki Baroque Orchestra: Queen Christina\'s World',
          when: 'Fri, 18 Sep · 19:00',
          price: '€25–50',
          venue: 'House of Blackheads, Festive Hall, Rātslaukums 7',
          languages: ['EN', 'LV', 'RU'],
        }, {
          title: 'Riga Textile Mosaic 2026',
          when: 'Fri, 18 Sep · 09:00',
          price: 'Free',
          venue: 'VEF Culture Palace, Exhibition Halls, Ropažu iela 2',
          languages: ['EN', 'LV'],
        }, {
          title: 'Riga Acoustic Trio at MASA',
          when: 'Fri, 18 Sep · 20:00',
          price: '€20–110',
          venue: 'MASA Studio, Elizabetes iela 67',
          languages: ['EN', 'LV', 'RU'],
        }],
      }}
      calculateMetadata={({ props }) => ({ durationInFrames: pinboardDuration(props.holdSeconds) })} />
    <Composition id="PressedLeafStory" component={PressedLeafStory} width={1080} height={1920} fps={OPENER_FPS}
      durationInFrames={pressedDuration(3)} defaultProps={{ day: 'SATURDAY', date: '26 SEPTEMBER', kicker: 'Miķeļdiena', category: 'Harvest & markets', count: 4, sheet: 'collage.png', holdSeconds: 3 }}
      calculateMetadata={({ props }) => ({ durationInFrames: pressedDuration(props.holdSeconds) })} />
    <Composition
      id="Practice"
      component={Practice}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={150}
    />
    <Composition
      id="Practice2"
      component={Practice2x}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={150}
    />
    <Composition
      id="Practice3"
      component={Practice3x}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={150}
    />
    <Composition
      id="Practice4"
      component={Practice4x}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={150}
    />
    <Composition
      id="MuseumComposition"
      component={MuseumComposition}
      durationInFrames={178}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
