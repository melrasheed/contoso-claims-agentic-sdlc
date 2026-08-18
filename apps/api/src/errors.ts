/**
 * RFC 7807 "problem details" error types used across the API.
 */

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Array<{ path: string; message: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly errors: Array<{ path: string; message: string }> | undefined;

  constructor(
    status: number,
    title: string,
    detail: string,
    options: {
      type?: string;
      errors?: Array<{ path: string; message: string }>;
      cause?: unknown;
    } = {},
  ) {
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.type = options.type ?? `https://contoso.example/problems/${slug(title)}`;
    this.errors = options.errors;
  }

  static notFound(detail: string): ApiError {
    return new ApiError(404, 'Not Found', detail);
  }

  static badRequest(
    detail: string,
    errors?: Array<{ path: string; message: string }>,
  ): ApiError {
    return new ApiError(400, 'Bad Request', detail, errors ? { errors } : {});
  }

  static conflict(detail: string): ApiError {
    return new ApiError(409, 'Conflict', detail);
  }

  static forbidden(detail: string): ApiError {
    return new ApiError(403, 'Forbidden', detail);
  }

  static internal(detail: string): ApiError {
    return new ApiError(500, 'Internal Server Error', detail);
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
