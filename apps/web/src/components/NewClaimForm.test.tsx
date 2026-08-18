import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewClaimForm } from './NewClaimForm';

describe('NewClaimForm', () => {
  it('surfaces validation errors instead of submitting', async () => {
    const onSubmit = vi.fn();
    render(<NewClaimForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Submit claim' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(/Policy number must look like/)).toBeInTheDocument();
    expect(screen.getByText(/Claimant name is too short/)).toBeInTheDocument();
  });

  it('submits a validated payload', async () => {
    const onSubmit = vi.fn();
    render(<NewClaimForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Policy number'), 'POL-100234');
    await userEvent.type(screen.getByLabelText('Claimant name'), 'Dana Whitfield');
    await userEvent.selectOptions(screen.getByLabelText('Claim type'), 'property');
    await userEvent.type(screen.getByLabelText('Amount requested'), '4250');
    await userEvent.type(
      screen.getByLabelText('Description'),
      'Storm damage to the roof and two windows after overnight hail.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Submit claim' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      policyNumber: 'POL-100234',
      claimantName: 'Dana Whitfield',
      claimType: 'property',
      amountRequested: 4250,
      currency: 'USD',
    });
  });

  it('cancels without submitting', async () => {
    const onCancel = vi.fn();
    render(<NewClaimForm onSubmit={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
