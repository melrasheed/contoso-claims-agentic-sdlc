import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, type ProblemDetail } from '../errors.js';
import type { Logger } from '../logger.js';
import { getRequestId } from './requestId.js';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Terminal 404 handler for unmatched routes. */
export function notFoundHandler() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
  };
}

/**
 * Central error handler. Every failure leaves the API as an RFC 7807 problem
 * document so clients (and the SRE agent) get a consistent shape.
 */
export function errorHandler(logger: Logger, exposeStack = false) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const problem = toProblemDetail(error, req);

    if (problem.status >= 500) {
      logger.error({ err: error, requestId: problem.traceId }, problem.detail ?? problem.title);
    } else {
      logger.warn({ requestId: problem.traceId, status: problem.status }, problem.detail ?? problem.title);
    }

    const body: ProblemDetail & { stack?: string } = { ...problem };
    if (exposeStack && error instanceof Error && error.stack) {
      body.stack = error.stack;
    }

    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(body);
  };
}

function toProblemDetail(error: unknown, req: Request): ProblemDetail {
  const traceId = getRequestId(req);
  const instance = req.originalUrl;

  if (error instanceof ZodError) {
    return {
      type: 'https://contoso.example/problems/validation-error',
      title: 'Validation Failed',
      status: 400,
      detail: 'The request payload did not pass validation.',
      instance,
      traceId,
      errors: error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }

  if (error instanceof ApiError) {
    const problem: ProblemDetail = {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.message,
      instance,
      traceId,
    };
    if (error.errors) problem.errors = error.errors;
    return problem;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return {
      type: 'https://contoso.example/problems/malformed-json',
      title: 'Bad Request',
      status: 400,
      detail: 'The request body could not be parsed as JSON.',
      instance,
      traceId,
    };
  }

  return {
    type: 'https://contoso.example/problems/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail: error instanceof Error ? error.message : 'An unexpected error occurred.',
    instance,
    traceId,
  };
}
