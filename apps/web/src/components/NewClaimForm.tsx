import { useState, type FormEvent } from 'react';
import { CLAIM_TYPES, createClaimSchema, type CreateClaimInput } from '@contoso/shared';
import { claimTypeLabel } from '../format';

export interface NewClaimFormProps {
  busy?: boolean;
  onSubmit: (input: CreateClaimInput) => Promise<void> | void;
  onCancel: () => void;
}

interface FormState {
  policyNumber: string;
  claimantName: string;
  claimType: string;
  incidentDate: string;
  amountRequested: string;
  currency: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  policyNumber: '',
  claimantName: '',
  claimType: 'auto',
  incidentDate: new Date().toISOString().slice(0, 10),
  amountRequested: '',
  currency: 'USD',
  description: '',
};

/**
 * Claim intake form. Validation reuses the exact same zod schema the API
 * enforces, so the client and the service can never disagree.
 */
export function NewClaimForm({
  busy = false,
  onSubmit,
  onCancel,
}: NewClaimFormProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = (field: keyof FormState, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = createClaimSchema.safeParse({
      ...form,
      amountRequested: form.amountRequested === '' ? Number.NaN : Number(form.amountRequested),
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    void onSubmit(parsed.data);
    setForm(EMPTY_FORM);
  };

  return (
    <form className="card form" onSubmit={handleSubmit} aria-label="Submit a new claim" noValidate>
      <h2 className="form__title">Submit a new claim</h2>

      <div className="form__grid">
        <label className="field">
          <span className="field__label">Policy number</span>
          <input
            className="field__input"
            name="policyNumber"
            placeholder="POL-100234"
            value={form.policyNumber}
            onChange={(event) => setField('policyNumber', event.target.value)}
          />
          {errors.policyNumber ? (
            <span className="field__error">{errors.policyNumber}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Claimant name</span>
          <input
            className="field__input"
            name="claimantName"
            placeholder="Dana Whitfield"
            value={form.claimantName}
            onChange={(event) => setField('claimantName', event.target.value)}
          />
          {errors.claimantName ? (
            <span className="field__error">{errors.claimantName}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Claim type</span>
          <select
            className="field__input"
            name="claimType"
            value={form.claimType}
            onChange={(event) => setField('claimType', event.target.value)}
          >
            {CLAIM_TYPES.map((type) => (
              <option key={type} value={type}>
                {claimTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Incident date</span>
          <input
            className="field__input"
            type="date"
            name="incidentDate"
            value={form.incidentDate}
            onChange={(event) => setField('incidentDate', event.target.value)}
          />
          {errors.incidentDate ? (
            <span className="field__error">{errors.incidentDate}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Amount requested</span>
          <input
            className="field__input"
            type="number"
            name="amountRequested"
            min={0}
            step="0.01"
            placeholder="4250"
            value={form.amountRequested}
            onChange={(event) => setField('amountRequested', event.target.value)}
          />
          {errors.amountRequested ? (
            <span className="field__error">{errors.amountRequested}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Currency</span>
          <input
            className="field__input"
            name="currency"
            maxLength={3}
            value={form.currency}
            onChange={(event) => setField('currency', event.target.value)}
          />
          {errors.currency ? <span className="field__error">{errors.currency}</span> : null}
        </label>
      </div>

      <label className="field field--wide">
        <span className="field__label">Description</span>
        <textarea
          className="field__input"
          name="description"
          rows={3}
          placeholder="What happened?"
          value={form.description}
          onChange={(event) => setField('description', event.target.value)}
        />
        {errors.description ? <span className="field__error">{errors.description}</span> : null}
      </label>

      <div className="form__actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit claim'}
        </button>
      </div>
    </form>
  );
}
