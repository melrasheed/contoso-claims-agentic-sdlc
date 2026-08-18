import { riskBand } from '@contoso/shared';

export interface RiskIndicatorProps {
  score: number;
  /** Renders the numeric score alongside the meter. Defaults to true. */
  showValue?: boolean;
  /** Renders the textual risk band alongside the meter. Defaults to false. */
  showBand?: boolean;
}

const BAND_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
} as const;

/**
 * Risk meter using the shared banding rules:
 * green below 34, amber 34-66, red above 66.
 */
export function RiskIndicator({
  score,
  showValue = true,
  showBand = false,
}: RiskIndicatorProps): JSX.Element {
  const band = riskBand(score);
  const clamped = Math.min(100, Math.max(0, score));

  return (
    <div className="risk" title={`${BAND_LABELS[band]} risk (${score}/100)`}>
      <div
        className={`risk__meter risk__meter--${band}`}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${BAND_LABELS[band]} risk`}
        data-band={band}
      >
        <span className="risk__fill" style={{ width: `${clamped}%` }} />
      </div>
      {showBand ? <span className="risk__band">{BAND_LABELS[band]}</span> : null}
      {showValue ? <span className="risk__value">{score}</span> : null}
    </div>
  );
}
