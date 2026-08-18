import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { faultRequestSchema } from '@contoso/shared';
import type { AppConfig } from '../config.js';
import { ApiError } from '../errors.js';
import type { FaultController } from '../faults.js';
import type { Logger } from '../logger.js';

export interface AdminRouterDeps {
  faultController: FaultController;
  config: AppConfig;
  logger: Logger;
}

/**
 * ⚠️ DELIBERATE FAULT INJECTION - DEMO SURFACE, NOT A BUG.
 *
 * These endpoints let the Agentic SDLC demo arm a production-like failure
 * (5xx, latency or memory growth) on the claims endpoints so that Azure Monitor
 * raises an alert and the Azure SRE Agent can detect, triage and remediate it.
 *
 * Safety rails:
 *  - the whole router is gated behind `ADMIN_ENABLED` (default: off in production);
 *  - every fault auto-expires after `durationSeconds` (default 300s);
 *  - `mode: "none"` (or DELETE) clears the fault and releases retained memory.
 */
export function createAdminRouter({
  faultController,
  config,
  logger,
}: AdminRouterDeps): express.Router {
  const router = express.Router();

  router.use((_req: Request, _res: Response, next: NextFunction) => {
    if (!config.adminEnabled) {
      next(
        ApiError.forbidden(
          'Admin fault-injection endpoints are disabled. Set ADMIN_ENABLED=true to enable them.',
        ),
      );
      return;
    }
    next();
  });

  router.get('/fault', (_req, res) => {
    res.json(faultController.current());
  });

  router.post('/fault', (req, res) => {
    const input = faultRequestSchema.parse(req.body);
    const state = faultController.activate(input.mode, input.durationSeconds);

    logger.warn(
      { fault: state.mode, expiresAt: state.expiresAt },
      'Fault injection state changed (deliberate demo control)',
    );

    res.json(state);
  });

  router.delete('/fault', (_req, res) => {
    faultController.reset();
    logger.warn('Fault injection cleared (deliberate demo control)');
    res.json(faultController.current());
  });

  return router;
}
