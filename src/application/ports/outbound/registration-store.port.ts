import type { Registration } from '../../../domain/entities/registration.entity.js';
import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.js';

export type RegistrationCommitResult =
  | { readonly kind: 'created'; readonly receipt: RegistrationReceipt }
  | { readonly kind: 'duplicate'; readonly receipt: RegistrationReceipt }
  | { readonly kind: 'conflict' };

/** One atomic registration + idempotency receipt write, implemented per database. */
export interface RegistrationStorePort {
  commitRegistration(
    registration: Registration,
    receipt: RegistrationReceipt,
  ): Promise<RegistrationCommitResult>;
}
