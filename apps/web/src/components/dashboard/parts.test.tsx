import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DemoBanner,
  EmptyState,
  ErrorState,
  GateChip,
  LiveBanner,
  PixelBlocks,
  SeverityChip,
  StatusChip,
} from './parts';

describe('SeverityChip', () => {
  it('labels each severity', () => {
    render(<SeverityChip severity="CRITICAL" />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });
});

describe('GateChip', () => {
  it.each(['PASS', 'FAIL', 'INCOMPLETE'] as const)('renders %s', (result) => {
    render(<GateChip result={result} />);
    expect(screen.getByText(result)).toBeInTheDocument();
  });
});

describe('StatusChip', () => {
  it('renders the status text', () => {
    render(<StatusChip status="DONE" />);
    expect(screen.getByText('DONE')).toBeInTheDocument();
  });
});

describe('PixelBlocks', () => {
  it('fills blocks proportionally to value/max', () => {
    const { container } = render(<PixelBlocks value={5} max={10} color="red" count={5} />);
    const blocks = container.querySelectorAll('.pixel-blocks span');
    expect(blocks).toHaveLength(10);
    const filled = container.querySelectorAll('.pixel-blocks span[data-filled]');
    expect(filled).toHaveLength(5);
    // accessible label uses the count when provided
    expect(container.querySelector('.pixel-blocks')).toHaveAttribute('aria-label', '5 items');
  });

  it('fills nothing when max is zero', () => {
    const { container } = render(<PixelBlocks value={3} max={0} color="red" />);
    expect(container.querySelectorAll('.pixel-blocks span[data-filled]')).toHaveLength(0);
  });
});

describe('Banners and states', () => {
  it('labels demo vs live banners distinctly', () => {
    const { unmount } = render(
      <>
        <DemoBanner>sample</DemoBanner>
        <LiveBanner>real</LiveBanner>
      </>
    );
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('SAMPLE DATA');
    expect(screen.getByTestId('live-banner')).toHaveTextContent('LIVE');
    unmount();
  });

  it('ErrorState shows a retry button when a handler is passed', () => {
    render(<ErrorState title="API offline" detail="down" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('EmptyState renders its title', () => {
    render(<EmptyState title="No repositories yet" detail="register one" />);
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
  });
});
