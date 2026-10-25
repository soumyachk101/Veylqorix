import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './logo';

describe('Logo', () => {
  it('renders an accessible SVG mark with the expected label', () => {
    render(<Logo />);
    const svg = screen.getByRole('img', { name: 'Veylqorix logo' });
    expect(svg).toBeInTheDocument();
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});
