import type { IncomingMessage, ServerResponse } from "node:http";

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Transaction } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import {
  generateInviteCode,
  hasValidInviteCodeCheckDigit,
  normalizeInstallationPolicy,
  normalizeInviteCode,
  type InstallationPolicy,
} from "@scanveil/core";
import { listGitHubAppInstallations } from "@scanveil/github";

import { routeRequest } from "../../api/src/handler.js";

const adminEmail = "kei.of.nakayama@gmail.com";
// GitHub App ID is public (not a secret), so it is wired as a plain deploy param
// instead of a Secret Manager secret.
// Why not a default value: a non-empty default makes value() always truthy, which
// would silently bake one app id into every environment and make the missing-id
// error path and the process.env fallback unreachable dead code.
const githubAppId = defineString("GITHUB_APP_ID");
const functionsProjectId =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "kexi-380010";
const webhookServiceAccount = `scanveil-functions-webhook@${functionsProjectId}.iam.gserviceaccount.com`;
const adminServiceAccount = `scanveil-functions-admin@${functionsProjectId}.iam.gserviceaccount.com`;

export const githubWebhook = onRequest(
  {
    invoker: "public",
    maxInstances: 3,
    memory: "256MiB",
    minInstances: 0,
    region: "us-central1",
    serviceAccount: webhookServiceAccount,
    secrets: ["GITHUB_WEBHOOK_SECRET"],
    timeoutSeconds: 60,
  },
  async (request, response) => {
    process.env.GOOGLE_CLOUD_PROJECT ??= process.env.GCLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_REGION ??= "us-central1";
    process.env.SCAN_WORKER_JOB_NAME ??= "scanveil-worker";
    await routeRequest(request as IncomingMessage, response as ServerResponse);
  },
);

export const adminApi = onRequest(
  {
    invoker: "public",
    maxInstances: 2,
    memory: "256MiB",
    minInstances: 0,
    region: "us-central1",
    serviceAccount: adminServiceAccount,
    secrets: ["GITHUB_APP_PRIVATE_KEY"],
    timeoutSeconds: 30,
  },
  async (request, response) => {
    process.env.GOOGLE_CLOUD_PROJECT ??= process.env.GCLOUD_PROJECT;
    try {
      const adminEmail = await requireAdmin(request);
      await routeAdminRequest(request, response, adminEmail);
    } catch (error) {
      const status = error instanceof AdminHttpError ? error.status : 500;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    }
  },
);

async function routeAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  adminUserEmail: string,
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = readPathname(request);
  const adminPathname = normalizeAdminApiPath(pathname);
  const isBootstrap = method === "GET" && adminPathname === "/api/bootstrap";
  if (isBootstrap) {
    await sendJsonResponse(response, await loadAdminBootstrap());
    return;
  }

  const isCreateInvite = method === "POST" && adminPathname === "/api/invite-codes";
  if (isCreateInvite) {
    const body = await readJsonBody<CreateInviteCodeRequest>(request);
    await createInviteCode(body);
    await sendJsonResponse(response, await loadAdminBootstrap());
    return;
  }

  const installationPolicyId = readInstallationPolicyPath(adminPathname);
  const isUpdateInstallationPolicy = method === "PATCH" && installationPolicyId !== undefined;
  if (isUpdateInstallationPolicy) {
    const body = await readJsonBody<UpdateInstallationPolicyRequest>(request);
    await updateInstallationPolicy(installationPolicyId, body, adminUserEmail);
    await sendJsonResponse(response, await loadAdminBootstrap());
    return;
  }

  const inviteCode = readInviteCodePath(adminPathname);
  const isUpdateInvite = method === "PATCH" && inviteCode !== undefined;
  if (isUpdateInvite) {
    const body = await readJsonBody<UpdateInviteCodeRequest>(request);
    await updateInviteCode(inviteCode, body);
    await sendJsonResponse(response, await loadAdminBootstrap());
    return;
  }

  const githubUserId = readUserPath(adminPathname);
  const isUpdateUser = method === "PATCH" && githubUserId !== undefined;
  if (isUpdateUser) {
    const body = await readJsonBody<UpdateUserRequest>(request);
    await updateInviteUser(githubUserId, body);
    await sendJsonResponse(response, await loadAdminBootstrap());
    return;
  }

  throw new AdminHttpError(404, "not_found");
}

async function requireAdmin(request: IncomingMessage): Promise<string> {
  const authorization = request.headers.authorization;
  const hasBearer = typeof authorization === "string" && authorization.startsWith("Bearer ");
  if (!hasBearer) {
    throw new AdminHttpError(401, "missing_token");
  }

  const token = authorization.slice("Bearer ".length);
  const decoded = await getAdminAuth().verifyIdToken(token);
  const email = decoded.email;
  const isAllowed = email === adminEmail;
  if (!isAllowed) {
    throw new AdminHttpError(403, "forbidden");
  }

  return email;
}

async function loadAdminBootstrap(): Promise<AdminBootstrapResponse> {
  const database = getAdminFirestore();
  const [
    codesSnapshot,
    installationPoliciesSnapshot,
    installations,
    redemptionsSnapshot,
    usersSnapshot,
  ] = await Promise.all([
    database.collection("inviteCodes").orderBy("createdAt", "desc").limit(100).get(),
    database.collection("installationPolicies").limit(500).get(),
    listInstallationsForAdmin(),
    database.collection("inviteRedemptions").orderBy("redeemedAt", "desc").limit(200).get(),
    database.collection("inviteUsers").orderBy("updatedAt", "desc").limit(200).get(),
  ]);
  const storedInstallationPolicies = new Map(
    installationPoliciesSnapshot.docs.flatMap((doc) => {
      const policy = normalizeInstallationPolicy({
        installationId: Number(doc.id),
        ...doc.data(),
      });
      return policy === undefined ? [] : [[policy.installationId, policy] as const];
    }),
  );
  return {
    installationPolicies: installations.map((installation) => {
      const storedPolicy = storedInstallationPolicies.get(installation.installationId);
      return {
        ...installation,
        ...storedPolicy,
        enabled: storedPolicy?.enabled ?? false,
      };
    }),
    inviteCodes: codesSnapshot.docs.map((doc) => ({ code: doc.id, ...doc.data() })) as InviteCode[],
    redemptions: redemptionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as InviteRedemption[],
    users: usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as InviteUser[],
  };
}

async function listInstallationsForAdmin(): Promise<InstallationPolicy[]> {
  const appId = githubAppId.value() || process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const hasAppId = typeof appId === "string" && appId.length > 0;
  const hasPrivateKey = typeof privateKey === "string" && privateKey.length > 0;
  // Why not silently return []: a missing app id / private key is a deploy
  // misconfiguration, and swallowing it hides the admin installation list
  // behind a successful-looking empty response.
  if (!hasAppId) {
    throw new AdminHttpError(500, "github_app_id_missing");
  }

  if (!hasPrivateKey) {
    throw new AdminHttpError(500, "github_app_private_key_missing");
  }

  const installations = await listGitHubAppInstallations({ appId, privateKey });
  return installations.map((installation) => ({
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    enabled: false,
    installationId: installation.installationId,
    repositoryCount: installation.repositoryCount,
    repositorySelection: installation.repositorySelection,
  }));
}

async function createInviteCode(body: CreateInviteCodeRequest): Promise<void> {
  const name = readRequiredString(body.name, "name");
  const maxRedemptions = readPositiveInteger(body.maxRedemptions, "maxRedemptions");
  const now = new Date().toISOString();
  const database = getAdminFirestore();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const ref = database.collection("inviteCodes").doc(code);
    const wasCreated = await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const alreadyExists = snapshot.exists;
      if (alreadyExists) {
        return false;
      }

      transaction.set(ref, {
        code,
        createdAt: now,
        enabled: true,
        maxRedemptions,
        name,
        redeemedCount: 0,
        updatedAt: now,
      });
      return true;
    });
    if (wasCreated) {
      return;
    }
  }

  throw new AdminHttpError(409, "invite_code_collision");
}

async function updateInviteCode(codePath: string, body: UpdateInviteCodeRequest): Promise<void> {
  const code = normalizeInviteCode(decodeURIComponent(codePath));
  assertValidInviteCode(code);
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const hasName = body.name !== undefined;
  if (hasName) {
    update.name = readRequiredString(body.name, "name");
  }

  const hasMaxRedemptions = body.maxRedemptions !== undefined;
  if (hasMaxRedemptions) {
    update.maxRedemptions = readPositiveInteger(body.maxRedemptions, "maxRedemptions");
  }

  const hasEnabled = body.enabled !== undefined;
  if (hasEnabled) {
    update.enabled = body.enabled === true;
  }

  await getAdminFirestore().collection("inviteCodes").doc(code).set(update, { merge: true });
}

async function updateInviteUser(githubUserId: string, body: UpdateUserRequest): Promise<void> {
  const disabled = body.disabled === true;
  const now = new Date().toISOString();
  await getAdminFirestore()
    .collection("inviteUsers")
    .doc(decodeURIComponent(githubUserId))
    .set(
      {
        disabled,
        disabledAt: disabled ? now : FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );
}

async function updateInstallationPolicy(
  installationIdPath: string,
  body: UpdateInstallationPolicyRequest,
  adminUserEmail: string,
): Promise<void> {
  const installationId = readPositiveInteger(
    decodeURIComponent(installationIdPath),
    "installationId",
  );
  const now = new Date().toISOString();
  const database = getAdminFirestore();
  const installation = await readAdminInstallation(installationId);
  await database.runTransaction(async (transaction) => {
    const policyRef = database.collection("installationPolicies").doc(String(installationId));
    const policySnapshot = await transaction.get(policyRef);
    const existingPolicy = normalizeInstallationPolicy({
      installationId,
      ...policySnapshot.data(),
    });
    const update: Record<string, unknown> = {
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      installationId,
      repositoryCount: installation.repositoryCount,
      repositorySelection: installation.repositorySelection,
      updatedAt: now,
      updatedBy: adminUserEmail,
    };

    const hasEnabled = body.enabled !== undefined;
    if (hasEnabled) {
      update.enabled = body.enabled === true;
    }

    const inviteCode = readOptionalInviteCode(body.inviteCode);
    const needsInvite = body.enabled === true && existingPolicy?.inviteCode === undefined;
    const hasInviteCode = inviteCode !== undefined;
    const isMissingRequiredInvite = needsInvite && !hasInviteCode;
    if (isMissingRequiredInvite) {
      throw new AdminHttpError(400, "installation_invite_code_required");
    }

    if (hasInviteCode) {
      const invite = await redeemInstallationInviteCode(transaction, inviteCode, installationId);
      update.inviteCode = invite.code;
      update.inviteName = invite.name;
      update.invitedAt = now;
    }

    const hasExistingPolicy = existingPolicy !== undefined;
    if (!hasExistingPolicy) {
      update.createdAt = now;
    }

    transaction.set(policyRef, update, { merge: true });
  });
}

async function readAdminInstallation(installationId: number): Promise<InstallationPolicy> {
  const installations = await listInstallationsForAdmin();
  const installation = installations.find((item) => item.installationId === installationId);
  const hasInstallation = installation !== undefined;
  if (!hasInstallation) {
    throw new AdminHttpError(404, "installation_not_found");
  }

  return installation;
}

async function redeemInstallationInviteCode(
  transaction: Transaction,
  code: string,
  installationId: number,
): Promise<{ code: string; name: string }> {
  const database = getAdminFirestore();
  const codeRef = database.collection("inviteCodes").doc(code);
  const redemptionRef = database
    .collection("installationInviteRedemptions")
    .doc(String(installationId));
  const [codeSnapshot, redemptionSnapshot] = await Promise.all([
    transaction.get(codeRef),
    transaction.get(redemptionRef),
  ]);
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
    throw new AdminHttpError(400, "invite_not_found");
  }

  const isEnabled = invite.enabled !== false;
  if (!isEnabled) {
    throw new AdminHttpError(400, "invite_disabled");
  }

  const existingRedemption = redemptionSnapshot.data() as { code?: string } | undefined;
  const isSameRedemption = existingRedemption?.code === code;
  if (isSameRedemption) {
    return { code, name: invite.name ?? code };
  }

  const redeemedCount = invite.redeemedCount ?? 0;
  const maxRedemptions = invite.maxRedemptions ?? 0;
  const hasCapacity = redeemedCount < maxRedemptions;
  if (!hasCapacity) {
    throw new AdminHttpError(400, "invite_full");
  }

  const now = new Date().toISOString();
  transaction.set(redemptionRef, {
    code,
    codeName: invite.name ?? code,
    installationId,
    redeemedAt: now,
  });
  transaction.update(codeRef, {
    redeemedCount: FieldValue.increment(1),
    updatedAt: now,
  });
  return { code, name: invite.name ?? code };
}

function readInviteCodePath(pathname: string): string | undefined {
  const prefix = "/api/invite-codes/";
  const isMatch = pathname.startsWith(prefix);
  if (!isMatch) {
    return undefined;
  }

  const code = pathname.slice(prefix.length);
  return code.length > 0 ? code : undefined;
}

function readUserPath(pathname: string): string | undefined {
  const prefix = "/api/users/";
  const isMatch = pathname.startsWith(prefix);
  if (!isMatch) {
    return undefined;
  }

  const githubUserId = pathname.slice(prefix.length);
  return githubUserId.length > 0 ? githubUserId : undefined;
}

function readInstallationPolicyPath(pathname: string): string | undefined {
  const prefix = "/api/installation-policies/";
  const isMatch = pathname.startsWith(prefix);
  if (!isMatch) {
    return undefined;
  }

  const installationId = pathname.slice(prefix.length);
  return installationId.length > 0 ? installationId : undefined;
}

function normalizeAdminApiPath(pathname: string): string {
  const legacyPrefix = "/admin/api/";
  const usesLegacyPrefix = pathname.startsWith(legacyPrefix);
  if (!usesLegacyPrefix) {
    return pathname;
  }

  return `/api/${pathname.slice(legacyPrefix.length)}`;
}

function readPathname(request: IncomingMessage): string {
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `https://${host}`).pathname;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const parsedBody = readParsedRequestBody<T>(request);
  const hasParsedBody = parsedBody !== undefined;
  if (hasParsedBody) {
    return parsedBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return parseJsonText<T>(text);
}

function readParsedRequestBody<T>(request: IncomingMessage): T | undefined {
  const parsedRequest = request as IncomingMessage & {
    body?: unknown;
    rawBody?: Buffer;
  };
  const body = parsedRequest.body;
  const hasObjectBody = typeof body === "object" && body !== null;
  if (hasObjectBody) {
    return body as T;
  }

  const hasStringBody = typeof body === "string" && body.length > 0;
  if (hasStringBody) {
    return parseJsonText<T>(body);
  }

  const rawBody = parsedRequest.rawBody;
  const hasRawBody = Buffer.isBuffer(rawBody) && rawBody.length > 0;
  if (hasRawBody) {
    return parseJsonText<T>(rawBody.toString("utf8"));
  }

  return undefined;
}

function parseJsonText<T>(text: string): T {
  const hasText = text.trim().length > 0;
  if (!hasText) {
    throw new AdminHttpError(400, "request_body_required");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdminHttpError(400, "invalid_json");
  }
}

async function sendJsonResponse(response: ServerResponse, body: unknown): Promise<void> {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readRequiredString(value: unknown, field: string): string {
  const isString = typeof value === "string" && value.trim().length > 0;
  if (!isString) {
    throw new AdminHttpError(400, `${field}_required`);
  }

  return value.trim();
}

function readPositiveInteger(value: unknown, field: string): number {
  const numberValue = Number(value);
  const isPositiveInteger = Number.isInteger(numberValue) && numberValue > 0;
  if (!isPositiveInteger) {
    throw new AdminHttpError(400, `${field}_invalid`);
  }

  return numberValue;
}

function readOptionalInviteCode(value: unknown): string | undefined {
  const isString = typeof value === "string" && value.trim().length > 0;
  if (!isString) {
    return undefined;
  }

  const code = normalizeInviteCode(value);
  const hasValidCode = hasValidInviteCodeCheckDigit(code);
  if (!hasValidCode) {
    throw new AdminHttpError(400, "invalid_invite_code");
  }

  return code;
}

function assertValidInviteCode(code: string): void {
  const isValid = /^[A-Z0-9_-]{4,64}$/.test(code);
  if (!isValid) {
    throw new AdminHttpError(400, "invalid_invite_code");
  }
}

function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}

function getAdminFirestore() {
  ensureAdminApp();
  return getFirestore();
}

function ensureAdminApp(): void {
  const hasApp = getApps().length > 0;
  if (hasApp) {
    return;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const hasProjectId = typeof projectId === "string" && projectId.length > 0;
  if (hasProjectId) {
    initializeApp({ projectId });
    return;
  }

  initializeApp();
}

class AdminHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface CreateInviteCodeRequest {
  maxRedemptions?: unknown;
  name?: unknown;
}

interface UpdateInviteCodeRequest {
  enabled?: unknown;
  maxRedemptions?: unknown;
  name?: unknown;
}

interface UpdateUserRequest {
  disabled?: unknown;
}

interface UpdateInstallationPolicyRequest {
  enabled?: unknown;
  inviteCode?: unknown;
}

interface AdminBootstrapResponse {
  installationPolicies: InstallationPolicy[];
  inviteCodes: InviteCode[];
  redemptions: InviteRedemption[];
  users: InviteUser[];
}

interface InviteCode {
  code: string;
  createdAt: string;
  enabled: boolean;
  maxRedemptions: number;
  name: string;
  redeemedCount: number;
  updatedAt: string;
}

interface InviteRedemption {
  code: string;
  codeName: string;
  githubLogin: string;
  githubUserId: string;
  id: string;
  redeemedAt: string;
}

interface InviteUser {
  disabled?: boolean;
  githubLogin: string;
  githubUserId: string;
  id: string;
  inviteCode?: string;
  inviteName?: string;
  lastLoginAt?: string;
  lastScanAt?: string;
  loginCount?: number;
  manualScanRequestCount?: number;
  manualScanRunCount?: number;
  registeredAt?: string;
  updatedAt: string;
}
