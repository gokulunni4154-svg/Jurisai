// src/app/billing/firms/new/page.tsx
// NEW FILE, THIS SESSION — firm-creation UI.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - POST /api/billing/firms (route.ts, pasted this session) -> real
//     request handling: `createFirmSchema.parse(body)` then
//     `firmService.createFirm(input)`, response `{ data: firm }` at 201.
//   - FirmService#createFirm() (firm.service.ts, pasted this session) ->
//     confirms CreateFirmInput is effectively just `{ name }` (the only
//     field read off `input` in that method), and confirms the real
//     failure mode when the caller already owns/belongs to a firm:
//     ConflictError('You already belong to a firm.', { profileId,
//     existingFirmId }) — a real 409, not a generic error.
//   - `firms` Row shape, via database.types.ts (decoded this session):
//     id, name, owner_id, created_at, updated_at.
//
// FLAGGED, NOT INDEPENDENTLY CONFIRMED: `createFirmSchema` itself
// (billing.schemas.ts) was never pasted — same category of gap as
// createCheckoutSchema in the checkout page. This form sends `{ name }`
// on the assumption the real schema matches CreateFirmInput's only
// referenced field.
//
// RESOLVED, THIS SESSION — GET /api/billing/firms/mine now exists
// (route.ts + FirmService#getMyFirm(), both new this session), closing
// the gap this file's header used to describe. On a real ConflictError
// from POST /api/billing/firms (caller already owns/belongs to a firm),
// this page now calls that route directly instead of asking the user to
// type an ID in manually. The manual-ID fallback below is NOT fully
// removed — see the flagged edge case in the conflict handler itself for
// why a narrow version of it still exists.
//
// FLAGGED, IMPORTANT — inherited directly from getMyFirm()'s own doc
// comment: that method checks firms.owner_id (ownership), but
// createFirm()'s ConflictError fires whenever profiles.firm_id is set
// (membership), which this project's firm.service.ts documents as
// deliberately true for owners but not proven exclusive to them. If a
// user is ever a MEMBER of a firm they don't own (no path in this
// project's pasted source currently creates that state), they'd hit the
// conflict here but GET /api/billing/firms/mine would return `data:
// null` for them — a real seam, not a bug in this page. The manual-ID
// input is kept as a last-resort fallback for exactly that narrow case,
// shown only when the automatic lookup comes back empty despite a
// conflict having just occurred.

'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

interface FirmRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface CreateFirmResponse {
  data: FirmRow;
}

// NEW, THIS SESSION — matches GET /api/billing/firms/mine's real
// response shape: `{ data: firm }` at 200, `data: null` when the caller
// doesn't own a firm (mirrors CreateFirmResponse's shape, but `data` is
// nullable here since "no owned firm" is a valid response, not an error).
interface GetMyFirmResponse {
  data: FirmRow | null;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

export default function NewFirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Carried through from pricing/page.tsx's firm-plan CTA, if that's
  // where the visitor came from — lets this page hand off straight into
  // checkout once the firm exists, instead of dead-ending at "firm
  // created" with no next step.
  const planSlug = searchParams.get('planSlug');

  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [createdFirm, setCreatedFirm] = useState<FirmRow | null>(null);

  // NEW, THIS SESSION — drives the automatic GET /api/billing/firms/mine
  // lookup that now runs on conflict, replacing what used to be an
  // always-shown manual input.
  const [isLookingUpFirm, setIsLookingUpFirm] = useState(false);
  const [myFirm, setMyFirm] = useState<FirmRow | null>(null);
  // true once the lookup has actually run and come back empty — the
  // signal to fall back to the manual input, per this file's own flagged
  // ownership-vs-membership edge case.
  const [lookupCameBackEmpty, setLookupCameBackEmpty] = useState(false);

  // FLAGGED, narrow fallback — kept only for the edge case where the
  // caller hit the ConflictError (profiles.firm_id is set) but
  // GET /api/billing/firms/mine came back null (they're a member, not an
  // owner). See file header for why this seam exists.
  const [manualFirmId, setManualFirmId] = useState('');

  // NEW, THIS SESSION — calls the real GET /api/billing/firms/mine.
  // Invoked automatically on conflict rather than waiting for the user
  // to do anything, since the whole point of closing gap #1 was to
  // remove the manual step.
  const lookupMyFirm = async () => {
    setIsLookingUpFirm(true);
    setLookupCameBackEmpty(false);
    try {
      const res = await fetch('/api/billing/firms/mine', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: GetMyFirmResponse = await res.json();
      if (json.data) {
        setMyFirm(json.data);
        if (planSlug) {
          router.push(`/billing/checkout?planSlug=${planSlug}&firmId=${json.data.id}`);
        }
      } else {
        // FLAGGED — this is the edge case from the file header:
        // ConflictError fired (profiles.firm_id is set) but this lookup
        // (firms.owner_id) came back empty. Falls through to the manual
        // input rather than erroring outright.
        setLookupCameBackEmpty(true);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not look up your firm.');
      setLookupCameBackEmpty(true);
    } finally {
      setIsLookingUpFirm(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    setIsConflict(false);
    setMyFirm(null);
    setLookupCameBackEmpty(false);
    try {
      const res = await fetch('/api/billing/firms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setIsConflict(true);
          setIsSubmitting(false);
          // Fire the automatic lookup right away — no separate user
          // action required before we try to resolve this ourselves.
          await lookupMyFirm();
          return;
        }
        throw new Error(await extractErrorMessage(res));
      }
      const json: CreateFirmResponse = await res.json();
      setCreatedFirm(json.data);
      if (planSlug) {
        router.push(`/billing/checkout?planSlug=${planSlug}&firmId=${json.data.id}`);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create firm.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinueWithManualId = () => {
    if (!planSlug || !manualFirmId.trim()) return;
    router.push(`/billing/checkout?planSlug=${planSlug}&firmId=${manualFirmId.trim()}`);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <button
          onClick={() => router.back()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-serif text-[22px] leading-none text-foreground">Create your firm</h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-md">
          {createdFirm && !planSlug ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <h2 className="font-serif text-[18px] text-foreground">Firm created</h2>
              <p className="text-[13px] text-muted-foreground">
                {createdFirm.name} is ready. You can check out a firm plan for it from the
                pricing page.
              </p>
              <button
                onClick={() => router.push('/pricing')}
                className="mt-2 flex items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
              >
                Go to plans
              </button>
            </div>
          ) : isConflict ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>You already belong to a firm.</span>
              </div>

              {isLookingUpFirm ? (
                <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <p className="text-[13px]">Looking up your firm…</p>
                </div>
              ) : myFirm && !planSlug ? (
                // Found via GET /api/billing/firms/mine, but there's no
                // planSlug to hand off into checkout with — just confirm
                // which firm it found.
                <div className="rounded-lg border border-border bg-card p-5">
                  <p className="text-[13px] text-muted-foreground">
                    You already own <span className="text-foreground">{myFirm.name}</span>.
                  </p>
                  <button
                    onClick={() => router.push('/pricing')}
                    className="mt-4 flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
                  >
                    Go to plans
                  </button>
                </div>
              ) : lookupCameBackEmpty && planSlug ? (
                // FLAGGED — the automatic lookup came back empty despite
                // the conflict (ownership-vs-membership seam, see file
                // header). Manual input kept only for this narrow case.
                <div className="rounded-lg border border-border bg-card p-5">
                  <p className="text-[13px] text-muted-foreground">
                    We couldn&apos;t automatically find a firm you own — you may belong to
                    one as a member instead. If you know its ID, you can enter it below to
                    continue to checkout.
                  </p>
                  <div className="mt-4 flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-muted-foreground" htmlFor="manualFirmId">
                      Existing firm ID
                    </label>
                    <input
                      id="manualFirmId"
                      value={manualFirmId}
                      onChange={(e) => setManualFirmId(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <button
                    onClick={handleContinueWithManualId}
                    disabled={!manualFirmId.trim()}
                    className="mt-4 flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue to checkout
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground" htmlFor="firmName">
                  Firm name
                </label>
                <input
                  id="firmName"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {submitError && !isConflict && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isSubmitting ? 'Creating…' : 'Create firm'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}