import { randomBytes } from "node:crypto";

const inviteCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const inviteCodeRandomLength = 20;
const inviteCodePrefix = "SV";

export function generateInviteCode(): string {
  const randomPart = generateInviteCodeRandomPart(inviteCodeRandomLength);
  const checkDigit = calculateInviteCodeCheckDigit(randomPart);
  return formatInviteCode(`${randomPart}${checkDigit}`);
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function hasValidInviteCodeCheckDigit(code: string): boolean {
  const compact = compactInviteCode(code);
  const hasExpectedLength = compact.length === inviteCodeRandomLength + 1;
  if (!hasExpectedLength) {
    return false;
  }

  const body = compact.slice(0, inviteCodeRandomLength);
  const checkDigit = compact.slice(inviteCodeRandomLength);
  const usesAlphabet = [...compact].every((character) => inviteCodeAlphabet.includes(character));
  if (!usesAlphabet) {
    return false;
  }

  return calculateInviteCodeCheckDigit(body) === checkDigit;
}

function generateInviteCodeRandomPart(length: number): string {
  const bytes = randomBytes(length);
  let output = "";
  for (const byte of bytes) {
    output += inviteCodeAlphabet[byte % inviteCodeAlphabet.length] ?? "2";
  }

  return output;
}

function calculateInviteCodeCheckDigit(value: string): string {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const alphabetIndex = inviteCodeAlphabet.indexOf(character);
    const isAlphabetCharacter = alphabetIndex >= 0;
    if (!isAlphabetCharacter) {
      throw new Error("Invite code contains an unsupported character");
    }

    sum += alphabetIndex * (index + 3);
  }

  return inviteCodeAlphabet[sum % inviteCodeAlphabet.length] ?? "2";
}

function formatInviteCode(value: string): string {
  const groups = value.match(/.{1,4}/g) ?? [value];
  return `${inviteCodePrefix}-${groups.join("-")}`;
}

function compactInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  const withoutPrefix = normalized.startsWith(`${inviteCodePrefix}-`)
    ? normalized.slice(inviteCodePrefix.length + 1)
    : normalized;
  return withoutPrefix.replaceAll("-", "");
}
