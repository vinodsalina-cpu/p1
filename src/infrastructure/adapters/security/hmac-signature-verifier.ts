import type { SignatureVerifierPort, VerifyWebhookSignatureInput } from '../../../application/ports/outbound/signature-verifier.port.ts';

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export class HmacSignatureVerifier implements SignatureVerifierPort {
  async verify(input: VerifyWebhookSignatureInput): Promise<boolean> {
    if (!/^[0-9]{1,12}$/.test(input.signedAt) || !/^v1=[0-9a-fA-F]{64}$/.test(input.signature)) {
      return false;
    }

    const signedSeconds = Number(input.signedAt);
    const nowSeconds = Math.floor(input.now.getTime() / 1000);
    if (!Number.isSafeInteger(signedSeconds) || Math.abs(nowSeconds - signedSeconds) > MAX_CLOCK_SKEW_SECONDS) {
      return false;
    }

    const prefix = new TextEncoder().encode(`${input.signedAt}.`);
    const message = new Uint8Array(prefix.length + input.rawBody.length);
    message.set(prefix, 0);
    message.set(input.rawBody, prefix.length);
    const secret = new Uint8Array(input.secret.length);
    secret.set(input.secret);
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      secret,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, message));
    const supplied = hexToBytes(input.signature.slice(3));
    return constantTimeEqual(digest, supplied);
  }
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}