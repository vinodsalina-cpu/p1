import { createClient } from "npm:@supabase/supabase-js@2";
import { CancelRegistrationUseCase } from "../../../src/application/use-cases/cancel-registration.usecase.js";
import { ReceiveRegistrationUseCase } from "../../../src/application/use-cases/receive-registration.usecase.js";
import type { SupabaseRpcClient } from "../../../src/infrastructure/adapters/database/supabase-registration-store.adapter.js";
import {
  SupabaseCancellationStoreAdapter,
  SupabaseRegistrationStoreAdapter,
} from "../../../src/infrastructure/adapters/database/supabase-registration-store.adapter.js";
import { HmacSignatureVerifier } from "../../../src/infrastructure/adapters/security/hmac-signature-verifier.js";
import {
  parseWebhookCredentials,
  TenantCredentialResolver,
} from "../../../src/infrastructure/adapters/security/tenant-credential-resolver.js";
import { WebCryptoPayloadDigest } from "../../../src/infrastructure/adapters/security/web-crypto-payload-digest.js";
import { providerRegistrationCancellationsHandler } from "../../../src/infrastructure/handlers/api-gateway/provider-registrations-cancellations.js";
import { providerRegistrationsHandler } from "../../../src/infrastructure/handlers/api-gateway/provider-registrations.js";

type CallbackType = "registration" | "cancellation";

const supabase = createClient(
  requiredEnvironment("SUPABASE_URL"),
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const rpcClient: SupabaseRpcClient = {
  async rpc(functionName, args) {
    const { data, error } = await supabase.rpc(functionName, args);
    return { data, error: error ? { message: error.message } : null };
  },
};
const credentials = new TenantCredentialResolver(
  parseWebhookCredentials(requiredEnvironment("WEBHOOK_CREDENTIALS")),
);
const registrationStore = new SupabaseRegistrationStoreAdapter(rpcClient);
const cancellationStore = new SupabaseCancellationStoreAdapter(rpcClient);
const signatureVerifier = new HmacSignatureVerifier();
const digest = new WebCryptoPayloadDigest();
const clock = { now: () => new Date() };
const ids = { nextId: () => crypto.randomUUID() };
const receiveRegistration = new ReceiveRegistrationUseCase(
  credentials,
  signatureVerifier,
  registrationStore,
  digest,
  ids,
  clock,
);
const cancelRegistration = new CancelRegistrationUseCase(
  credentials,
  signatureVerifier,
  cancellationStore,
  digest,
  ids,
  clock,
);

export function handleProviderCallback(
  request: Request,
  eventType: CallbackType,
): Promise<Response> {
  return eventType === "registration"
    ? providerRegistrationsHandler(request, receiveRegistration)
    : providerRegistrationCancellationsHandler(request, cancelRegistration);
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
