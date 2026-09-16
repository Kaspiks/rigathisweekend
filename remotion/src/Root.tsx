import { Composition } from 'remotion';
import { EnvelopeStory, FPS, durationFor, type EnvelopeStoryProps } from './EnvelopeStory';
import { TicketStory, TICKET_FPS, ticketDuration, type TicketStoryProps } from './TicketStory';

const envelope: EnvelopeStoryProps = { day: 'FRIDAY', kicker: 'Overview', category: 'Arts & Culture', sheet: 'collage.png', holdSeconds: 6 };
const ticket: TicketStoryProps = { day: 'FRIDAY', date: '18 SEPTEMBER', number: '0918', kicker: 'Overview', category: 'Arts & Culture', count: 6, sheet: 'collage.png', holdSeconds: 6 };

export const Root = () => (
  <>
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
  </>
);
