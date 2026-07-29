import { render, screen, fireEvent } from '@testing-library/react';
import VmaRibbon from '@/components/VmaRibbon';
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
  description: 'Det brinner i en industribyggnad.',
  instruction: 'Gå inomhus.',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  senderName: 'SOS Alarm',
  areas: ['Ljungby kommun'],
  web: '',
  expires: null,
  ...overrides,
});

describe('VmaRibbon', () => {
  // The normal state is no warning, and the site must look untouched then.
  it('renders nothing when there is no warning', () => {
    const { container } = render(<VmaRibbon alerts={[]} onOpen={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  // A VMA is issued when there is immediate danger to life or health, so it is
  // the one thing on this site allowed to interrupt.
  it('announces a live warning to assistive technology', () => {
    render(<VmaRibbon alerts={[alert()]} onOpen={jest.fn()} />);

    const ribbon = screen.getByRole('alert');
    expect(ribbon).toHaveTextContent('Viktigt meddelande till allmänheten');
    expect(ribbon).toHaveTextContent('Ljungby kommun');
  });

  // SR's schema has no headline, so `event` is what a reader sees.
  it('falls back through headline, event and a last resort', () => {
    const { rerender } = render(
      <VmaRibbon alerts={[alert({ headline: 'Gasutsläpp i hamnen' })]} onOpen={jest.fn()} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Gasutsläpp i hamnen');

    rerender(<VmaRibbon alerts={[alert({ headline: '', event: '' })]} onOpen={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Viktigt meddelande till allmänheten');
  });

  it('says how many there are when several are running', () => {
    render(
      <VmaRibbon
        alerts={[alert(), alert({ id: 'SRCAP-2', incidents: ['SRVMA-2'] })]}
        onOpen={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /läs mer \(2\)/i })).toBeInTheDocument();
  });

  it('opens the VMA view', () => {
    const onOpen = jest.fn();
    render(<VmaRibbon alerts={[alert()]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: /läs mer/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  // Nothing dismisses it. It leaves when SR says the warning is over.
  it('offers no way to dismiss it', () => {
    render(<VmaRibbon alerts={[alert()]} onOpen={jest.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/läs mer/i);
  });
});
