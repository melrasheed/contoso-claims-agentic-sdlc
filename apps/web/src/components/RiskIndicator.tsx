import { riskBand } from '@contoso/shared';

export interface RiskIndicatorProps {
  score: number;
  /** Renders the numeric score alongside the meter. Defaults to true. */
  showValue?: boolean;
}

const BAND_LABELS = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
} as const;

/**
 * Risk meter using the shared banding rules:
 * green below 34, amber 34-66, red above 66.
 */
export function RiskIndicator({ score, showValue = true }: RiskIndicatorProps): JSX.Element {
  const band = riskBand(score);
  const clamped = Math.min(100, Math.max(0, score));

  return (
    <div className="risk" title={`${BAND_LABELS[band]} (${score}/100)`}>
      <div
        className={`risk__meter risk__meter--${band}`}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={BAND_LABELS[band]}
        data-band={band}
      >
        <span className="risk__fill" style={{ width: `${clamped}%` }} />
      </div>
      {showValue ? <span className="risk__value">{score}</span> : null}
    </div>
  );
}
