import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Claim, ClaimStats } from '@contoso/shared';
import { App } from './App';

const claims: Claim[] = [
  {
    id: 'CLM-000001',
    policyNumber: 'POL-100234',
    claimantName: 'Dana Whitfield',
    claimType: 'auto',
    incidentDate: '2026-01-05T00:00:00.000Z',
    amountRequested: 4250,
    currency: 'USD',
    description: 'Rear-ended at a stop light on Elm Street.',
    status: 'submitted',
    riskScore: 20,
    createdAt: '2026-01-06T00:00:00.000Z',
    updatedAt: '2026-01-06T00:00:00.000Z',
  },
];

const stats: ClaimStats = {
  totalClaims: 1,
  byStatus: { submitted: 1, under_review: 0, approved: 0, rejected: 0, paid: 0 },
  byType: { auto: 1, property: 0, health: 0, liability: 0 },
  totalAmountRequested: 4250,
  totalAmountApproved: 0,
  averageRiskScore: 20,
  highRiskCount: 0,
  openClaims: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockApi(handler: (url: string) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))),
  );
}

beforeEach(() => {
  mockApi((url) =>
    url.includes('/api/stats') ? jsonResponse(stats) : jsonResponse({ items: claims, count: 1 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the dashboard with stats and claims', async () => {
    render(<App />);

    expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Total claims')).toBeInTheDocument();
    expect(screen.getAllByText('$4,250').length).toBeGreaterThan(0);
    expect(screen.getByTestId('status-submitted')).toBeInTheDocument();
  });

  it('shows an error banner when the API fails (fault injection active)', async () => {
    mockApi(() =>
      jsonResponse(
        {
          title: 'Internal Server Error',
          status: 500,
          detail: 'Injected fault: the claims service failed to load claims.',
        },
        500,
      ),
    );

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not load claims from the API.');
    expect(alert).toHaveTextContent('Injected fault');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('opens the detail drawer with adjudication actions', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open claim CLM-000001' }));

    const drawer = await screen.findByRole('dialog', { name: 'Claim CLM-000001' });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByText('POL-100234')).toBeInTheDocument();
  });

  it('toggles the new claim form', async () => {
    render(<App />);
    await screen.findByText('Dana Whitfield');

    await userEvent.click(screen.getByRole('button', { name: 'Submit new claim' }));
    expect(screen.getByRole('form', { name: 'Submit a new claim' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close form' }));
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Submit a new claim' })).not.toBeInTheDocument();
    });
  });

  it('requests filtered claims when a status filter is chosen', async () => {
    render(<App />);
    await screen.findByText('Dana Whitfield');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'paid');

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.some(([url]) => String(url).includes('status=paid'))).toBe(true);
    });
  });
});
