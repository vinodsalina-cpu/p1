import type { RegistrationCancellation } from '../../../domain/entities/registration-cancellation.entity.js';
import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.js';

export type CancellationApplyResult =
  | {
      readonly kind: 'cancelled' | 'pending-create' | 'stale';
      readonly receipt: RegistrationReceipt;
    }
  | { readonly kind: 'duplicate'; readonly receipt: RegistrationReceipt }
  | { readonly kind: 'conflict' };

/** Persists cancellation sequence state, including cancellation-before-create. */
export interface CancellationStorePort {
  applyCancellationAtomically(
    cancellation: RegistrationCancellation,
    receipt: RegistrationReceipt,
  ): Promise<CancellationApplyResult>;
}
