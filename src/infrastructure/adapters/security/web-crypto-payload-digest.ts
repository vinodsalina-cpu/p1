import type { PayloadDigestPort } from '../../../application/ports/outbound/payload-digest.port.ts';

export class WebCryptoPayloadDigest implements PayloadDigestPort {
  async sha256(rawBody: Uint8Array): Promise<string> {
    const body = new Uint8Array(rawBody.length);
    body.set(rawBody);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', body));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
