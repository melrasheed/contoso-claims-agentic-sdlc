import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CLAIM_STATUSES,
  CLAIM_TYPES,
  type AdjudicateClaimInput,
  type Claim,
  type ClaimStats,
  type ClaimStatus,
  type ClaimType,
  type CreateClaimInput,
} from '@contoso/shared';
import { ApiError, claimsApi, type ClaimFilters } from './api';
import { claimTypeLabel, statusLabel } from './format';
import { ClaimDetailDrawer } from './components/ClaimDetailDrawer';
import { ClaimsTable } from './components/ClaimsTable';
import { ErrorBanner } from './components/ErrorBanner';
import { NewClaimForm } from './components/NewClaimForm';
import { StatCards } from './components/StatCards';

interface LoadError {
  message: string;
  detail?: string | undefined;
}

export function App(): JSX.Element {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [stats, setStats] = useState<ClaimStats | null>(null);
  const [filters, setFilters] = useState<ClaimFilters>({ status: '', claimType: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, summary] = await Promise.all([
        claimsApi.list(filters),
        claimsApi.stats(),
      ]);
      setClaims(list.items);
      setStats(summary);
      setError(null);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setError({
        message: 'We could not load claims from the API.',
        detail: apiError
          ? `${apiError.status ? `HTTP ${apiError.status}: ` : ''}${apiError.message}`
          : 'Unexpected client error.',
      });
      setClaims([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedClaim = useMemo(
    () => claims.find((claim) => claim.id === selectedId) ?? null,
    [claims, selectedId],
  );

  const handleCreate = async (input: CreateClaimInput): Promise<void> => {
    setBusy(true);
    try {
      await claimsApi.create(input);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError({
        message: 'The claim could not be submitted.',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAdjudicate = async (
    id: string,
    input: AdjudicateClaimInput,
  ): Promise<void> => {
    setBusy(true);
    setDrawerError(null);
    try {
      await claimsApi.adjudicate(id, input);
      await load();
    } catch (caught) {
      setDrawerError(caught instanceof Error ? caught.message : 'Adjudication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async (id: string): Promise<void> => {
    setBusy(true);
    setDrawerError(null);
    try {
      await claimsApi.update(id, { status: 'paid' });
      await load();
    } catch (caught) {
      setDrawerError(caught instanceof Error ? caught.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            ◆
          </span>
          <div>
            <h1 className="app__title">Contoso Claims</h1>
            <p className="app__subtitle">Adjudication workbench</p>
          </div>
        </div>
        <div className="app__header-actions">
          <button type="button" className="button button--ghost" onClick={() => void load()}>
            Refresh
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? 'Close form' : 'Submit new claim'}
          </button>
        </div>
      </header>

      <main className="app__main">
        {error ? (
          <ErrorBanner
            message={error.message}
            detail={error.detail}
            onRetry={() => void load()}
            onDismiss={() => setError(null)}
          />
        ) : null}

        <StatCards stats={stats} loading={loading && !stats} />

        {showForm ? (
          <NewClaimForm
            busy={busy}
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        ) : null}

        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Claims</h2>
            <div className="filters">
              <label className="field field--inline">
                <span className="field__label">Status</span>
                <select
                  className="field__input"
                  value={filters.status ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      status: event.target.value as ClaimStatus | '',
                    }))
                  }
                >
                  <option value="">All statuses</option>
                  {CLAIM_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--inline">
                <span className="field__label">Type</span>
                <select
                  className="field__input"
                  value={filters.claimType ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      claimType: event.target.value as ClaimType | '',
                    }))
                  }
                >
                  <option value="">All types</option>
                  {CLAIM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {claimTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <ClaimsTable
            claims={claims}
            loading={loading}
            selectedId={selectedId}
            onSelect={(claim) => {
              setDrawerError(null);
              setSelectedId(claim.id);
            }}
          />
        </section>
      </main>

      <ClaimDetailDrawer
        claim={selectedClaim}
        busy={busy}
        error={drawerError}
        onClose={() => setSelectedId(null)}
        onAdjudicate={handleAdjudicate}
        onMarkPaid={handleMarkPaid}
      />
    </div>
  );
}
