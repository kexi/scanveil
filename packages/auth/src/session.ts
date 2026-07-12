import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { productSessionCookieName } from "@scanveil/core";

export const sessionCookieName = productSessionCookieName;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 8): string {
  return [
    `${sessionCookieName}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function createExpiredSessionCookie(): string {
  return [
    `${sessionCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0",
  ].join("; ");
}

export function createSignedSessionToken(payload: string, secret: string): string {
  return createSignedSessionTokenWithExpiry(payload, secret);
}

export function createSignedSessionCookie(
  payload: string,
  secret: string,
  maxAgeSeconds = 60 * 60 * 8,
): string {
  return createSessionCookie(
    createSignedSessionTokenWithExpiry(payload, secret, maxAgeSeconds),
    maxAgeSeconds,
  );
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  const hasCookie = cookieHeader !== null && cookieHeader.length > 0;
  if (!hasCookie) {
    return undefined;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  const hasSessionCookie = cookie !== undefined;
  if (!hasSessionCookie) {
    return undefined;
  }

  return cookie.slice(sessionCookieName.length + 1);
}

export function readSignedSessionCookie(
  cookieHeader: string | null,
  secret: string,
): string | undefined {
  const token = readSessionCookie(cookieHeader);
  const hasToken = token !== undefined;
  if (!hasToken) {
    return undefined;
  }

  return verifySignedSessionToken(token, secret);
}

export function verifySignedSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): string | undefined {
  const [encodedPayload, signature, ...extraParts] = token.split(".");
  const hasTokenShape =
    encodedPayload !== undefined && signature !== undefined && extraParts.length === 0;
  if (!hasTokenShape) {
    return undefined;
  }

  const expectedSignature = signSessionPayload(encodedPayload, secret);
  const isValidSignature = secureEqual(signature, expectedSignature);
  if (!isValidSignature) {
    return undefined;
  }

  const payload = readSignedSessionPayload(encodedPayload);
  const hasPayload = payload !== undefined;
  if (!hasPayload) {
    return undefined;
  }

  const isExpired = payload.expiresAt <= now;
  if (isExpired) {
    return undefined;
  }

  return payload.value;
}

function createSignedSessionTokenWithExpiry(
  payload: string,
  secret: string,
  maxAgeSeconds = 60 * 60 * 8,
  now = Date.now(),
): string {
  const expiresAt = now + maxAgeSeconds * 1000;
  const signedPayload: SignedSessionPayload = { expiresAt, value: payload };
  const encodedPayload = Buffer.from(JSON.stringify(signedPayload), "utf8").toString("base64url");
  const signature = signSessionPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function readSignedSessionPayload(encodedPayload: string): SignedSessionPayload | undefined {
  try {
    const value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    const isPayload = isSignedSessionPayload(value);
    if (!isPayload) {
      return undefined;
    }

    return value;
  } catch {
    return undefined;
  }
}

function isSignedSessionPayload(value: unknown): value is SignedSessionPayload {
  const isObject = typeof value === "object" && value !== null;
  if (!isObject) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const hasValue = typeof record.value === "string";
  const hasExpiresAt = typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt);
  return hasValue && hasExpiresAt;
}

function signSessionPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function secureEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  const hasSameLength = valueBuffer.length === expectedBuffer.length;
  if (!hasSameLength) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

interface SignedSessionPayload {
  expiresAt: number;
  value: string;
}
