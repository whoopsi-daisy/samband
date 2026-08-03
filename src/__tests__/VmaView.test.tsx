import { render, screen, fireEvent } from '@testing-library/react';
import VmaView from '@/components/VmaView';
import { VmaAlert } from '@/types';

const alert = (overrides: Partial<VmaAlert> = {}): VmaAlert => ({
  id: 'SRCAP-1',
  incidents: ['SRVMA-1'],
  sent: '2026-07-29T10:00:00+02:00',
  status: 'Actual',
  msgType: 'Alert',
  scope: 'Public',
  event: 'Viktigt meddelande till allmänheten',
  headline: '',
  description: 'Det brinner i en industribyggnad i Ljungby.',
  instruction: 'Gå inomhus och stäng dörrar, fönster och ventilation.',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  senderName: 'SOS Alarm',
  areas: ['Ljungby kommun'],
  web: 'https://sverigesradio.se/vma',
  expires: null,
  ...overrides,
});

const view = (props: Partial<React.ComponentProps<typeof VmaView>> = {}) =>
  render(
    <VmaView
      alerts={[]}
      live={[]}
      failed={false}
      loading={false}
      onRetry={jest.fn()}
      {...props}
    />
  );

describe('VmaView', () => {
  // No warning is the normal state, and it must read as an answer rather than
  // as something that failed to load.
  it('says plainly when nothing is running', () => {
    view();
    expect(screen.getByText(/inget vma är utfärdat just nu/i)).toBeInTheDocument();
  });

  it('leads with what to do, which CAP keeps separate for that reason', () => {
    view({ alerts: [alert()], live: [alert()] });

    expect(screen.getByText('Det här ska du göra')).toBeInTheDocument();
    expect(screen.getByText(/gå inomhus/i)).toBeInTheDocument();
  });

  it('names the area a warning covers', () => {
    view({ alerts: [alert()], live: [alert()] });
    expect(screen.getByText('Ljungby kommun')).toBeInTheDocument();
  });

  // "We could not reach SR" and "there is no warning" are very different things
  // to tell someone standing in an emergency. With nothing to show and no way to
  // ask, the page must not claim the first.
  it('does not present an outage as an all-clear', () => {
    view({ failed: true });

    expect(screen.getByRole('alert')).toHaveTextContent(/vet inte just nu/i);
    expect(screen.queryByText(/inget vma är utfärdat just nu/i)).not.toBeInTheDocument();
  });

  it('points at radio and 112 when it cannot answer itself', () => {
    view({ failed: true });

    expect(screen.getByRole('alert')).toHaveTextContent(/p4/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/112/);
  });

  // A warning on screen changes what the outage means: the alert is real, it is
  // only its freshness that is in doubt.
  it('demotes the outage to a caveat when a warning is showing', () => {
    view({ alerts: [alert()], live: [alert()], failed: true });

    expect(screen.getByText(/kunde inte nå/i)).toBeInTheDocument();
    expect(screen.queryByText(/vet inte just nu/i)).not.toBeInTheDocument();
  });

  it('offers a retry when the source could not be reached', () => {
    const onRetry = jest.fn();
    view({ failed: true, onRetry });

    fireEvent.click(screen.getByRole('button', { name: /försök igen/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  // A cancelled or expired message is a record, not a warning, and belongs
  // under its own heading rather than beside the live ones.
  it('separates finished messages from live ones', () => {
    const cancelled = alert({ id: 'SRCAP-2', msgType: 'Cancel', incidents: ['SRVMA-2'] });
    view({ alerts: [alert(), cancelled], live: [alert()] });

    expect(screen.getByText(/inte aktuella just nu/i)).toBeInTheDocument();
    expect(screen.getByText('Återkallat')).toBeInTheDocument();
  });

  // The quarterly drill is the one people actually hear. Calling it a "test"
  // would tell someone standing outside during it the wrong thing.
  it('tells an exercise apart from a system test', () => {
    const drill = alert({ id: 'SRCAP-3', status: 'Exercise', incidents: ['SRVMA-3'] });
    view({ alerts: [drill], live: [] });
    expect(screen.getByText('Övning')).toBeInTheDocument();

    view({ alerts: [alert({ id: 'SRCAP-4', status: 'Test', incidents: ['SRVMA-4'] })], live: [] });
    expect(screen.getByText('Systemtest')).toBeInTheDocument();
  });

  // A real warning that has run out is a record, and must not wear the same
  // severity badge as one that is running.
  it('does not badge an expired warning with its severity', () => {
    view({ alerts: [alert({ expires: '2020-01-01T00:00:00Z' })], live: [] });

    expect(screen.getByText('Avslutat')).toBeInTheDocument();
    expect(screen.queryByText('Allvarlig fara')).not.toBeInTheDocument();
  });

  it('points at the authorities rather than presenting itself as the source', () => {
    view();

    expect(screen.getByRole('link', { name: /sverigesradio\.se\/vma/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /krisinformation\.se/i })).toBeInTheDocument();
    expect(screen.getByText(/ring 112/i)).toBeInTheDocument();
  });
});
