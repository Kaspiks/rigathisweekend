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
  </>
);
