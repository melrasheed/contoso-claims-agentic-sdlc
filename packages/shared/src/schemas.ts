import { z } from 'zod';
import { CLAIM_STATUSES, CLAIM_TYPES } from './types.js';

/**
 * Validation schemas for every mutating claim payload.
 *
 * The API validates inbound requests with these schemas and the web client
 * reuses the inferred types, so both tiers stay in lockstep.
 */

/** Accepts an ISO-8601 date (`2026-01-31`) or date-time and normalises to an ISO timestamp. */
export const isoDateStringSchema = z
  .string()
  .trim()
  .min(1, 'A date is required')
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO-8601 date string',
  })
  .transform((value) => new Date(value).toISOString());

export const claimTypeSchema = z.enum(CLAIM_TYPES);
export const claimStatusSchema = z.enum(CLAIM_STATUSES);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO-4217 code');

export const amountSchema = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .finite('Amount must be a finite number')
  .positive('Amount must be greater than zero')
  .max(10_000_000, 'Amount exceeds the maximum insurable value');

/** Payload accepted by `POST /api/claims`. */
export const createClaimSchema = z
  .object({
    policyNumber: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,4}-[0-9]{4,8}$/, 'Policy number must look like POL-100234'),
    claimantName: z.string().trim().min(2, 'Claimant name is too short').max(120),
    claimType: claimTypeSchema,
    incidentDate: isoDateStringSchema,
    amountRequested: amountSchema,
    currency: currencySchema.default('USD'),
    description: z
      .string()
      .trim()
      .min(10, 'Please describe the incident in at least 10 characters')
      .max(2000),
  })
  .strict();

/** Payload accepted by `PATCH /api/claims/:id`. */
export const updateClaimSchema = z
  .object({
    claimantName: z.string().trim().min(2).max(120),
    claimType: claimTypeSchema,
    incidentDate: isoDateStringSchema,
    amountRequested: amountSchema,
    currency: currencySchema,
    description: z.string().trim().min(10).max(2000),
    status: claimStatusSchema,
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

/** Payload accepted by `POST /api/claims/:id/adjudicate`. */
export const adjudicateClaimSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    decidedBy: z.string().trim().min(2, 'Adjudicator name is required').max(120),
    rationale: z.string().trim().min(5, 'A rationale is required').max(2000),
    approvedAmount: z.number().finite().nonnegative().max(10_000_000).optional(),
  })
  .strict()
  .refine((value) => value.decision !== 'approved' || value.approvedAmount !== undefined, {
    message: 'approvedAmount is required when approving a claim',
    path: ['approvedAmount'],
  });

/** Query string accepted by `GET /api/claims`. */
export const claimQuerySchema = z
  .object({
    status: claimStatusSchema.optional(),
    claimType: claimTypeSchema.optional(),
  })
  .strip();

/** Payload accepted by `POST /api/admin/fault`. */
export const faultModeSchema = z.enum(['none', 'latency', 'error', 'memory']);

export const faultRequestSchema = z
  .object({
    mode: faultModeSchema,
    durationSeconds: z.number().int().positive().max(3600).optional(),
  })
  .strict();

export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;
export type AdjudicateClaimInput = z.infer<typeof adjudicateClaimSchema>;
export type ClaimQueryInput = z.infer<typeof claimQuerySchema>;
export type FaultMode = z.infer<typeof faultModeSchema>;
export type FaultRequestInput = z.infer<typeof faultRequestSchema>;
