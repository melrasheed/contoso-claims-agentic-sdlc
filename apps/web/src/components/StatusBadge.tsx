import type { ClaimStatus } from '@contoso/shared';
import { statusLabel } from '../format';

export interface StatusBadgeProps {
  status: ClaimStatus;
}

/** Colour-coded pill for a claim's lifecycle state. */
export function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  return (
    <span className={`badge badge--${status}`} data-testid={`status-${status}`}>
      {statusLabel(status)}
    </span>
  );
}
