import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  adjudicateClaimSchema,
  canAdjudicate,
  canTransition,
  claimQuerySchema,
  createClaimSchema,
  updateClaimSchema,
  type ClaimFilter,
} from '@contoso/shared';
import { ApiError } from '../errors.js';
import type { ClaimsRepository } from '../repository.js';
import type { FaultController } from '../faults.js';
import { faultInjection } from '../middleware/faultInjection.js';

export interface ClaimsRouterDeps {
  repository: ClaimsRepository;
  faultController: FaultController;
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createClaimsRouter({
  repository,
  faultController,
}: ClaimsRouterDeps): express.Router {
  const router = express.Router();

  // Deliberate fault injection is scoped to the business endpoints so that
  // /health and the admin controls stay reachable during an injected incident.
  router.use(faultInjection(faultController));

  router.get(
    '/',
    asyncHandler((req, res) => {
      const query = claimQuerySchema.parse(req.query);
      const filter: ClaimFilter = {};
      if (query.status) filter.status = query.status;
      if (query.claimType) filter.claimType = query.claimType;

      const items = repository.list(filter);
      res.json({ items, count: items.length, filter });
    }),
  );

  router.get(
    '/:id',
    asyncHandler((req, res) => {
      const claim = repository.get(req.params.id ?? '');
      if (!claim) throw ApiError.notFound(`Claim ${req.params.id} was not found.`);
      res.json(claim);
    }),
  );

  router.post(
    '/',
    asyncHandler((req, res) => {
      const input = createClaimSchema.parse(req.body);
      const claim = repository.create(input);
      res.status(201).location(`/api/claims/${claim.id}`).json(claim);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler((req, res) => {
      const id = req.params.id ?? '';
      const patch = updateClaimSchema.parse(req.body);
      const existing = repository.get(id);
      if (!existing) throw ApiError.notFound(`Claim ${id} was not found.`);

      if (patch.status && patch.status !== existing.status && !canTransition(existing.status, patch.status)) {
        throw ApiError.conflict(
          `Claim ${id} cannot move from ${existing.status} to ${patch.status}.`,
        );
      }

      const updated = repository.update(id, patch);
      if (!updated) throw ApiError.notFound(`Claim ${id} was not found.`);
      res.json(updated);
    }),
  );

  router.post(
    '/:id/adjudicate',
    asyncHandler((req, res) => {
      const id = req.params.id ?? '';
      const input = adjudicateClaimSchema.parse(req.body);
      const existing = repository.get(id);
      if (!existing) throw ApiError.notFound(`Claim ${id} was not found.`);

      if (!canAdjudicate(existing.status)) {
        throw ApiError.conflict(
          `Claim ${id} is already ${existing.status} and can no longer be adjudicated.`,
        );
      }

      if (
        input.decision === 'approved' &&
        input.approvedAmount !== undefined &&
        input.approvedAmount > existing.amountRequested
      ) {
        throw ApiError.badRequest(
          `Approved amount cannot exceed the requested amount of ${existing.amountRequested}.`,
          [{ path: 'approvedAmount', message: 'Must not exceed the requested amount' }],
        );
      }

      const updated = repository.adjudicate(id, input);
      if (!updated) throw ApiError.notFound(`Claim ${id} was not found.`);
      res.json(updated);
    }),
  );

  return router;
}
