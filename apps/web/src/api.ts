import type {
  AdjudicateClaimInput,
  Claim,
  ClaimStats,
  ClaimStatus,
  ClaimType,
  CreateClaimInput,
  UpdateClaimInput,
} from '@contoso/shared';

/** Base URL of the claims API, overridable at build time. */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Array<{ path: string; message: string }>;
}

/** Error carrying the RFC 7807 payload returned by the API. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail | undefined;

  constructor(message: string, status: number, problem?: ProblemDetail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export interface ClaimListResponse {
  items: Claim[];
  count: number;
}

export interface ClaimFilters {
  status?: ClaimStatus | '';
  claimType?: ClaimType | '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError('Unable to reach the claims API. Is the service running?', 0);
  }

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const problem = (payload ?? {}) as ProblemDetail;
    const detail =
      problem.detail ?? problem.title ?? `Request failed with status ${response.status}`;
    throw new ApiError(detail, response.status, problem);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toQuery(filters: ClaimFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.claimType) params.set('claimType', filters.claimType);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const claimsApi = {
  list(filters: ClaimFilters = {}): Promise<ClaimListResponse> {
    return request<ClaimListResponse>(`/api/claims${toQuery(filters)}`);
  },

  get(id: string): Promise<Claim> {
    return request<Claim>(`/api/claims/${encodeURIComponent(id)}`);
  },

  create(input: CreateClaimInput): Promise<Claim> {
    return request<Claim>('/api/claims', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, patch: UpdateClaimInput): Promise<Claim> {
    return request<Claim>(`/api/claims/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  adjudicate(id: string, input: AdjudicateClaimInput): Promise<Claim> {
    return request<Claim>(`/api/claims/${encodeURIComponent(id)}/adjudicate`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  stats(): Promise<ClaimStats> {
    return request<ClaimStats>('/api/stats');
  },
};
