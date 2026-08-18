import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Claim } from '@contoso/shared';
import { ClaimsTable } from './ClaimsTable';

const claims: Claim[] = [
  {
    id: 'CLM-000001',
    policyNumber: 'POL-100234',
    claimantName: 'Dana Whitfield',
    claimType: 'auto',
    incidentDate: '2026-01-05T00:00:00.000Z',
    amountRequested: 4250,
    currency: 'USD',
    description: 'Rear-ended at a stop light.',
    status: 'submitted',
    riskScore: 20,
    createdAt: '2026-01-06T00:00:00.000Z',
    updatedAt: '2026-01-06T00:00:00.000Z',
  },
  {
    id: 'CLM-000002',
    policyNumber: 'POL-120771',
    claimantName: 'Northwind Logistics Ltd',
    claimType: 'liability',
    incidentDate: '2025-12-01T00:00:00.000Z',
    amountRequested: 64000,
    currency: 'USD',
    description: 'Third-party bodily injury alleged.',
    status: 'under_review',
    riskScore: 88,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('ClaimsTable', () => {
  it('renders a row per claim with formatted values', () => {
    render(<ClaimsTable claims={claims} onSelect={vi.fn()} />);

    expect(screen.getByRole('table', { name: 'Claims' })).toBeInTheDocument();
    expect(screen.getByText('CLM-000001')).toBeInTheDocument();
    expect(screen.getByText('Northwind Logistics Ltd')).toBeInTheDocument();
    expect(screen.getByText('$4,250')).toBeInTheDocument();
    expect(screen.getByText('$64,000')).toBeInTheDocument();
    expect(screen.getByTestId('status-submitted')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('status-under_review')).toHaveTextContent('Under review');
  });

  it('shows risk bands for each claim', () => {
    render(<ClaimsTable claims={claims} onSelect={vi.fn()} />);

    const meters = screen.getAllByRole('meter');
    expect(meters[0]).toHaveAttribute('data-band', 'low');
    expect(meters[1]).toHaveAttribute('data-band', 'high');
  });

  it('shows text risk bands in the list', () => {
    render(
      <ClaimsTable
        claims={[...claims, { ...claims[0], id: 'CLM-000003', riskScore: 34 }]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('calls onSelect when a row is clicked', async () => {
    const onSelect = vi.fn();
    render(<ClaimsTable claims={claims} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open claim CLM-000002' }));

    expect(onSelect).toHaveBeenCalledWith(claims[1]);
  });

  it('renders an empty state', () => {
    render(<ClaimsTable claims={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No claims match');
  });

  it('renders a loading state', () => {
    render(<ClaimsTable claims={[]} loading onSelect={vi.fn()} />);
    expect(screen.getByText(/Loading claims/)).toBeInTheDocument();
  });
});
