import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubWebhookSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  const hasSignature = signatureHeader !== undefined && signatureHeader.startsWith("sha256=");
  if (!hasSignature) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  const hasSameLength = expectedBuffer.length === actualBuffer.length;
  if (!hasSameLength) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function readGitHubEvent(headers: Headers): { event: string; deliveryId: string } {
  const event = headers.get("x-github-event") ?? "unknown";
  const deliveryId = headers.get("x-github-delivery") ?? "unknown";
  return { event, deliveryId };
}
