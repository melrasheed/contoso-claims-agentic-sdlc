import { useEffect, useState } from 'react';
import { canAdjudicate, type AdjudicateClaimInput, type Claim } from '@contoso/shared';
import {
  claimTypeLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  statusLabel,
} from '../format';
import { RiskIndicator } from './RiskIndicator';
import { StatusBadge } from './StatusBadge';

export interface ClaimDetailDrawerProps {
  claim: Claim | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onAdjudicate: (id: string, input: AdjudicateClaimInput) => Promise<void> | void;
  onMarkPaid: (id: string) => Promise<void> | void;
}

const DEFAULT_ADJUDICATOR = 'Demo Adjuster';

/** Slide-over panel with the full claim record and adjudication controls. */
export function ClaimDetailDrawer({
  claim,
  busy = false,
  error = null,
  onClose,
  onAdjudicate,
  onMarkPaid,
}: ClaimDetailDrawerProps): JSX.Element | null {
  const [rationale, setRationale] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');

  useEffect(() => {
    setRationale('');
    setApprovedAmount(claim ? String(claim.amountRequested) : '');
  }, [claim]);

  if (!claim) return null;

  const decidable = canAdjudicate(claim.status);

  const submit = (decision: 'approved' | 'rejected'): void => {
    const input: AdjudicateClaimInput = {
      decision,
      decidedBy:
        claim.status === 'pending_second_approval' ? 'Demo Second Approver' : DEFAULT_ADJUDICATOR,
      rationale:
        rationale.trim().length >= 5
          ? rationale.trim()
          : decision === 'approved'
            ? 'Approved after review of the submitted evidence.'
            : 'Rejected after review of the submitted evidence.',
      ...(decision === 'approved'
        ? { approvedAmount: Number(approvedAmount || claim.amountRequested) }
        : {}),
    };

    void onAdjudicate(claim.id, input);
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Claim ${claim.id}`}>
        <header className="drawer__header">
          <div>
            <p className="drawer__eyebrow">{claim.id}</p>
            <h2 className="drawer__title">{claim.claimantName}</h2>
          </div>
          <button type="button" className="button button--ghost" onClick={onClose} aria-label="Close claim details">
            ✕
          </button>
        </header>

        {error ? (
          <p className="drawer__error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={claim.status} />
            </dd>
          </div>
          <div>
            <dt>Risk score</dt>
            <dd>
              <RiskIndicator score={claim.riskScore} />
            </dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>{claim.policyNumber}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{claimTypeLabel(claim.claimType)}</dd>
          </div>
          <div>
            <dt>Incident date</dt>
            <dd>{formatDate(claim.incidentDate)}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>{formatCurrency(claim.amountRequested, claim.currency)}</dd>
          </div>
          <div>
            <dt>Filed</dt>
            <dd>{formatDateTime(claim.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDateTime(claim.updatedAt)}</dd>
          </div>
        </dl>

        <section className="drawer__section">
          <h3>Description</h3>
          <p className="drawer__description">{claim.description}</p>
        </section>

        {claim.adjudications?.length ? (
          <section className="drawer__section">
            <h3>Adjudication history</h3>
            {claim.adjudications.map((decision) => (
              <div key={`${decision.decidedAt}-${decision.decidedBy}`}>
                <p className="drawer__description">
                  <strong>{statusLabel(decision.status)}</strong> by {decision.decidedBy} on{' '}
                  {formatDateTime(decision.decidedAt)} —{' '}
                  {formatCurrency(decision.approvedAmount, claim.currency)} approved.
                </p>
                <p className="drawer__description">{decision.rationale}</p>
              </div>
            ))}
          </section>
        ) : null}

        {decidable ? (
          <section className="drawer__section">
            <h3>Adjudicate</h3>
            <label className="field">
              <span className="field__label">Approved amount</span>
              <input
                className="field__input"
                type="number"
                min={0}
                max={claim.amountRequested}
                value={approvedAmount}
                onChange={(event) => setApprovedAmount(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Rationale</span>
              <textarea
                className="field__input"
                rows={3}
                value={rationale}
                placeholder="Why is this decision being made?"
                onChange={(event) => setRationale(event.target.value)}
              />
            </label>
            <div className="drawer__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => submit('approved')}
              >
                Approve
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={busy}
                onClick={() => submit('rejected')}
              >
                Reject
              </button>
            </div>
          </section>
        ) : (
          <p className="drawer__note">
            This claim is {statusLabel(claim.status).toLowerCase()} and can no longer be
            adjudicated.
          </p>
        )}

        {claim.status === 'approved' ? (
          <div className="drawer__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => void onMarkPaid(claim.id)}
            >
              Mark as paid
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}
