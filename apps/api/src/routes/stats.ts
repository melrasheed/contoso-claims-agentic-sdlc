import express from 'express';
import type { ClaimsRepository } from '../repository.js';

/** Portfolio aggregates for the dashboard stat cards. */
export function createStatsRouter(repository: ClaimsRepository): express.Router {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json(repository.stats());
  });

  return router;
}
