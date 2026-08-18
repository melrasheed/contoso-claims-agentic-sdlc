import type { ClaimStats } from '@contoso/shared';
import { formatCurrency } from '../format';

export interface StatCardsProps {
  stats: ClaimStats | null;
  loading?: boolean;
}

interface Card {
  label: string;
  value: string;
  hint: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
}

function buildCards(stats: ClaimStats): Card[] {
  return [
    {
      label: 'Total claims',
      value: String(stats.totalClaims),
      hint: `${stats.openClaims} awaiting a decision`,
      tone: 'neutral',
    },
    {
      label: 'Requested',
      value: formatCurrency(stats.totalAmountRequested),
      hint: `${formatCurrency(stats.totalAmountApproved)} approved to date`,
      tone: 'positive',
    },
    {
      label: 'Average risk',
      value: String(stats.averageRiskScore),
      hint: 'Portfolio-wide risk score (0-100)',
      tone: 'warning',
    },
    {
      label: 'High risk',
      value: String(stats.highRiskCount),
      hint: 'Claims scoring above 66',
      tone: 'critical',
    },
  ];
}

/** Headline portfolio metrics. */
export function StatCards({ stats, loading = false }: StatCardsProps): JSX.Element {
  if (loading || !stats) {
    return (
      <section className="stat-grid" aria-label="Portfolio summary">
        {[0, 1, 2, 3].map((index) => (
          <article key={index} className="stat-card stat-card--skeleton" aria-hidden="true">
            <span className="stat-card__label">Loading</span>
            <span className="stat-card__value">—</span>
          </article>
        ))}
      </section>
    );
  }

  return (
    <section className="stat-grid" aria-label="Portfolio summary">
      {buildCards(stats).map((card) => (
        <article key={card.label} className={`stat-card stat-card--${card.tone}`}>
          <span className="stat-card__label">{card.label}</span>
          <span className="stat-card__value">{card.value}</span>
          <span className="stat-card__hint">{card.hint}</span>
        </article>
      ))}
    </section>
  );
}
