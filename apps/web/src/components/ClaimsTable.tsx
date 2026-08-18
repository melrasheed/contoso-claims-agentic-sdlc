import type { Claim } from '@contoso/shared';
import { claimTypeLabel, formatCurrency, formatDate } from '../format';
import { RiskIndicator } from './RiskIndicator';
import { StatusBadge } from './StatusBadge';

export interface ClaimsTableProps {
  claims: Claim[];
  selectedId?: string | null;
  loading?: boolean;
  onSelect: (claim: Claim) => void;
}

/** Sortable-looking, dense claims list. Rows open the detail drawer. */
export function ClaimsTable({
  claims,
  selectedId = null,
  loading = false,
  onSelect,
}: ClaimsTableProps): JSX.Element {
  if (loading) {
    return <p className="table-empty">Loading claims…</p>;
  }

  if (claims.length === 0) {
    return (
      <p className="table-empty" role="status">
        No claims match the current filters.
      </p>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="table" aria-label="Claims">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Claimant</th>
            <th scope="col">Type</th>
            <th scope="col">Incident</th>
            <th scope="col" className="table__cell--numeric">
              Requested
            </th>
            <th scope="col">Status</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr
              key={claim.id}
              className={claim.id === selectedId ? 'table__row is-selected' : 'table__row'}
              tabIndex={0}
              role="button"
              aria-label={`Open claim ${claim.id}`}
              onClick={() => onSelect(claim)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(claim);
                }
              }}
            >
              <td className="table__cell--id">{claim.id}</td>
              <td>{claim.claimantName}</td>
              <td>{claimTypeLabel(claim.claimType)}</td>
              <td>{formatDate(claim.incidentDate)}</td>
              <td className="table__cell--numeric">
                {formatCurrency(claim.amountRequested, claim.currency)}
              </td>
              <td>
                <StatusBadge status={claim.status} />
              </td>
              <td>
                <RiskIndicator score={claim.riskScore} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
