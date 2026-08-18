import type { ClaimStatus, ClaimType } from '@contoso/shared';

/** Presentation helpers shared by the dashboard components. */

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(parsed);
}

export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

const STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  pending_second_approval: 'Pending second approval',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

const TYPE_LABELS: Record<ClaimType, string> = {
  auto: 'Auto',
  property: 'Property',
  health: 'Health',
  liability: 'Liability',
};

export function statusLabel(status: ClaimStatus): string {
  return STATUS_LABELS[status];
}

export function claimTypeLabel(type: ClaimType): string {
  return TYPE_LABELS[type];
}
