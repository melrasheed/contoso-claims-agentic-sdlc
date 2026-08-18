import { calculateRiskScore, formatClaimId, type Claim } from '@contoso/shared';

/**
 * Deterministic, realistic demo data: 12 claims spanning every status and every
 * product line, with dates expressed relative to the current time so the
 * dashboard always looks "live".
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface SeedTemplate {
  policyNumber: string;
  claimantName: string;
  claimType: Claim['claimType'];
  amountRequested: number;
  currency?: string;
  description: string;
  status: Claim['status'];
  /** Days before "now" that the claim was filed. */
  filedDaysAgo: number;
  /** Days between the incident and the claim being filed. */
  reportingDelayDays: number;
  adjudication?: {
    decidedBy: string;
    rationale: string;
    approvedAmount: number;
    /** Days before "now" that the decision was made. */
    decidedDaysAgo: number;
  };
}

const TEMPLATES: readonly SeedTemplate[] = [
  {
    policyNumber: 'POL-100234',
    claimantName: 'Dana Whitfield',
    claimType: 'auto',
    amountRequested: 4250,
    description:
      'Rear-ended at a stop light on Elm Street. Bumper, tailgate and rear camera damaged; police report filed on scene.',
    status: 'submitted',
    filedDaysAgo: 1,
    reportingDelayDays: 1,
  },
  {
    policyNumber: 'POL-100987',
    claimantName: 'Marcus Feld',
    claimType: 'property',
    amountRequested: 28400,
    description:
      'Storm damage to roof and north-facing windows following overnight hail. Temporary tarpaulin installed by contractor.',
    status: 'submitted',
    filedDaysAgo: 2,
    reportingDelayDays: 3,
  },
  {
    policyNumber: 'POL-114552',
    claimantName: 'Aisha Rahman',
    claimType: 'health',
    amountRequested: 1875.4,
    description:
      'Emergency room visit and follow-up imaging after a fall at home. Itemised hospital invoice attached.',
    status: 'submitted',
    filedDaysAgo: 3,
    reportingDelayDays: 2,
  },
  {
    policyNumber: 'POL-120771',
    claimantName: 'Northwind Logistics Ltd',
    claimType: 'liability',
    amountRequested: 64000,
    description:
      'Third-party bodily injury alleged after a pallet fell from a loading dock. Legal counsel engaged; incident reported late by site manager.',
    status: 'under_review',
    filedDaysAgo: 6,
    reportingDelayDays: 41,
  },
  {
    policyNumber: 'POL-100455',
    claimantName: 'Elena Rossi',
    claimType: 'auto',
    amountRequested: 15900,
    description:
      'Vehicle written off after collision with a guard rail in heavy rain. Salvage assessment pending from approved garage.',
    status: 'under_review',
    filedDaysAgo: 8,
    reportingDelayDays: 5,
  },
  {
    policyNumber: 'POL-131002',
    claimantName: 'Grover Park Dental',
    claimType: 'property',
    amountRequested: 9200,
    currency: 'USD',
    description:
      'Water ingress from a burst supply line damaged reception flooring and two treatment room cabinets.',
    status: 'under_review',
    filedDaysAgo: 11,
    reportingDelayDays: 9,
  },
  {
    policyNumber: 'POL-140233',
    claimantName: 'Tobias Lindqvist',
    claimType: 'health',
    amountRequested: 6400,
    description:
      'Arthroscopic knee surgery and eight physiotherapy sessions following a sports injury. Pre-authorisation on file.',
    status: 'approved',
    filedDaysAgo: 16,
    reportingDelayDays: 4,
    adjudication: {
      decidedBy: 'S. Okafor',
      rationale: 'Treatment pre-authorised and within policy limits; provider is in network.',
      approvedAmount: 6100,
      decidedDaysAgo: 9,
    },
  },
  {
    policyNumber: 'POL-100678',
    claimantName: 'Priya Nair',
    claimType: 'auto',
    amountRequested: 2300,
    description:
      'Windscreen replacement and recalibration of lane-assist sensors after a stone chip spread across the glass.',
    status: 'approved',
    filedDaysAgo: 19,
    reportingDelayDays: 2,
    adjudication: {
      decidedBy: 'S. Okafor',
      rationale: 'Low value glass claim; approved under the fast-track threshold.',
      approvedAmount: 2300,
      decidedDaysAgo: 17,
    },
  },
  {
    policyNumber: 'POL-152119',
    claimantName: 'Harlan Vance',
    claimType: 'liability',
    amountRequested: 118000,
    description:
      'Professional indemnity notification relating to a disputed structural survey. Coverage position under review by counsel.',
    status: 'rejected',
    filedDaysAgo: 24,
    reportingDelayDays: 63,
    adjudication: {
      decidedBy: 'M. Duarte',
      rationale:
        'Notification received after the policy expiry date; no coverage under the claims-made wording.',
      approvedAmount: 0,
      decidedDaysAgo: 12,
    },
  },
  {
    policyNumber: 'POL-160884',
    claimantName: 'Bianca Toledo',
    claimType: 'property',
    amountRequested: 47500,
    description:
      'Fire damage to a detached garage and stored equipment. Fire service report indicates an electrical fault.',
    status: 'rejected',
    filedDaysAgo: 31,
    reportingDelayDays: 22,
    adjudication: {
      decidedBy: 'M. Duarte',
      rationale:
        'Loss location was not listed on the schedule of insured structures at the time of the fire.',
      approvedAmount: 0,
      decidedDaysAgo: 20,
    },
  },
  {
    policyNumber: 'POL-170345',
    claimantName: 'Ken Watanabe',
    claimType: 'health',
    amountRequested: 3100,
    description:
      'Outpatient cardiology consultation, stress test and prescribed medication following chest pain.',
    status: 'paid',
    filedDaysAgo: 44,
    reportingDelayDays: 1,
    adjudication: {
      decidedBy: 'S. Okafor',
      rationale: 'Fully covered outpatient benefit; settled directly with the provider.',
      approvedAmount: 3100,
      decidedDaysAgo: 38,
    },
  },
  {
    policyNumber: 'POL-100119',
    claimantName: 'Fatima Al-Sayed',
    claimType: 'auto',
    amountRequested: 8800,
    description:
      'Hail damage across bonnet, roof and both wing mirrors. Repair completed by an approved body shop.',
    status: 'paid',
    filedDaysAgo: 58,
    reportingDelayDays: 6,
    adjudication: {
      decidedBy: 'M. Duarte',
      rationale: 'Damage consistent with the reported weather event; settled less the $500 excess.',
      approvedAmount: 8300,
      decidedDaysAgo: 50,
    },
  },
];

function isoDaysAgo(reference: Date, days: number): string {
  return new Date(reference.getTime() - days * MS_PER_DAY).toISOString();
}

/** Builds the in-memory seed data set. */
export function createSeedClaims(reference: Date = new Date()): Claim[] {
  return TEMPLATES.map((template, index) => {
    const createdAt = isoDaysAgo(reference, template.filedDaysAgo);
    const incidentDate = isoDaysAgo(
      reference,
      template.filedDaysAgo + template.reportingDelayDays,
    );
    const updatedAt = template.adjudication
      ? isoDaysAgo(reference, template.adjudication.decidedDaysAgo)
      : createdAt;

    const claim: Claim = {
      id: formatClaimId(index + 1),
      policyNumber: template.policyNumber,
      claimantName: template.claimantName,
      claimType: template.claimType,
      incidentDate,
      amountRequested: template.amountRequested,
      currency: template.currency ?? 'USD',
      description: template.description,
      status: template.status,
      riskScore: calculateRiskScore({
        claimType: template.claimType,
        amountRequested: template.amountRequested,
        incidentDate,
        reportedAt: createdAt,
      }),
      createdAt,
      updatedAt,
    };

    if (template.adjudication) {
      claim.adjudication = {
        status: template.status,
        decidedBy: template.adjudication.decidedBy,
        decidedAt: isoDaysAgo(reference, template.adjudication.decidedDaysAgo),
        rationale: template.adjudication.rationale,
        approvedAmount: template.adjudication.approvedAmount,
      };
      claim.adjudications = [{ ...claim.adjudication }];
    }

    return claim;
  });
}

/** Number of claims created by {@link createSeedClaims}. */
export const SEED_CLAIM_COUNT = TEMPLATES.length;
