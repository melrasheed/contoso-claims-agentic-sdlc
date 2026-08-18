import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors.js';
import type { FaultController } from '../faults.js';

/**
 * Applies whatever fault is currently armed to the claims endpoints.
 *
 * ⚠️ Deliberate: this is the lever the Agentic SDLC demo pulls to create a
 * production-like incident (5xx spike, latency spike or memory growth) that
 * Azure Monitor detects and the Azure SRE Agent triages.
 */
export function faultInjection(controller: FaultController) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { mode } = controller.current();

    switch (mode) {
      case 'error':
        next(
          new ApiError(
            500,
            'Internal Server Error',
            'Injected fault: the claims service failed to load claims.',
            { type: 'https://contoso.example/problems/injected-fault' },
          ),
        );
        return;

      case 'latency': {
        const delayMs = controller.latencyMs();
        const timer = setTimeout(() => next(), delayMs);
        // Do not keep the event loop alive purely for an injected delay.
        timer.unref?.();
        req.on('close', () => clearTimeout(timer));
        return;
      }

      case 'memory':
        controller.allocate();
        next();
        return;

      default:
        next();
    }
  };
}
