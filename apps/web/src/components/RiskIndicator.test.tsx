import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskIndicator } from './RiskIndicator';

describe('RiskIndicator', () => {
  it.each([
    [12, 'low'],
    [33, 'low'],
    [34, 'medium'],
    [66, 'medium'],
    [67, 'high'],
    [99, 'high'],
  ])('renders score %i in the %s band', (score, band) => {
    render(<RiskIndicator score={score} />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('data-band', band);
    expect(meter).toHaveAttribute('aria-valuenow', String(score));
    expect(screen.getByText(String(score))).toBeInTheDocument();
  });

  it.each([
    [33, 'Low'],
    [34, 'Medium'],
    [67, 'High'],
  ])('renders the %s text label when requested', (score, label) => {
    render(<RiskIndicator score={score} showBand />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('can hide the numeric value', () => {
    render(<RiskIndicator score={50} showValue={false} />);
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });
});
