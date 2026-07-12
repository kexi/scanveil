import {
  fetchGitHubUserOrganizations,
  fetchGitHubUserRepositories,
  type GitHubOrganization,
  type GitHubUserRepository,
} from "@scanveil/auth";
import { hasValidInviteCodeCheckDigit, normalizeInviteCode } from "@scanveil/core";
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export interface ConsoleUserSession {
  accessibleRepositoryIds?: number[];
  accessibleRepositoryFullNames?: string[];
  githubLogin: string;
  githubOAuthToken?: string;
  githubUserId: string;
  organizationLogins?: string[];
}

export interface RepositoryAccessRefreshDependencies {
  fetchOrganizations: (token: string) => Promise<GitHubOrganization[]>;
  fetchRepositories: (token: string) => Promise<GitHubUserRepository[]>;
}

const defaultRepositoryAccessRefreshDependencies: RepositoryAccessRefreshDependencies = {
  fetchOrganizations: fetchGitHubUserOrganizations,
  fetchRepositories: fetchGitHubUserRepositories,
};

export interface InviteAccess {
  code: string;
  codeName: string;
  githubLogin: string;
  githubUserId: string;
  redeemedAt: string;
}

interface InviteUserRecord {
  accessibleRepositoryFullNames?: unknown;
  accessibleRepositoryIds?: unknown;
  disabled?: boolean;
  firstLoginAt?: string;
  firstSeenAt?: string;
  organizationLogins?: unknown;
  repositoryAccessRefreshedAt?: string;
  registeredAt?: string;
}

export class InviteRequiredError extends Error {
  constructor() {
    super("invite_required");
  }
}

export class UserDisabledError extends Error {
  constructor() {
    super("user_disabled");
  }
}

export class InviteAccessRevokedError extends Error {
  readonly reason: "invite_disabled" | "invite_not_found";

  constructor(reason: InviteAccessRevokedError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

export class RepositoryAccessExpiredError extends Error {
  constructor() {
    super("repository_access_expired");
  }
}

export class InviteRedeemError extends Error {
  readonly reason: "invite_disabled" | "invite_full" | "invite_not_found" | "invalid_code";

  constructor(reason: InviteRedeemError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

export function parseConsoleUserSession(session: string): ConsoleUserSession | undefined {
  const isVersionedSession = session.startsWith("v2:");
  if (isVersionedSession) {
    return parseVersionedConsoleUserSession(session);
  }

  const [githubUserId, githubLogin, ...extraParts] = session.split(":");
  const hasSessionShape =
    githubUserId !== undefined &&
    githubUserId.length > 0 &&
    githubLogin !== undefined &&
    githubLogin.length > 0 &&
    extraParts.length === 0;
  if (!hasSessionShape) {
    return undefined;
  }

  return { githubLogin, githubUserId, organizationLogins: [] };
}

export function createConsoleUserSessionPayload(session: ConsoleUserSession): string {
  const payload = Buffer.from(
    JSON.stringify({
      githubLogin: session.githubLogin,
      // Why not Firestore: OAuth token を server 側に永続化すると資格情報ストアに
      // なる。署名済み HttpOnly cookie なら token は本人の browser にだけ残り、
      // snapshot 失効時の server 側再取得にも使える。
      ...(session.githubOAuthToken === undefined
        ? {}
        : { githubOAuthToken: session.githubOAuthToken }),
      githubUserId: session.githubUserId,
    }),
    "utf8",
  ).toString("base64url");
  return `v2:${payload}`;
}

function parseVersionedConsoleUserSession(session: string): ConsoleUserSession | undefined {
  try {
    const encodedPayload = session.slice("v2:".length);
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      githubLogin?: unknown;
      githubOAuthToken?: unknown;
      githubUserId?: unknown;
      accessibleRepositoryIds?: unknown;
      accessibleRepositoryFullNames?: unknown;
      organizationLogins?: unknown;
    };
    const accessibleRepositoryIds = parsed.accessibleRepositoryIds;
    const accessibleRepositoryFullNames = parsed.accessibleRepositoryFullNames;
    const githubLogin = parsed.githubLogin;
    const githubOAuthToken = parsed.githubOAuthToken;
    const githubUserId = parsed.githubUserId;
    const organizationLogins = parsed.organizationLogins;
    const hasSessionShape =
      typeof githubLogin === "string" &&
      githubLogin.length > 0 &&
      typeof githubUserId === "string" &&
      githubUserId.length > 0 &&
      (githubOAuthToken === undefined ||
        (typeof githubOAuthToken === "string" && githubOAuthToken.length > 0)) &&
      (organizationLogins === undefined ||
        (Array.isArray(organizationLogins) &&
          organizationLogins.every((login) => typeof login === "string"))) &&
      (accessibleRepositoryIds === undefined ||
        (Array.isArray(accessibleRepositoryIds) &&
          accessibleRepositoryIds.every((repoId) => typeof repoId === "number"))) &&
      (accessibleRepositoryFullNames === undefined ||
        (Array.isArray(accessibleRepositoryFullNames) &&
          accessibleRepositoryFullNames.every((repoFullName) => typeof repoFullName === "string")));
    if (!hasSessionShape) {
      return undefined;
    }

    return {
      ...(accessibleRepositoryIds === undefined ? {} : { accessibleRepositoryIds }),
      ...(accessibleRepositoryFullNames === undefined ? {} : { accessibleRepositoryFullNames }),
      githubLogin,
      ...(githubOAuthToken === undefined ? {} : { githubOAuthToken }),
      githubUserId,
      organizationLogins: organizationLogins ?? [],
    };
  } catch {
    return undefined;
  }
}

export async function loadConsoleUserSessionAccess(
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
  refreshDependencies: RepositoryAccessRefreshDependencies = defaultRepositoryAccessRefreshDependencies,
): Promise<ConsoleUserSession> {
  const database = getAdminFirestore();
  const userSnapshot = await database.collection("inviteUsers").doc(session.githubUserId).get();
  const user = userSnapshot.data() as InviteUserRecord | undefined;
  const hasUser = user !== undefined;
  if (!hasUser) {
    return session;
  }

  const isFreshAccessSnapshot = isRepositoryAccessSnapshotFresh(
    user.repositoryAccessRefreshedAt,
    env,
  );
  if (!isFreshAccessSnapshot) {
    const refreshedSession = await refreshRepositoryAccessSnapshot(session, refreshDependencies);
    const hasRefreshedSession = refreshedSession !== undefined;
    if (!hasRefreshedSession) {
      // 空のアクセスリストを返すとダッシュボードが黙って 0 件表示になる。session
      // cookie に OAuth token が無い、または token が失効している場合はサーバー
      // 単独で再取得できず、再ログイン(再 OAuth)を要求するしかない。
      throw new RepositoryAccessExpiredError();
    }

    return refreshedSession;
  }

  return {
    ...session,
    accessibleRepositoryFullNames: readStringArray(user.accessibleRepositoryFullNames),
    accessibleRepositoryIds: readNumberArray(user.accessibleRepositoryIds),
    organizationLogins: readStringArray(user.organizationLogins),
  };
}

async function refreshRepositoryAccessSnapshot(
  session: ConsoleUserSession,
  refreshDependencies: RepositoryAccessRefreshDependencies,
): Promise<ConsoleUserSession | undefined> {
  const token = session.githubOAuthToken;
  const hasToken = token !== undefined && token.length > 0;
  if (!hasToken) {
    return undefined;
  }

  try {
    const [organizations, repositories] = await Promise.all([
      refreshDependencies.fetchOrganizations(token),
      refreshDependencies.fetchRepositories(token),
    ]);
    const refreshedSession: ConsoleUserSession = {
      ...session,
      accessibleRepositoryFullNames: repositories.map((repository) => repository.full_name),
      accessibleRepositoryIds: repositories.map((repository) => repository.id),
      organizationLogins: organizations.map((organization) => organization.login),
    };
    await writeRepositoryAccessSnapshot(refreshedSession);
    return refreshedSession;
  } catch {
    return undefined;
  }
}

async function writeRepositoryAccessSnapshot(session: ConsoleUserSession): Promise<void> {
  const now = new Date().toISOString();
  const database = getAdminFirestore();
  await database
    .collection("inviteUsers")
    .doc(session.githubUserId)
    .set(
      {
        accessibleRepositoryFullNames: session.accessibleRepositoryFullNames ?? [],
        accessibleRepositoryIds: session.accessibleRepositoryIds ?? [],
        organizationLogins: session.organizationLogins ?? [],
        repositoryAccessRefreshedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
}

export async function requireInviteAccess(session: ConsoleUserSession): Promise<InviteAccess> {
  const database = getAdminFirestore();
  const redemptionSnapshot = await database
    .collection("inviteRedemptions")
    .doc(session.githubUserId)
    .get();
  const hasRedemption = redemptionSnapshot.exists;
  if (!hasRedemption) {
    throw new InviteRequiredError();
  }

  const userSnapshot = await database.collection("inviteUsers").doc(session.githubUserId).get();
  assertUserEnabled(userSnapshot.data());

  const redemption = redemptionSnapshot.data() as InviteAccess;
  const inviteSnapshot = await database.collection("inviteCodes").doc(redemption.code).get();
  const invite = inviteSnapshot.data() as { enabled?: boolean } | undefined;
  const hasInvite = invite !== undefined;
  if (!hasInvite) {
    throw new InviteAccessRevokedError("invite_not_found");
  }

  const isInviteEnabled = invite.enabled !== false;
  if (!isInviteEnabled) {
    throw new InviteAccessRevokedError("invite_disabled");
  }

  return {
    code: redemption.code,
    codeName: redemption.codeName,
    githubLogin: redemption.githubLogin,
    githubUserId: redemption.githubUserId,
    redeemedAt: redemption.redeemedAt,
  };
}

export async function recordUserLogin(session: ConsoleUserSession): Promise<void> {
  const now = new Date().toISOString();
  const database = getAdminFirestore();
  await database.runTransaction(async (transaction) => {
    const userRef = database.collection("inviteUsers").doc(session.githubUserId);
    const userSnapshot = await transaction.get(userRef);
    const user = userSnapshot.data() as InviteUserRecord | undefined;
    transaction.set(
      userRef,
      {
        firstLoginAt: user?.firstLoginAt ?? now,
        githubLogin: session.githubLogin,
        githubUserId: session.githubUserId,
        lastLoginAt: now,
        loginCount: FieldValue.increment(1),
        accessibleRepositoryIds: session.accessibleRepositoryIds ?? [],
        accessibleRepositoryFullNames: session.accessibleRepositoryFullNames ?? [],
        organizationLogins: session.organizationLogins ?? [],
        repositoryAccessRefreshedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });
}

function isRepositoryAccessSnapshotFresh(
  refreshedAt: string | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  const hasRefreshedAt = refreshedAt !== undefined && refreshedAt.length > 0;
  if (!hasRefreshedAt) {
    return false;
  }

  const refreshedAtTime = Date.parse(refreshedAt);
  const hasValidTime = Number.isFinite(refreshedAtTime);
  if (!hasValidTime) {
    return false;
  }

  const ttlSeconds = readRepositoryAccessTtlSeconds(env);
  return Date.now() - refreshedAtTime <= ttlSeconds * 1000;
}

function readRepositoryAccessTtlSeconds(env: NodeJS.ProcessEnv): number {
  const value = env.SECURITY_APP_REPOSITORY_ACCESS_TTL_SECONDS;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  const hasValidValue = Number.isFinite(parsed) && parsed > 0;
  if (hasValidValue) {
    return parsed;
  }

  return 60 * 60;
}

export async function recordUserManualScan(
  session: ConsoleUserSession,
  scanRequestCount: number,
): Promise<void> {
  const now = new Date().toISOString();
  const database = getAdminFirestore();
  await database.runTransaction(async (transaction) => {
    const userRef = database.collection("inviteUsers").doc(session.githubUserId);
    const userSnapshot = await transaction.get(userRef);
    assertUserEnabled(userSnapshot.data());
    transaction.set(
      userRef,
      {
        githubLogin: session.githubLogin,
        githubUserId: session.githubUserId,
        lastScanAt: now,
        manualScanRequestCount: FieldValue.increment(scanRequestCount),
        manualScanRunCount: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true },
    );
  });
}

export async function redeemInviteCode(
  session: ConsoleUserSession,
  rawCode: string,
): Promise<InviteAccess> {
  const code = normalizeInviteCode(rawCode);
  const hasValidCode = hasValidInviteCodeCheckDigit(code);
  if (!hasValidCode) {
    throw new InviteRedeemError("invalid_code");
  }

  const database = getAdminFirestore();
  return database.runTransaction(async (transaction) => {
    const codeRef = database.collection("inviteCodes").doc(code);
    const redemptionRef = database.collection("inviteRedemptions").doc(session.githubUserId);
    const userRef = database.collection("inviteUsers").doc(session.githubUserId);
    const [existingRedemptionSnapshot, codeSnapshot, userSnapshot] = await Promise.all([
      transaction.get(redemptionRef),
      transaction.get(codeRef),
      transaction.get(userRef),
    ]);

    const existingRedemption = existingRedemptionSnapshot.data() as InviteAccess | undefined;
    const user = userSnapshot.data() as InviteUserRecord | undefined;
    const hasExistingRedemption = existingRedemption !== undefined;
    if (hasExistingRedemption) {
      const isDisabled = user?.disabled === true;
      if (isDisabled) {
        throw new UserDisabledError();
      }

      const isSameInviteCode = existingRedemption.code === code;
      if (isSameInviteCode) {
        assertRedeemableExistingInvite(codeSnapshot);
        return existingRedemption;
      }

      const existingCodeRef = database.collection("inviteCodes").doc(existingRedemption.code);
      const existingCodeSnapshot = await transaction.get(existingCodeRef);
      const existingInvite = existingCodeSnapshot.data() as { enabled?: boolean } | undefined;
      const hasExistingInvite = existingInvite !== undefined;
      const isExistingInviteEnabled = existingInvite?.enabled !== false;
      if (hasExistingInvite && isExistingInviteEnabled) {
        return existingRedemption;
      }
    }

    const invite = codeSnapshot.data() as
      | {
          enabled?: boolean;
          maxRedemptions?: number;
          name?: string;
          redeemedCount?: number;
        }
      | undefined;
    const hasInvite = invite !== undefined;
    if (!hasInvite) {
      throw new InviteRedeemError("invite_not_found");
    }

    const isEnabled = invite.enabled !== false;
    if (!isEnabled) {
      throw new InviteRedeemError("invite_disabled");
    }

    const redeemedCount = invite.redeemedCount ?? 0;
    const maxRedemptions = invite.maxRedemptions ?? 0;
    const hasCapacity = redeemedCount < maxRedemptions;
    if (!hasCapacity) {
      throw new InviteRedeemError("invite_full");
    }

    const now = new Date().toISOString();
    const access: InviteAccess = {
      code,
      codeName: invite.name ?? code,
      githubLogin: session.githubLogin,
      githubUserId: session.githubUserId,
      redeemedAt: now,
    };
    transaction.set(redemptionRef, access);
    transaction.set(
      userRef,
      {
        disabled: false,
        firstSeenAt: now,
        githubLogin: session.githubLogin,
        githubUserId: session.githubUserId,
        inviteCode: code,
        inviteName: invite.name ?? code,
        registeredAt: user?.registeredAt ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.update(codeRef, {
      redeemedCount: FieldValue.increment(1),
      updatedAt: now,
    });
    return access;
  });
}

function assertRedeemableExistingInvite(codeSnapshot: { data(): unknown }): void {
  const invite = codeSnapshot.data() as { enabled?: boolean } | undefined;
  const hasInvite = invite !== undefined;
  if (!hasInvite) {
    throw new InviteRedeemError("invite_not_found");
  }

  const isEnabled = invite.enabled !== false;
  if (!isEnabled) {
    throw new InviteRedeemError("invite_disabled");
  }
}

function assertUserEnabled(value: unknown): asserts value is InviteUserRecord {
  const hasUser = typeof value === "object" && value !== null;
  if (!hasUser) {
    throw new UserDisabledError();
  }

  const user = value as InviteUserRecord;
  const isDisabled = user.disabled === true;
  if (isDisabled) {
    throw new UserDisabledError();
  }
}

function getAdminFirestore() {
  const apps = getApps();
  const hasApp = apps.length > 0;
  if (!hasApp) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const hasProjectId = typeof projectId === "string" && projectId.length > 0;
    if (hasProjectId) {
      initializeApp({ projectId });
    } else {
      initializeApp();
    }
  }

  return getFirestore();
}

function readStringArray(value: unknown): string[] {
  const isStringArray = Array.isArray(value) && value.every((item) => typeof item === "string");
  if (!isStringArray) {
    return [];
  }

  return value;
}

function readNumberArray(value: unknown): number[] {
  const isNumberArray = Array.isArray(value) && value.every((item) => typeof item === "number");
  if (!isNumberArray) {
    return [];
  }

  return value;
}
