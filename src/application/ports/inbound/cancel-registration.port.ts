import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.js';

export interface CancelRegistrationCommand {
  readonly credentialId: string;
  readonly signedAt: string;
  readonly signature: string;
  readonly rawBody: Uint8Array;
}

export interface CancelRegistrationResult {
  readonly disposition: 'cancelled' | 'duplicate' | 'pending-create' | 'stale';
  readonly receipt: RegistrationReceipt;
}

export interface CancelRegistrationPort {
  execute(command: CancelRegistrationCommand): Promise<CancelRegistrationResult>;
}

export interface CancelRegistrationHandler {
  execute(command: CancelRegistrationCommand): Promise<CancelRegistrationResult>;
}

export interface CancelRegistrationHandlerFactory {
  create(): CancelRegistrationHandler;
}