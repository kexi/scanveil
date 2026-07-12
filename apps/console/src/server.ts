import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createExpiredSessionCookie,
  createGitHubOAuthUrl,
  fetchGitHubUserOrganizations,
  fetchGitHubUserRepositories,
  createSessionToken,
  createSignedSessionCookie,
  exchangeGitHubOAuthCode,
  fetchGitHubUser,
  readSignedSessionCookie,
} from "@scanveil/auth";
import {
  productConsoleDisplayName,
  productOAuthStateCookieName,
  scanveilConfigJsonSchema,
  type FixPrRunRecord,
  type FixPrStreamChunkRecord,
  type InstallationPolicy,
  type ScanFindingRecord,
  type ScanRunRecord,
  type ScanStreamChunkRecord,
  toStructuredLogError,
  writeStructuredLog,
} from "@scanveil/core";
import { GitHubClient, createInstallationToken } from "@scanveil/github";

import {
  readGitHubAppConfig,
  loadRepositoryDashboardData,
  type RepositoryDashboardData,
} from "./github-installations.js";
import { createFindingIssueRequest } from "./github-issues.js";
import {
  listFixPrRuns,
  listFixPrRunsBySveId,
  listFixPrStreamChunks,
  readFixPrRunRecord,
  startFixPrRun,
} from "./fix-prs.js";
import { listAvailableLlmModels } from "./llm-models.js";
import {
  listScanExecutions,
  listRepositoryBranches,
  readRepositoryScanConfig,
  startAllManualScans,
  startRepositoryManualScan,
  startSveVerificationScans,
  type BatchRepositoryManualScanInput,
  type RepositoryConfigReadInput,
  type RepositoryManualScanInput,
  type SveRepositoryScanTarget,
} from "./manual-scans.js";
import {
  InviteAccessRevokedError,
  InviteRedeemError,
  InviteRequiredError,
  RepositoryAccessExpiredError,
  UserDisabledError,
  createConsoleUserSessionPayload,
  loadConsoleUserSessionAccess,
  parseConsoleUserSession,
  recordUserLogin,
  recordUserManualScan,
  redeemInviteCode,
  requireInviteAccess,
  type ConsoleUserSession,
} from "./invites.js";
import {
  listInstallationPolicies,
  updateInstallationPolicy,
  type InstallationPolicyUpdateInput,
} from "./installation-policies.js";
import { ScanCancelError, cancelScanRun } from "./scan-cancellations.js";
import {
  createScanPolicy,
  deleteScanPolicy,
  listScanPolicies,
  readScanPolicy,
  updateScanPolicy,
  type ScanPolicyCreateInput,
  type ScanPolicyUpdateInput,
} from "./scan-policies.js";
import {
  listScanFindingRecords,
  listScanFindingRecordsBySveId,
  listScanStreamChunks,
  readLlmOutputObject,
  readScanRunRecord,
} from "./scan-history.js";
import { readScheduledScanSettings, updateScheduledScanSettings } from "./scheduled-scans.js";
import { readSessionSecret } from "./session-secret.js";
import { canAccessRepositoryFullName, RepositoryAccessDeniedError } from "./repository-access.js";
import {
  createSveResolutionSummaries,
  createSveResolutionSummary,
  type SveResolutionSummary,
} from "./sve-status.js";

interface ViteDevServerLike {
  middlewares: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  transformIndexHtml?: (url: string, html: string) => Promise<string>;
}

export interface ConsoleServerDependencies {
  exchangeGitHubOAuthCode: typeof exchangeGitHubOAuthCode;
  fetchGitHubUser: typeof fetchGitHubUser;
  fetchGitHubUserOrganizations: typeof fetchGitHubUserOrganizations;
  fetchGitHubUserRepositories: typeof fetchGitHubUserRepositories;
  loadConsoleUserSessionAccess: typeof loadConsoleUserSessionAccess;
  listAvailableLlmModels: typeof listAvailableLlmModels;
  listInstallationPolicies: typeof listInstallationPolicies;
  cancelScanRun: typeof cancelScanRun;
  listRepositoryBranches: typeof listRepositoryBranches;
  listScanExecutions: typeof listScanExecutions;
  listScanFindingRecords: typeof listScanFindingRecords;
  listScanFindingRecordsBySveId: typeof listScanFindingRecordsBySveId;
  listFixPrRuns: typeof listFixPrRuns;
  listFixPrRunsBySveId: typeof listFixPrRunsBySveId;
  listFixPrStreamChunks: typeof listFixPrStreamChunks;
  listScanStreamChunks: typeof listScanStreamChunks;
  loadRepositoryDashboardData: (session: ConsoleUserSession) => Promise<RepositoryDashboardData>;
  readFixPrRunRecord: typeof readFixPrRunRecord;
  readLlmOutputObject: typeof readLlmOutputObject;
  readScanRunRecord: typeof readScanRunRecord;
  readRepositoryScanConfig: typeof readRepositoryScanConfig;
  readSessionSecret: typeof readSessionSecret;
  readScheduledScanSettings: typeof readScheduledScanSettings;
  recordUserLogin: typeof recordUserLogin;
  recordUserManualScan: typeof recordUserManualScan;
  redeemInviteCode: typeof redeemInviteCode;
  requireInviteAccess: typeof requireInviteAccess;
  startAllManualScans: typeof startAllManualScans;
  startFixPrRun: typeof startFixPrRun;
  startRepositoryManualScan: typeof startRepositoryManualScan;
  startSveVerificationScans: typeof startSveVerificationScans;
  createScanPolicy: typeof createScanPolicy;
  deleteScanPolicy: typeof deleteScanPolicy;
  listScanPolicies: typeof listScanPolicies;
  readScanPolicy: typeof readScanPolicy;
  updateScanPolicy: typeof updateScanPolicy;
  updateInstallationPolicy: typeof updateInstallationPolicy;
  updateScheduledScanSettings: typeof updateScheduledScanSettings;
  createGitHubIssue: (
    input: CreateGitHubIssueInput,
  ) => Promise<{ htmlUrl: string; number: number }>;
}

export interface ConsoleServerOptions {
  clientDirectory?: string;
  dependencies?: Partial<ConsoleServerDependencies>;
  env?: NodeJS.ProcessEnv;
  port?: number;
  viteDevServer?: ViteDevServerLike;
}

interface ConsoleServerContext {
  clientDirectory: string;
  dependencies: ConsoleServerDependencies;
  env: NodeJS.ProcessEnv;
  port: number;
  viteDevServer: ViteDevServerLike | undefined;
}

interface CreateGitHubIssueInput {
  deliveryId: string;
  finding: ScanFindingRecord;
  requestUrl: URL;
  run: ScanRunRecord;
}

interface SveSourceContext {
  commitSha: string;
  content?: string;
  endLine?: number;
  error?: string;
  file: string;
  githubUrl: string;
  language: string;
  startLine?: number;
}

const serverFile = fileURLToPath(import.meta.url);
const serverDirectory = resolve(serverFile, "..");
const defaultClientDirectory = resolve(serverDirectory, "../client");

export function createDefaultConsoleServerDependencies(
  env: NodeJS.ProcessEnv = process.env,
): ConsoleServerDependencies {
  return {
    createGitHubIssue: (input) => createGitHubIssueWithGitHubApp(input, env),
    cancelScanRun: (deliveryId) => cancelScanRun(deliveryId, env),
    exchangeGitHubOAuthCode,
    fetchGitHubUser,
    fetchGitHubUserOrganizations,
    fetchGitHubUserRepositories,
    loadConsoleUserSessionAccess: (session) => loadConsoleUserSessionAccess(session, env),
    listAvailableLlmModels: () => listAvailableLlmModels(env),
    listInstallationPolicies: () => listInstallationPolicies(env),
    listRepositoryBranches: (input, session) => listRepositoryBranches(input, session, env),
    listScanExecutions: () => listScanExecutions(env),
    listScanFindingRecords: (deliveryIds) => listScanFindingRecords(deliveryIds, env),
    listScanFindingRecordsBySveId: (sveId) => listScanFindingRecordsBySveId(sveId, env),
    listFixPrRuns: () => listFixPrRuns(env),
    listFixPrRunsBySveId: (sveId) => listFixPrRunsBySveId(sveId, env),
    listFixPrStreamChunks: (fixId, afterSequence) =>
      listFixPrStreamChunks(fixId, afterSequence, env),
    listScanStreamChunks: (deliveryId, afterSequence) =>
      listScanStreamChunks(deliveryId, afterSequence, env),
    loadRepositoryDashboardData: (session) => loadRepositoryDashboardData(session, env),
    readFixPrRunRecord: (fixId) => readFixPrRunRecord(fixId, env),
    readLlmOutputObject: (objectPath) => readLlmOutputObject(objectPath, env),
    readScanRunRecord: (deliveryId) => readScanRunRecord(deliveryId, env),
    readRepositoryScanConfig: (input, session) => readRepositoryScanConfig(input, session, env),
    readScheduledScanSettings: () => readScheduledScanSettings(env),
    readSessionSecret: () => readSessionSecret(env),
    recordUserLogin,
    recordUserManualScan,
    redeemInviteCode,
    requireInviteAccess,
    startAllManualScans: (input, session) => startAllManualScans(input, session, env),
    startFixPrRun: (input) => startFixPrRun(input, env),
    startRepositoryManualScan: (input, session) => startRepositoryManualScan(input, session, env),
    startSveVerificationScans: (targets, input, session) =>
      startSveVerificationScans(targets, input, session, env),
    createScanPolicy: (input, updatedBy) => createScanPolicy(input, updatedBy, env),
    deleteScanPolicy: (id) => deleteScanPolicy(id, env),
    listScanPolicies: (installationIds) => listScanPolicies(installationIds, env),
    readScanPolicy: (id) => readScanPolicy(id, env),
    updateScanPolicy: (id, input, updatedBy) => updateScanPolicy(id, input, updatedBy, env),
    updateInstallationPolicy: (installationId, input, updatedBy) =>
      updateInstallationPolicy(installationId, input, updatedBy, env),
    updateScheduledScanSettings: (input) => updateScheduledScanSettings(input, env),
  };
}

export async function createConsoleServer(options: ConsoleServerOptions = {}): Promise<Server> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? "8080");
  const isProduction = env.NODE_ENV === "production";
  const dependencies: ConsoleServerDependencies = {
    ...createDefaultConsoleServerDependencies(env),
    ...options.dependencies,
  };
  const viteDevServer = options.viteDevServer ?? (await createViteDevServer({ isProduction }));
  const context: ConsoleServerContext = {
    clientDirectory: options.clientDirectory ?? defaultClientDirectory,
    dependencies,
    env,
    port,
    viteDevServer,
  };

  return createServer((request, response) => {
    void handleRequest(request, response, context).catch((error: unknown) => {
      const isRepositoryAccessDenied = error instanceof RepositoryAccessDeniedError;
      if (isRepositoryAccessDenied) {
        sendText(response, 404, "Not Found");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      writeStructuredLog({
        error: toStructuredLogError(error),
        message: "console_request_failed",
        severity: "ERROR",
      });
      sendText(response, 500, message);
    });
  });
}

async function startConsoleServerFromEnv(): Promise<void> {
  const port = Number(process.env.PORT ?? "8080");
  const host = process.env.HOST ?? "0.0.0.0";
  const server = await createConsoleServer({ port });
  server.listen(port, host, () => {
    writeStructuredLog({
      host,
      message: "console_listening",
      port,
      product: productConsoleDisplayName,
      severity: "INFO",
    });
  });
}

async function createGitHubIssueWithGitHubApp(
  input: CreateGitHubIssueInput,
  env: NodeJS.ProcessEnv,
): Promise<{ htmlUrl: string; number: number }> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App is not configured");
  }

  const issueRequest = createFindingIssueRequest(
    input.run,
    input.finding,
    env.SECURITY_APP_WEB_BASE_URL ?? input.requestUrl.origin,
  );
  const token = await createInstallationToken(config, input.run.installationId);
  const apiBaseUrl = config.apiBaseUrl;
  const github = new GitHubClient(apiBaseUrl === undefined ? { token } : { apiBaseUrl, token });
  return github.createIssue(input.run.owner, input.run.repo, issueRequest);
}

const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  await startConsoleServerFromEnv();
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = readRequestUrl(request, context);
  const pathname = requestUrl.pathname;

  const shouldStartGitHubLogin =
    method === "GET" && pathname === "/login" && requestUrl.searchParams.get("start") === "github";
  if (shouldStartGitHubLogin) {
    await handleStartGitHubLogin(requestUrl, response, context);
    return;
  }

  const isOAuthCallback = method === "GET" && pathname === "/oauth/callback";
  if (isOAuthCallback) {
    await handleOAuthCallback(request, requestUrl, response, context);
    return;
  }

  const isLogout = method === "GET" && pathname === "/logout";
  if (isLogout) {
    sendRedirect(response, "/login", 302, [createExpiredSessionCookie()]);
    return;
  }

  const isLoginPage = (method === "GET" || method === "HEAD") && pathname === "/login";
  if (isLoginPage) {
    await sendClientApp(request, response, context);
    return;
  }

  const isPublicAssetRequest =
    isPublicAssetPath(pathname) && (method === "GET" || method === "HEAD");
  if (isPublicAssetRequest) {
    const servedStatic = await sendStaticAsset(request, response, pathname, context);
    if (servedStatic) {
      return;
    }
  }

  const isConfigSchemaApi = method === "GET" && pathname === "/api/config-schema";
  if (isConfigSchemaApi) {
    sendJson(response, 200, scanveilConfigJsonSchema);
    return;
  }

  const sessionPayload = readSession(request, context);
  const hasSession = sessionPayload !== undefined;
  if (!hasSession) {
    const isApiRoute = pathname.startsWith("/api/") || pathname === "/scans/start";
    if (isApiRoute) {
      sendText(response, 401, "Unauthorized");
      return;
    }

    sendRedirect(response, "/login");
    return;
  }

  const isInvitePage = (method === "GET" || method === "HEAD") && pathname === "/invite";
  if (isInvitePage) {
    await sendClientApp(request, response, context);
    return;
  }

  const isInviteRedeem = method === "POST" && pathname === "/invite/redeem";
  if (isInviteRedeem) {
    await handleInviteRedeem(request, response, sessionPayload, context);
    return;
  }

  const inviteAccess = await readInviteAccess(sessionPayload, context);
  const lacksInviteAccess =
    inviteAccess === "invite_required" ||
    inviteAccess === "invite_disabled" ||
    inviteAccess === "user_disabled";
  if (lacksInviteAccess) {
    const isApiRoute = pathname.startsWith("/api/") || pathname === "/scans/start";
    if (isApiRoute) {
      sendText(response, 403, inviteAccess);
      return;
    }

    const params = new URLSearchParams();
    if (inviteAccess === "invite_disabled") {
      params.set("error", "invite_disabled");
    }
    if (inviteAccess === "user_disabled") {
      params.set("error", "user_disabled");
    }
    sendRedirect(response, `/invite${params.size > 0 ? `?${params.toString()}` : ""}`);
    return;
  }

  const parsedSession = parseConsoleUserSession(sessionPayload);
  const hasParsedSession = parsedSession !== undefined;
  if (!hasParsedSession) {
    sendText(response, 401, "Unauthorized");
    return;
  }
  const session = await loadSessionAccess(parsedSession, context);
  const hasFreshRepositoryAccess = session !== undefined;
  if (!hasFreshRepositoryAccess) {
    const isApiRoute = pathname.startsWith("/api/") || pathname === "/scans/start";
    if (isApiRoute) {
      sendText(response, 401, "Unauthorized");
      return;
    }

    sendRedirect(response, "/login");
    return;
  }

  const isDashboardApi = method === "GET" && pathname === "/api/dashboard";
  if (isDashboardApi) {
    const dashboard = await context.dependencies.loadRepositoryDashboardData(session);
    sendJson(response, 200, { dashboard });
    return;
  }

  const isScanHistoryApi = method === "GET" && pathname === "/api/scans/history";
  if (isScanHistoryApi) {
    const history = await loadScanHistoryResponse(context, session);
    sendJson(response, 200, history);
    return;
  }

  const isFixPrRunsApi = method === "GET" && pathname === "/api/fix-prs";
  if (isFixPrRunsApi) {
    const fixPrRuns = filterFixPrRunsByRepositoryAccess(
      await context.dependencies.listFixPrRuns(),
      session,
    );
    sendJson(response, 200, { fixPrRuns });
    return;
  }

  const fixPrStreamId = readFixPrStreamApiPath(pathname);
  const isFixPrStreamApi = method === "GET" && fixPrStreamId !== undefined;
  if (isFixPrStreamApi) {
    await sendFixPrStream(request, response, fixPrStreamId, context, sessionPayload, session);
    return;
  }

  const fixPrLlmOutputId = readFixPrLlmOutputApiPath(pathname);
  const isFixPrLlmOutputApi = method === "GET" && fixPrLlmOutputId !== undefined;
  if (isFixPrLlmOutputApi) {
    await sendFixPrLlmOutput(response, fixPrLlmOutputId, context, session);
    return;
  }

  const fixPrRunId = readFixPrRunApiPath(pathname);
  const isFixPrRunApi = method === "GET" && fixPrRunId !== undefined;
  if (isFixPrRunApi) {
    const fixPrRun = await loadAuthorizedFixPrRun(fixPrRunId, context, session);
    const hasFixPrRun = fixPrRun !== undefined;
    if (!hasFixPrRun) {
      sendJson(response, 404, { error: "Fix PR run not found" });
      return;
    }

    const chunks = filterFixPrStreamChunksByRun(
      await context.dependencies.listFixPrStreamChunks(fixPrRunId),
      fixPrRun,
    );
    sendJson(response, 200, { chunks, fixPrRun });
    return;
  }

  const isSveVerificationApi = method === "POST" && pathname === "/api/sve-verifications";
  if (isSveVerificationApi) {
    await handleStartSveVerification(request, response, sessionPayload, context);
    return;
  }

  const isInstallationPolicySettingsListApi =
    method === "GET" && pathname === "/api/settings/installation-policies";
  if (isInstallationPolicySettingsListApi) {
    const policies = filterInstallationPoliciesForRepositoryAccess(
      await context.dependencies.listInstallationPolicies(),
      session,
    );
    sendJson(response, 200, { policies });
    return;
  }

  const installationPolicyId = readInstallationPolicySettingsApiPath(pathname);
  const isInstallationPolicySettingsUpdateApi =
    method === "PATCH" && installationPolicyId !== undefined;
  if (isInstallationPolicySettingsUpdateApi) {
    await handleUpdateInstallationPolicy(request, response, installationPolicyId, context, session);
    return;
  }

  const isScanPolicySettingsListApi =
    method === "GET" && pathname === "/api/settings/scan-policies";
  if (isScanPolicySettingsListApi) {
    await handleListScanPolicies(response, context, session);
    return;
  }

  const isScanPolicySettingsCreateApi =
    method === "POST" && pathname === "/api/settings/scan-policies";
  if (isScanPolicySettingsCreateApi) {
    await handleCreateScanPolicy(request, response, context, session);
    return;
  }

  const scanPolicyId = readScanPolicySettingsApiPath(pathname);
  const isScanPolicySettingsUpdateApi = method === "PATCH" && scanPolicyId !== undefined;
  if (isScanPolicySettingsUpdateApi) {
    await handleUpdateScanPolicy(request, response, scanPolicyId, context, session);
    return;
  }

  const isScanPolicySettingsDeleteApi = method === "DELETE" && scanPolicyId !== undefined;
  if (isScanPolicySettingsDeleteApi) {
    await handleDeleteScanPolicy(response, scanPolicyId, context, session);
    return;
  }

  const isLlmModelsApi = method === "GET" && pathname === "/api/llm-models";
  if (isLlmModelsApi) {
    const models = await context.dependencies.listAvailableLlmModels();
    sendJson(response, 200, { models });
    return;
  }

  const isScheduledScanSettingsGetApi =
    method === "GET" && pathname === "/api/settings/scheduled-scan";
  if (isScheduledScanSettingsGetApi) {
    const settings = await context.dependencies.readScheduledScanSettings();
    sendJson(response, 200, { settings });
    return;
  }

  const isScheduledScanSettingsUpdateApi =
    method === "PATCH" && pathname === "/api/settings/scheduled-scan";
  if (isScheduledScanSettingsUpdateApi) {
    await handleUpdateScheduledScan(request, response, context);
    return;
  }

  const isScanHistoryStreamApi = method === "GET" && pathname === "/api/scans/history/stream";
  if (isScanHistoryStreamApi) {
    await sendScanHistoryStream(request, response, context, sessionPayload);
    return;
  }

  const repositoryConfigPath = readRepositoryConfigApiPath(pathname);
  const repositoryBranchesPath = readRepositoryBranchesApiPath(pathname);
  const isRepositoryBranchesApi = method === "GET" && repositoryBranchesPath !== undefined;
  if (isRepositoryBranchesApi) {
    await handleRepositoryBranches(requestUrl, response, repositoryBranchesPath, context, session);
    return;
  }

  const isRepositoryConfigApi = method === "GET" && repositoryConfigPath !== undefined;
  if (isRepositoryConfigApi) {
    await handleRepositoryConfig(requestUrl, response, repositoryConfigPath, context, session);
    return;
  }

  const scanStreamDeliveryId = readScanStreamApiPath(pathname);
  const isScanStreamApi = method === "GET" && scanStreamDeliveryId !== undefined;
  if (isScanStreamApi) {
    await sendScanStream(request, response, scanStreamDeliveryId, context, sessionPayload, session);
    return;
  }

  const llmOutputDeliveryId = readLlmOutputApiPath(pathname);
  const isLlmOutputApi = method === "GET" && llmOutputDeliveryId !== undefined;
  if (isLlmOutputApi) {
    await sendLlmOutput(response, llmOutputDeliveryId, context, session);
    return;
  }

  const scanIssueDeliveryId = readScanIssueApiPath(pathname);
  const isScanIssueApi = method === "POST" && scanIssueDeliveryId !== undefined;
  if (isScanIssueApi) {
    await handleCreateScanIssue(
      request,
      requestUrl,
      response,
      scanIssueDeliveryId,
      context,
      session,
    );
    return;
  }

  const scanCancelDeliveryId = readScanCancelApiPath(pathname);
  const isScanCancelApi = method === "POST" && scanCancelDeliveryId !== undefined;
  if (isScanCancelApi) {
    await handleCancelScan(response, scanCancelDeliveryId, context, session);
    return;
  }

  const scanDetailDeliveryId = readScanDetailApiPath(pathname);
  const isScanDetailApi = method === "GET" && scanDetailDeliveryId !== undefined;
  if (isScanDetailApi) {
    const detail = await loadScanDetailResponse(scanDetailDeliveryId, context, session);
    const hasRun = detail !== undefined;
    if (!hasRun) {
      sendText(response, 404, "Scan not found");
      return;
    }

    sendJson(response, 200, detail);
    return;
  }

  const sveFixPrId = readSveFixPrApiPath(pathname);
  const isSveFixPrApi = method === "POST" && sveFixPrId !== undefined;
  if (isSveFixPrApi) {
    await handleCreateSveFixPr(request, response, sveFixPrId, context, session);
    return;
  }

  const sveId = readSveIdApiPath(pathname);
  const isSveApi = method === "GET" && sveId !== undefined;
  if (isSveApi) {
    const detail = await loadSveDetailResponse(sveId, context, session);
    sendJson(response, 200, detail);
    return;
  }

  const isStartScan = method === "POST" && pathname === "/scans/start";
  if (isStartScan) {
    await handleStartScan(request, response, sessionPayload, context);
    return;
  }

  const isGetRequest = method === "GET" || method === "HEAD";
  if (isGetRequest) {
    const servedStatic = await sendStaticAsset(request, response, pathname, context);
    if (servedStatic) {
      return;
    }

    await sendClientApp(request, response, context);
    return;
  }

  sendText(response, 404, "Not Found");
}

async function handleStartGitHubLogin(
  requestUrl: URL,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  const clientId = context.env.GITHUB_OAUTH_CLIENT_ID;
  const hasClientId = typeof clientId === "string" && clientId.length > 0;
  if (!hasClientId) {
    sendText(response, 500, "Missing GITHUB_OAUTH_CLIENT_ID");
    return;
  }

  const baseUrl = context.env.SECURITY_APP_WEB_BASE_URL ?? requestUrl.origin;
  const state = createSessionToken();
  const url = createGitHubOAuthUrl(
    {
      clientId,
      redirectUri: `${baseUrl}/oauth/callback`,
    },
    state,
  );
  sendRedirect(response, url, 302, [createOAuthStateCookie(state)]);
}

async function handleOAuthCallback(
  request: IncomingMessage,
  requestUrl: URL,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = readCookie(request.headers.cookie ?? null, productOAuthStateCookieName);
  const hasValidState = state !== null && expectedState !== undefined && state === expectedState;
  if (!hasValidState) {
    sendText(response, 400, "Invalid OAuth state");
    return;
  }

  const hasCode = code !== null && code.length > 0;
  if (!hasCode) {
    sendText(response, 400, "Missing OAuth code");
    return;
  }

  const clientId = context.env.GITHUB_OAUTH_CLIENT_ID;
  const hasClientId = typeof clientId === "string" && clientId.length > 0;
  if (!hasClientId) {
    sendText(response, 500, "Missing GITHUB_OAUTH_CLIENT_ID");
    return;
  }

  const clientSecret = context.env.GITHUB_OAUTH_CLIENT_SECRET;
  const hasClientSecret = typeof clientSecret === "string" && clientSecret.length > 0;
  if (!hasClientSecret) {
    sendText(response, 500, "Missing GITHUB_OAUTH_CLIENT_SECRET");
    return;
  }

  const baseUrl = context.env.SECURITY_APP_WEB_BASE_URL ?? requestUrl.origin;
  const token = await context.dependencies.exchangeGitHubOAuthCode(
    {
      clientId,
      clientSecret,
      redirectUri: `${baseUrl}/oauth/callback`,
    },
    code,
  );
  const user = await context.dependencies.fetchGitHubUser(token);
  const organizations = await context.dependencies.fetchGitHubUserOrganizations(token);
  const repositories = await context.dependencies.fetchGitHubUserRepositories(token);
  const session = {
    accessibleRepositoryIds: repositories.map((repository) => repository.id),
    accessibleRepositoryFullNames: repositories.map((repository) => repository.full_name),
    githubLogin: user.login,
    githubOAuthToken: token,
    githubUserId: String(user.id),
    organizationLogins: organizations.map((organization) => organization.login),
  };
  await context.dependencies.recordUserLogin(session);
  const sessionCookie = createSignedSessionCookie(
    createConsoleUserSessionPayload(session),
    context.dependencies.readSessionSecret(),
  );
  sendRedirect(response, "/", 302, [sessionCookie, createExpiredOAuthStateCookie()]);
}

async function handleStartScan(
  request: IncomingMessage,
  response: ServerResponse,
  sessionPayload: string | undefined,
  context: ConsoleServerContext,
): Promise<void> {
  const parsedSession =
    sessionPayload === undefined ? undefined : parseConsoleUserSession(sessionPayload);
  const hasSession = parsedSession !== undefined;
  if (!hasSession) {
    sendRedirect(response, "/login");
    return;
  }
  const session = await loadSessionAccess(parsedSession, context);
  const hasFreshRepositoryAccess = session !== undefined;
  if (!hasFreshRepositoryAccess) {
    const isJsonRequest = request.headers["content-type"]?.includes("application/json") === true;
    if (isJsonRequest) {
      sendJson(response, 401, { error: "Unauthorized", scan: "failed" });
      return;
    }

    sendRedirect(response, "/login");
    return;
  }

  try {
    const body = await readRequestBody(request);
    await context.dependencies.requireInviteAccess(session);
    const isJsonRequest = request.headers["content-type"]?.includes("application/json") === true;
    if (isJsonRequest) {
      const input = readRepositoryManualScanInputFromJson(body);
      const result = await context.dependencies.startRepositoryManualScan(input, session);
      await context.dependencies.recordUserManualScan(session, 1);
      sendJson(response, 202, {
        deliveryId: result.scanRequest.deliveryId,
        executionName: result.executionName,
        scan: "queued",
      });
      return;
    }

    const input = readBatchRepositoryManualScanInputFromFormBody(body);
    const result = await context.dependencies.startAllManualScans(input, session);
    await context.dependencies.recordUserManualScan(session, result.scanRequests.length);
    const params = new URLSearchParams({
      count: String(result.scanRequests.length),
      scan: "queued",
    });
    sendRedirect(response, `/?${params.toString()}`, 303);
  } catch (error) {
    const isInviteError =
      error instanceof InviteAccessRevokedError ||
      error instanceof InviteRequiredError ||
      error instanceof UserDisabledError;
    if (isInviteError) {
      const reason = readInviteRedeemReason(error);
      sendRedirect(response, `/invite?error=${encodeURIComponent(reason)}`, 303);
      return;
    }

    const isRepositoryAccessDenied = error instanceof RepositoryAccessDeniedError;
    if (isRepositoryAccessDenied) {
      const isJsonRequest = request.headers["content-type"]?.includes("application/json") === true;
      if (isJsonRequest) {
        sendJson(response, 403, { error: "repository_access_denied", scan: "failed" });
        return;
      }

      const params = new URLSearchParams({
        error: "repository_access_denied",
        scan: "failed",
      });
      sendRedirect(response, `/?${params.toString()}`, 303);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeStructuredLog({
      error: toStructuredLogError(error),
      message: "manual_scan_enqueue_failed",
      severity: "WARNING",
    });
    const params = new URLSearchParams({
      error: message,
      scan: "failed",
    });
    const isJsonRequest = request.headers["content-type"]?.includes("application/json") === true;
    if (isJsonRequest) {
      sendJson(response, 500, {
        error: message,
        scan: "failed",
      });
      return;
    }

    sendRedirect(response, `/?${params.toString()}`, 303);
  }
}

async function handleStartSveVerification(
  request: IncomingMessage,
  response: ServerResponse,
  sessionPayload: string | undefined,
  context: ConsoleServerContext,
): Promise<void> {
  const parsedSession =
    sessionPayload === undefined ? undefined : parseConsoleUserSession(sessionPayload);
  const hasSession = parsedSession !== undefined;
  if (!hasSession) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }
  const session = await loadSessionAccess(parsedSession, context);
  const hasFreshRepositoryAccess = session !== undefined;
  if (!hasFreshRepositoryAccess) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  try {
    await context.dependencies.requireInviteAccess(session);
    const body = await readRequestBody(request);
    const verificationInput = readSveVerificationInputFromJsonBody(body);
    const historyResponse = await loadScanHistoryResponse(context, session);
    const summaries = historyResponse.sveSummaries.filter((summary) => {
      const isRequestedSve =
        verificationInput.sveIds === undefined || verificationInput.sveIds.includes(summary.sveId);
      const needsVerification = summary.status === "active" || summary.status === "unverified";
      return isRequestedSve && needsVerification;
    });
    const targets: SveRepositoryScanTarget[] = summaries.map((summary) => ({
      repoFullName: summary.latestFinding.repoFullName,
      sveId: summary.sveId,
    }));
    const verificationScanInput = {
      llmEnabled: true,
      ...(verificationInput.llmModel === undefined ? {} : { llmModel: verificationInput.llmModel }),
      osvEnabled: true,
    };
    const result = await context.dependencies.startSveVerificationScans(
      targets,
      verificationScanInput,
      session,
    );
    await context.dependencies.recordUserManualScan(session, result.scanRequests.length);
    sendJson(response, 202, {
      count: result.scanRequests.length,
      deliveryIds: result.scanRequests.map((scanRequest) => scanRequest.deliveryId),
      executionNames: result.executionNames,
      scan: "queued",
    });
  } catch (error) {
    const isInviteError =
      error instanceof InviteAccessRevokedError ||
      error instanceof InviteRequiredError ||
      error instanceof UserDisabledError;
    if (isInviteError) {
      sendJson(response, 403, { error: readInviteRedeemReason(error) });
      return;
    }

    const isRepositoryAccessDenied = error instanceof RepositoryAccessDeniedError;
    if (isRepositoryAccessDenied) {
      sendJson(response, 403, { error: "repository_access_denied", scan: "failed" });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeStructuredLog({
      error: toStructuredLogError(error),
      message: "sve_verification_enqueue_failed",
      severity: "WARNING",
    });
    sendJson(response, 500, {
      error: message,
      scan: "failed",
    });
  }
}

async function handleUpdateInstallationPolicy(
  request: IncomingMessage,
  response: ServerResponse,
  installationIdPath: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const installationId = Number(installationIdPath);
  const isInstallationIdValid = Number.isInteger(installationId) && installationId > 0;
  if (!isInstallationIdValid) {
    sendJson(response, 400, { error: "Invalid installation id" });
    return;
  }

  try {
    const policy = (await context.dependencies.listInstallationPolicies()).find(
      (candidate) => candidate.installationId === installationId,
    );
    const hasPolicy = policy !== undefined;
    if (!hasPolicy) {
      sendJson(response, 404, { error: "GitHub App installation not found" });
      return;
    }

    const canAccessPolicy = canAccessInstallationPolicy(session, policy);
    if (!canAccessPolicy) {
      sendJson(response, 404, { error: "GitHub App installation not found" });
      return;
    }

    const body = await readRequestBody(request);
    const input = readInstallationPolicyUpdateInputFromJsonBody(body);
    const policies = await context.dependencies.updateInstallationPolicy(
      installationId,
      input,
      session.githubLogin,
    );
    sendJson(response, 200, {
      policies: filterInstallationPoliciesForRepositoryAccess(policies, session),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNotFound = message === "GitHub App installation not found";
    sendJson(response, isNotFound ? 404 : 400, { error: message });
  }
}

async function listAccessibleInstallationIds(
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<number[]> {
  const policies = filterInstallationPoliciesForRepositoryAccess(
    await context.dependencies.listInstallationPolicies(),
    session,
  );
  return policies.map((policy) => policy.installationId);
}

async function handleListScanPolicies(
  response: ServerResponse,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  try {
    const installationIds = await listAccessibleInstallationIds(context, session);
    const policies = await context.dependencies.listScanPolicies(installationIds);
    sendJson(response, 200, { policies });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
}

async function handleCreateScanPolicy(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  try {
    const body = await readRequestBody(request);
    const input = readScanPolicyCreateInputFromJsonBody(body);
    const installationIds = await listAccessibleInstallationIds(context, session);
    const canAccessInstallation = installationIds.includes(input.installationId);
    if (!canAccessInstallation) {
      sendJson(response, 404, { error: "GitHub App installation not found" });
      return;
    }

    const policy = await context.dependencies.createScanPolicy(input, session.githubLogin);
    sendJson(response, 201, { policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

async function handleUpdateScanPolicy(
  request: IncomingMessage,
  response: ServerResponse,
  scanPolicyId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  try {
    const canAccessPolicy = await canAccessScanPolicy(scanPolicyId, context, session);
    if (!canAccessPolicy) {
      sendJson(response, 404, { error: "Scan policy not found" });
      return;
    }

    const body = await readRequestBody(request);
    const input = readScanPolicyUpdateInputFromJsonBody(body);
    const policy = await context.dependencies.updateScanPolicy(
      scanPolicyId,
      input,
      session.githubLogin,
    );
    const hasPolicy = policy !== undefined;
    if (!hasPolicy) {
      sendJson(response, 404, { error: "Scan policy not found" });
      return;
    }

    sendJson(response, 200, { policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

async function handleDeleteScanPolicy(
  response: ServerResponse,
  scanPolicyId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  try {
    const canAccessPolicy = await canAccessScanPolicy(scanPolicyId, context, session);
    if (!canAccessPolicy) {
      sendJson(response, 404, { error: "Scan policy not found" });
      return;
    }

    await context.dependencies.deleteScanPolicy(scanPolicyId);
    sendJson(response, 200, { deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

async function canAccessScanPolicy(
  scanPolicyId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<boolean> {
  const policy = await context.dependencies.readScanPolicy(scanPolicyId);
  const hasPolicy = policy !== undefined;
  if (!hasPolicy) {
    return false;
  }

  const installationIds = await listAccessibleInstallationIds(context, session);
  return installationIds.includes(policy.installationId);
}

async function handleUpdateScheduledScan(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  try {
    const body = await readRequestBody(request);
    const input = readScheduledScanUpdateInputFromJsonBody(body);
    const settings = await context.dependencies.updateScheduledScanSettings(input);
    sendJson(response, 200, { settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

async function handleRepositoryConfig(
  requestUrl: URL,
  response: ServerResponse,
  repository: { owner: string; repo: string },
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const installationId = readPositiveIntegerSearchParam(requestUrl, "installationId");
  const repositoryId = readPositiveIntegerSearchParam(requestUrl, "repositoryId");
  const defaultBranchHeadSha = requestUrl.searchParams.get("headSha") ?? "";
  const hasHeadSha = defaultBranchHeadSha.length > 0;
  const isMissingRepositoryConfigParams =
    installationId === undefined || repositoryId === undefined || !hasHeadSha;
  if (isMissingRepositoryConfigParams) {
    sendText(response, 400, "Missing repository config parameters");
    return;
  }

  const input: RepositoryConfigReadInput = {
    defaultBranchHeadSha,
    installationId,
    owner: repository.owner,
    repo: repository.repo,
    repositoryId,
  };
  const config = await context.dependencies.readRepositoryScanConfig(input, session);
  sendJson(response, 200, config);
}

async function handleRepositoryBranches(
  requestUrl: URL,
  response: ServerResponse,
  repository: { owner: string; repo: string },
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const installationId = readPositiveIntegerSearchParam(requestUrl, "installationId");
  const repositoryId = readPositiveIntegerSearchParam(requestUrl, "repositoryId");
  const isMissingRepositoryBranchParams =
    installationId === undefined || repositoryId === undefined;
  if (isMissingRepositoryBranchParams) {
    sendText(response, 400, "Missing repository branch parameters");
    return;
  }

  const branches = await context.dependencies.listRepositoryBranches(
    {
      installationId,
      owner: repository.owner,
      repo: repository.repo,
      repositoryId,
    },
    session,
  );
  sendJson(response, 200, { branches });
}

async function handleInviteRedeem(
  request: IncomingMessage,
  response: ServerResponse,
  sessionPayload: string | undefined,
  context: ConsoleServerContext,
): Promise<void> {
  const session =
    sessionPayload === undefined ? undefined : parseConsoleUserSession(sessionPayload);
  const hasSession = session !== undefined;
  if (!hasSession) {
    sendRedirect(response, "/login");
    return;
  }

  const body = await readRequestBody(request);
  const params = new URLSearchParams(body);
  const code = params.get("code") ?? "";
  try {
    await context.dependencies.redeemInviteCode(session, code);
    sendRedirect(response, "/", 303);
  } catch (error) {
    const reason = readInviteRedeemReason(error);
    sendRedirect(response, `/invite?error=${encodeURIComponent(reason)}`, 303);
  }
}

async function handleCreateScanIssue(
  request: IncomingMessage,
  requestUrl: URL,
  response: ServerResponse,
  deliveryId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const body = await readRequestBody(request);
  const findingId = readFindingIdFromJsonBody(body);
  const hasFindingId = findingId !== undefined;
  if (!hasFindingId) {
    sendText(response, 400, "Missing findingId");
    return;
  }

  const detail = await loadScanDetailResponse(deliveryId, context, session);
  const hasRun = detail !== undefined;
  if (!hasRun) {
    sendText(response, 404, "Scan not found");
    return;
  }

  const finding = detail.findings.find((candidate) => candidate.findingId === findingId);
  const hasFinding = finding !== undefined;
  if (!hasFinding) {
    sendText(response, 404, "Finding not found");
    return;
  }

  try {
    const issue = await context.dependencies.createGitHubIssue({
      deliveryId,
      finding,
      requestUrl,
      run: detail.run,
    });
    sendJson(response, 201, { issue });
  } catch (error) {
    const isIssuePermissionError = isGitHubIssuePermissionError(error);
    writeStructuredLog({
      deliveryId,
      error: toStructuredLogError(error),
      findingId,
      message: "github_issue_create_failed",
      reason: isIssuePermissionError ? "github_issues_permission_denied" : undefined,
      severity: "WARNING",
    });
    if (isIssuePermissionError) {
      sendJson(response, 424, {
        code: "github_issues_permission_required",
        message:
          "GitHub App の Issues: Read and write 権限が未承認です。GitHub App settings で Issues 権限を追加し、対象 installation の権限更新を承認してください。",
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    sendText(response, 502, message);
  }
}

async function handleCreateSveFixPr(
  request: IncomingMessage,
  response: ServerResponse,
  sveId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const body = await readRequestBody(request);
  const input = readFixPrInputFromJsonBody(body);
  const findingId = input?.findingId;
  const hasFindingId = findingId !== undefined;
  if (!hasFindingId) {
    sendText(response, 400, "Missing findingId");
    return;
  }

  const detail = await loadSveDetailResponse(sveId, context, session);
  const finding = detail.findings.find((candidate) => candidate.findingId === findingId);
  const hasFinding = finding !== undefined;
  if (!hasFinding) {
    sendText(response, 404, "Finding not found");
    return;
  }

  const run = detail.history.find((candidate) => candidate.deliveryId === finding.deliveryId);
  const hasRun = run !== undefined;
  if (!hasRun) {
    sendText(response, 404, "Scan not found");
    return;
  }

  const isRepositoryScan = run.target === "repository";
  if (!isRepositoryScan) {
    sendJson(response, 400, {
      code: "repository_scan_required",
      message: "Fix PR creation is only supported for repository scan findings.",
    });
    return;
  }

  try {
    const fixPr = await context.dependencies.startFixPrRun({
      finding,
      ...(input?.llmModel === undefined ? {} : { llmModel: input.llmModel }),
      run,
    });
    sendJson(response, 202, { fixPr });
  } catch (error) {
    const isPermissionError = isGitHubFixPrPermissionError(error);
    writeStructuredLog({
      error: toStructuredLogError(error),
      findingId,
      message: "fix_pr_enqueue_failed",
      reason: isPermissionError ? "github_fix_pr_permission_denied" : undefined,
      severity: "WARNING",
      sveId,
    });
    if (isPermissionError) {
      sendJson(response, 424, {
        code: "github_fix_pr_permission_required",
        message:
          "GitHub App の Contents: Read and write と Pull requests: Read and write 権限が未承認です。GitHub App settings で権限を追加し、対象 installation の権限更新を承認してください。",
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    sendText(response, 502, message);
  }
}

async function handleCancelScan(
  response: ServerResponse,
  deliveryId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  try {
    const run = await loadAuthorizedScanRun(deliveryId, context, session);
    const hasRun = run !== undefined;
    if (!hasRun) {
      sendJson(response, 404, { error: "Scan not found", scan: "cancel_failed" });
      return;
    }

    const cancelledRun = await context.dependencies.cancelScanRun(deliveryId);
    sendJson(response, 200, { run: cancelledRun, scan: "cancelled" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStructuredLog({
      deliveryId,
      error: toStructuredLogError(error),
      message: "scan_cancel_failed",
      severity: "WARNING",
    });
    const statusCode = error instanceof ScanCancelError ? error.statusCode : 500;
    sendJson(response, statusCode, { error: message, scan: "cancel_failed" });
  }
}

async function loadSessionAccess(
  parsedSession: ConsoleUserSession,
  context: ConsoleServerContext,
): Promise<ConsoleUserSession | undefined> {
  try {
    return await context.dependencies.loadConsoleUserSessionAccess(parsedSession);
  } catch (error) {
    const isRepositoryAccessExpired = error instanceof RepositoryAccessExpiredError;
    if (isRepositoryAccessExpired) {
      return undefined;
    }

    throw error;
  }
}

async function readInviteAccess(
  sessionPayload: string | undefined,
  context: ConsoleServerContext,
): Promise<"invite_disabled" | "invite_required" | "user_disabled" | "ok"> {
  const session =
    sessionPayload === undefined ? undefined : parseConsoleUserSession(sessionPayload);
  const hasSession = session !== undefined;
  if (!hasSession) {
    return "invite_required";
  }

  try {
    await context.dependencies.requireInviteAccess(session);
    return "ok";
  } catch (error) {
    const isInviteRequired = error instanceof InviteRequiredError;
    if (isInviteRequired) {
      return "invite_required";
    }

    const isInviteAccessRevoked = error instanceof InviteAccessRevokedError;
    if (isInviteAccessRevoked) {
      return "invite_disabled";
    }

    const isUserDisabled = error instanceof UserDisabledError;
    if (isUserDisabled) {
      return "user_disabled";
    }

    throw error;
  }
}

function readInviteRedeemReason(error: unknown): string {
  const isInviteRedeemError = error instanceof InviteRedeemError;
  if (isInviteRedeemError) {
    return error.reason;
  }

  const isInviteAccessRevoked = error instanceof InviteAccessRevokedError;
  if (isInviteAccessRevoked) {
    return error.reason;
  }

  const isUserDisabled = error instanceof UserDisabledError;
  if (isUserDisabled) {
    return "user_disabled";
  }

  return "invalid_code";
}

async function sendScanHistoryStream(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
  sessionPayload: string,
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  response.write("retry: 3000\n\n");

  let isClosed = false;
  request.on("close", () => {
    isClosed = true;
  });

  let previousPayload = "";
  while (!isClosed) {
    try {
      const activeSession = await loadActiveStreamSession(sessionPayload, context);
      const isSessionExpired = activeSession === "session_expired";
      if (isSessionExpired) {
        sendStreamSessionExpired(response);
        break;
      }
      const hasActiveSession = activeSession !== undefined;
      if (!hasActiveSession) {
        sendStreamAccessRevoked(response);
        break;
      }

      const payload = JSON.stringify(await loadScanHistoryResponse(context, activeSession));
      const hasChanged = payload !== previousPayload;
      if (hasChanged) {
        response.write(`event: history\ndata: ${payload}\n\n`);
        previousPayload = payload;
      } else {
        response.write(": keep-alive\n\n");
      }
    } catch (error) {
      writeStructuredLog({
        error: toStructuredLogError(error),
        message: "scan_history_stream_failed",
        severity: "WARNING",
      });
      response.write(`event: error\ndata: ${JSON.stringify({ error: "history_unavailable" })}\n\n`);
    }

    await sleep(3000);
  }
}

async function sendScanStream(
  request: IncomingMessage,
  response: ServerResponse,
  deliveryId: string,
  context: ConsoleServerContext,
  sessionPayload: string,
  session: ConsoleUserSession,
): Promise<void> {
  const run = await loadAuthorizedScanRun(deliveryId, context, session);
  const hasRun = run !== undefined;
  if (!hasRun) {
    sendText(response, 404, "Scan not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  response.write("retry: 3000\n\n");

  let isClosed = false;
  request.on("close", () => {
    isClosed = true;
  });

  let lastSequence = -1;
  while (!isClosed) {
    try {
      const activeSession = await loadActiveStreamSession(sessionPayload, context);
      const isSessionExpired = activeSession === "session_expired";
      if (isSessionExpired) {
        sendStreamSessionExpired(response);
        break;
      }
      const hasActiveSession = activeSession !== undefined;
      if (!hasActiveSession) {
        sendStreamAccessRevoked(response);
        break;
      }

      const activeRun = await loadAuthorizedScanRun(deliveryId, context, activeSession);
      const hasActiveRun = activeRun !== undefined;
      if (!hasActiveRun) {
        sendStreamAccessRevoked(response);
        break;
      }

      const rawChunks = await context.dependencies.listScanStreamChunks(deliveryId, lastSequence);
      const chunks = filterScanStreamChunksByScanRun(rawChunks, activeRun);
      for (const chunk of chunks) {
        response.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      for (const chunk of rawChunks) {
        lastSequence = chunk.sequence;
      }

      const hasVisibleChunks = chunks.length > 0;
      if (!hasVisibleChunks) {
        response.write(": keep-alive\n\n");
      }
    } catch (error) {
      writeStructuredLog({
        deliveryId,
        error: toStructuredLogError(error),
        message: "scan_stream_failed",
        severity: "WARNING",
      });
      response.write(`event: error\ndata: ${JSON.stringify({ error: "stream_unavailable" })}\n\n`);
    }

    await sleep(1000);
  }
}

function sendStreamAccessRevoked(response: ServerResponse): void {
  response.write(`event: error\ndata: ${JSON.stringify({ error: "access_revoked" })}\n\n`);
  response.end();
}

function sendStreamSessionExpired(response: ServerResponse): void {
  response.write(`event: error\ndata: ${JSON.stringify({ error: "session_expired" })}\n\n`);
  response.end();
}

async function loadActiveStreamSession(
  sessionPayload: string,
  context: ConsoleServerContext,
): Promise<ConsoleUserSession | "session_expired" | undefined> {
  const inviteAccess = await readInviteAccess(sessionPayload, context);
  const hasInviteAccess = inviteAccess === "ok";
  if (!hasInviteAccess) {
    return undefined;
  }

  const parsedSession = parseConsoleUserSession(sessionPayload);
  const hasParsedSession = parsedSession !== undefined;
  if (!hasParsedSession) {
    return undefined;
  }

  const session = await loadSessionAccess(parsedSession, context);
  return session ?? "session_expired";
}

async function sendLlmOutput(
  response: ServerResponse,
  deliveryId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const run = await loadAuthorizedScanRun(deliveryId, context, session);
  const objectPath = run?.llmOutputObjectPath;
  const hasObjectPath = objectPath !== undefined && objectPath.length > 0;
  if (!hasObjectPath) {
    sendText(response, 404, "LLM output is not available");
    return;
  }

  const body = await context.dependencies.readLlmOutputObject(objectPath);
  response.writeHead(200, {
    "cache-control": "private, no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

async function sendFixPrStream(
  request: IncomingMessage,
  response: ServerResponse,
  fixId: string,
  context: ConsoleServerContext,
  sessionPayload: string,
  session: ConsoleUserSession,
): Promise<void> {
  const run = await loadAuthorizedFixPrRun(fixId, context, session);
  const hasRun = run !== undefined;
  if (!hasRun) {
    sendText(response, 404, "Fix PR run not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  response.write("retry: 3000\n\n");

  let isClosed = false;
  request.on("close", () => {
    isClosed = true;
  });

  let lastSequence = -1;
  while (!isClosed) {
    try {
      const activeSession = await loadActiveStreamSession(sessionPayload, context);
      const isSessionExpired = activeSession === "session_expired";
      if (isSessionExpired) {
        sendStreamSessionExpired(response);
        break;
      }
      const hasActiveSession = activeSession !== undefined;
      if (!hasActiveSession) {
        sendStreamAccessRevoked(response);
        break;
      }

      const activeRun = await loadAuthorizedFixPrRun(fixId, context, activeSession);
      const hasActiveRun = activeRun !== undefined;
      if (!hasActiveRun) {
        sendStreamAccessRevoked(response);
        break;
      }

      const rawChunks = await context.dependencies.listFixPrStreamChunks(fixId, lastSequence);
      const chunks = filterFixPrStreamChunksByRun(rawChunks, activeRun);
      for (const chunk of chunks) {
        response.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      for (const chunk of rawChunks) {
        lastSequence = chunk.sequence;
      }

      const hasVisibleChunks = chunks.length > 0;
      if (!hasVisibleChunks) {
        response.write(": keep-alive\n\n");
      }
    } catch (error) {
      writeStructuredLog({
        error: toStructuredLogError(error),
        fixId,
        message: "fix_pr_stream_failed",
        severity: "WARNING",
      });
      response.write(`event: error\ndata: ${JSON.stringify({ error: "stream_unavailable" })}\n\n`);
    }

    await sleep(1000);
  }
}

async function sendFixPrLlmOutput(
  response: ServerResponse,
  fixId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<void> {
  const run = await loadAuthorizedFixPrRun(fixId, context, session);
  const objectPath = run?.llmOutputObjectPath;
  const hasObjectPath = objectPath !== undefined && objectPath.length > 0;
  if (!hasObjectPath) {
    sendText(response, 404, "LLM output is not available");
    return;
  }

  const body = await context.dependencies.readLlmOutputObject(objectPath);
  response.writeHead(200, {
    "cache-control": "private, no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

async function loadScanHistoryResponse(
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<{
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  sveSummaries: SveResolutionSummary[];
}> {
  const history = filterScanRunsByRepositoryAccess(
    await context.dependencies.listScanExecutions(),
    session,
  );
  const findingsByRun = await loadFindingsByRun(history, context);
  const sveSummaries = createSveResolutionSummaries(history, findingsByRun);
  return { findingsByRun, history, sveSummaries };
}

async function loadAuthorizedScanRun(
  deliveryId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<ScanRunRecord | undefined> {
  const run = await context.dependencies.readScanRunRecord(deliveryId);
  const hasRun = run !== undefined;
  if (!hasRun) {
    return undefined;
  }

  const canAccess = canAccessScanRun(session, run);
  if (!canAccess) {
    return undefined;
  }

  return run;
}

function filterScanRunsByRepositoryAccess(
  history: ScanRunRecord[],
  session: ConsoleUserSession,
): ScanRunRecord[] {
  return history.filter((run) => canAccessScanRun(session, run));
}

function filterScanFindingsByRepositoryAccess(
  findings: ScanFindingRecord[],
  session: ConsoleUserSession,
): ScanFindingRecord[] {
  return findings.filter((finding) => {
    const hasAccessibleRepositoryIds = Array.isArray(session.accessibleRepositoryIds);
    if (hasAccessibleRepositoryIds) {
      return (session.accessibleRepositoryIds ?? []).includes(finding.repositoryId);
    }

    return canAccessRepositoryFullName(session, finding.repoFullName);
  });
}

export function filterInstallationPoliciesForRepositoryAccess(
  policies: InstallationPolicy[],
  session: ConsoleUserSession,
): InstallationPolicy[] {
  return policies
    .filter((policy) => canAccessInstallationPolicy(session, policy))
    .map((policy) => ({
      ...policy,
      repositoryCount: countAccessiblePolicyRepositories(policy, session),
    }));
}

function canAccessInstallationPolicy(
  session: ConsoleUserSession,
  policy: InstallationPolicy,
): boolean {
  return countAccessiblePolicyRepositories(policy, session) > 0;
}

function countAccessiblePolicyRepositories(
  policy: InstallationPolicy,
  session: ConsoleUserSession,
): number {
  const normalizedPolicyOwner = policy.accountLogin.trim().toLowerCase();
  return (session.accessibleRepositoryFullNames ?? []).filter((repositoryFullName) => {
    const [owner] = repositoryFullName.split("/");
    const hasOwner = owner !== undefined && owner.length > 0;
    if (!hasOwner) {
      return false;
    }

    return owner.trim().toLowerCase() === normalizedPolicyOwner;
  }).length;
}

function canAccessScanRun(session: ConsoleUserSession, run: ScanRunRecord): boolean {
  const hasAccessibleRepositoryIds = Array.isArray(session.accessibleRepositoryIds);
  if (hasAccessibleRepositoryIds) {
    return (session.accessibleRepositoryIds ?? []).includes(run.repositoryId);
  }

  return canAccessRepositoryFullName(session, `${run.owner}/${run.repo}`);
}

async function loadAuthorizedFixPrRun(
  fixId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<FixPrRunRecord | undefined> {
  const run = await context.dependencies.readFixPrRunRecord(fixId);
  const hasRun = run !== undefined;
  if (!hasRun) {
    return undefined;
  }

  const [authorizedRun] = filterFixPrRunsByRepositoryAccess([run], session);
  return authorizedRun;
}

async function loadScanDetailResponse(
  deliveryId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<
  | {
      chunks: ScanStreamChunkRecord[];
      findings: ScanFindingRecord[];
      run: ScanRunRecord;
    }
  | undefined
> {
  const run = await loadAuthorizedScanRun(deliveryId, context, session);
  const hasRun = run !== undefined;
  if (!hasRun) {
    return undefined;
  }

  const findings = filterScanFindingsByScanRun(
    filterScanFindingsByRepositoryAccess(
      await context.dependencies.listScanFindingRecords([deliveryId]),
      session,
    ),
    run,
  );
  const chunks = filterScanStreamChunksByScanRun(
    await context.dependencies.listScanStreamChunks(deliveryId),
    run,
  );
  return { chunks, findings, run };
}

export function filterScanFindingsByScanRun(
  findings: ScanFindingRecord[],
  run: ScanRunRecord,
): ScanFindingRecord[] {
  const runRepoFullName = `${run.owner}/${run.repo}`.toLowerCase();
  return findings.filter((finding) => {
    const isSameRepositoryId = finding.repositoryId === run.repositoryId;
    const isSameRepoFullName = finding.repoFullName.trim().toLowerCase() === runRepoFullName;
    return isSameRepositoryId && isSameRepoFullName;
  });
}

export function filterScanStreamChunksByScanRun(
  chunks: ScanStreamChunkRecord[],
  run: ScanRunRecord,
): ScanStreamChunkRecord[] {
  const runRepoFullName = `${run.owner}/${run.repo}`.toLowerCase();
  return chunks.filter((chunk) => {
    const isSameRepositoryId = chunk.repositoryId === run.repositoryId;
    const isSameRepoFullName = chunk.repoFullName.trim().toLowerCase() === runRepoFullName;
    return isSameRepositoryId && isSameRepoFullName;
  });
}

export function filterFixPrStreamChunksByRun(
  chunks: FixPrStreamChunkRecord[],
  run: FixPrRunRecord,
): FixPrStreamChunkRecord[] {
  const runRepoFullName = `${run.owner}/${run.repo}`.toLowerCase();
  return chunks.filter((chunk) => {
    const isSameRepositoryId = chunk.repositoryId === run.repositoryId;
    const isSameRepoFullName = chunk.repoFullName.trim().toLowerCase() === runRepoFullName;
    return isSameRepositoryId && isSameRepoFullName;
  });
}

async function loadSveDetailResponse(
  sveId: string,
  context: ConsoleServerContext,
  session: ConsoleUserSession,
): Promise<{
  fixPrRuns: FixPrRunRecord[];
  findings: ScanFindingRecord[];
  history: ScanRunRecord[];
  source?: SveSourceContext;
  summary?: SveResolutionSummary;
  sveId: string;
}> {
  const recentHistory = filterScanRunsByRepositoryAccess(
    await context.dependencies.listScanExecutions(),
    session,
  );
  const findings = filterScanFindingsByRepositoryAccess(
    await context.dependencies.listScanFindingRecordsBySveId(sveId),
    session,
  );
  const deliveryIds = new Set(findings.map((finding) => finding.deliveryId));
  const directHistory = filterScanRunsByRepositoryAccess(
    await loadScanRunsByDeliveryIds(deliveryIds, context),
    session,
  );
  const allHistory = mergeScanRunRecords(recentHistory, directHistory);
  const allFindingsByRun = await loadFindingsByRun(allHistory, context);
  const findingsInLoadedHistory = Object.values(allFindingsByRun)
    .flat()
    .filter((finding) => (finding.sveId ?? finding.findingId) === sveId);
  const history = allHistory.filter((run) => deliveryIds.has(run.deliveryId));
  const summaryFindings = findings.length > 0 ? findings : findingsInLoadedHistory;
  const summary =
    summaryFindings.length > 0
      ? createSveResolutionSummary(sveId, summaryFindings, allHistory, allFindingsByRun)
      : undefined;
  const source = await loadSveSourceContext(findings, history, context);
  const fixPrRuns = filterFixPrRunsByRepositoryAccess(
    await context.dependencies.listFixPrRunsBySveId(sveId),
    session,
  );
  return {
    fixPrRuns,
    findings,
    history,
    ...(source === undefined ? {} : { source }),
    ...(summary === undefined ? {} : { summary }),
    sveId,
  };
}

async function loadScanRunsByDeliveryIds(
  deliveryIds: Set<string>,
  context: ConsoleServerContext,
): Promise<ScanRunRecord[]> {
  const runs = await Promise.all(
    [...deliveryIds].map((deliveryId) => context.dependencies.readScanRunRecord(deliveryId)),
  );
  return runs.filter((run): run is ScanRunRecord => run !== undefined);
}

function mergeScanRunRecords(
  primary: ScanRunRecord[],
  secondary: ScanRunRecord[],
): ScanRunRecord[] {
  const recordsByDeliveryId = new Map<string, ScanRunRecord>();
  for (const run of primary) {
    recordsByDeliveryId.set(run.deliveryId, run);
  }
  for (const run of secondary) {
    recordsByDeliveryId.set(run.deliveryId, run);
  }

  return [...recordsByDeliveryId.values()].sort((left, right) =>
    right.queuedAt.localeCompare(left.queuedAt),
  );
}

export function filterFixPrRunsByRepositoryAccess(
  fixPrRuns: FixPrRunRecord[],
  session: ConsoleUserSession,
): FixPrRunRecord[] {
  return fixPrRuns.filter((run) => {
    const hasAccessibleRepositoryIds = Array.isArray(session.accessibleRepositoryIds);
    if (hasAccessibleRepositoryIds) {
      return (session.accessibleRepositoryIds ?? []).includes(run.repositoryId);
    }

    return canAccessRepositoryFullName(session, `${run.owner}/${run.repo}`);
  });
}

async function loadSveSourceContext(
  findings: ScanFindingRecord[],
  history: ScanRunRecord[],
  context: ConsoleServerContext,
): Promise<SveSourceContext | undefined> {
  const latestFinding = findings.find((finding) => finding.file !== undefined);
  const hasFinding = latestFinding !== undefined;
  if (!hasFinding) {
    return undefined;
  }

  const file = latestFinding.file;
  const hasFile = file !== undefined && file.length > 0;
  if (!hasFile) {
    return undefined;
  }

  const run = history.find((candidate) => candidate.deliveryId === latestFinding.deliveryId);
  const hasRun = run !== undefined;
  if (!hasRun) {
    return undefined;
  }

  const githubUrl = createGitHubBlobUrl(run, file, latestFinding.startLine, latestFinding.endLine);
  const baseContext: SveSourceContext = {
    commitSha: run.headSha,
    file,
    githubUrl,
    language: detectMonacoLanguage(file),
    ...(latestFinding.endLine === undefined ? {} : { endLine: latestFinding.endLine }),
    ...(latestFinding.startLine === undefined ? {} : { startLine: latestFinding.startLine }),
  };

  try {
    const content = await readRepositorySourceAtCommit(run, file, context.env);
    const hasContent = content !== undefined;
    if (!hasContent) {
      return {
        ...baseContext,
        error: "Source file was not found at the scanned commit.",
      };
    }

    const isTooLarge = content.length > 250_000;
    if (isTooLarge) {
      return {
        ...baseContext,
        error: "Source file is too large to preview.",
      };
    }

    return { ...baseContext, content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStructuredLog({
      deliveryId: run.deliveryId,
      error: toStructuredLogError(error),
      file,
      message: "sve_source_preview_failed",
      severity: "WARNING",
    });
    return { ...baseContext, error: message };
  }
}

async function readRepositorySourceAtCommit(
  run: ScanRunRecord,
  file: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App is not configured");
  }

  const token = await createInstallationToken(config, run.installationId);
  const apiBaseUrl = config.apiBaseUrl;
  const github = new GitHubClient(apiBaseUrl === undefined ? { token } : { apiBaseUrl, token });
  return github.getRepositoryFile(run.owner, run.repo, file, run.headSha);
}

function createGitHubBlobUrl(
  run: ScanRunRecord,
  file: string,
  startLine: number | undefined,
  endLine: number | undefined,
): string {
  const encodedFile = file.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `https://github.com/${run.owner}/${run.repo}/blob/${run.headSha}/${encodedFile}`,
  );
  const hasStartLine = startLine !== undefined;
  if (!hasStartLine) {
    return url.toString();
  }

  const hasRange = endLine !== undefined && endLine !== startLine;
  url.hash = hasRange ? `L${startLine}-L${endLine}` : `L${startLine}`;
  return url.toString();
}

function detectMonacoLanguage(file: string): string {
  const extension = extname(file).toLowerCase();
  switch (extension) {
    case ".cjs":
    case ".js":
    case ".jsx":
      return "javascript";
    case ".mjs":
    case ".mts":
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".json":
      return "json";
    case ".md":
    case ".mdx":
      return "markdown";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".tf":
      return "hcl";
    case ".rs":
      return "rust";
    case ".sh":
      return "shell";
    case ".toml":
      return "toml";
    default:
      return "plaintext";
  }
}

export async function loadFindingsByRun(
  runs: ScanRunRecord[],
  context: ConsoleServerContext,
): Promise<Record<string, ScanFindingRecord[]>> {
  const deliveryIds = runs.map((run) => run.deliveryId);
  const findings = await context.dependencies.listScanFindingRecords(deliveryIds);
  const runsByDeliveryId = new Map(runs.map((run) => [run.deliveryId, run]));
  const findingsByRun: Record<string, ScanFindingRecord[]> = {};
  for (const finding of findings) {
    const run = runsByDeliveryId.get(finding.deliveryId);
    const hasRun = run !== undefined;
    if (!hasRun) {
      continue;
    }

    const [matchingFinding] = filterScanFindingsByScanRun([finding], run);
    const isSameRunRepository = matchingFinding !== undefined;
    if (!isSameRunRepository) {
      continue;
    }

    findingsByRun[finding.deliveryId] ??= [];
    findingsByRun[finding.deliveryId]?.push(finding);
  }

  return findingsByRun;
}

function readSveIdApiPath(pathname: string): string | undefined {
  const prefix = "/api/sve/";
  const isSvePath = pathname.startsWith(prefix);
  if (!isSvePath) {
    return undefined;
  }

  const rawSveId = pathname.slice(prefix.length);
  const sveId = safeDecodeURIComponent(rawSveId);
  const hasSveId = sveId.length > 0;
  if (!hasSveId) {
    return undefined;
  }

  return sveId;
}

function readSveFixPrApiPath(pathname: string): string | undefined {
  const prefix = "/api/sve/";
  const suffix = "/fix-prs";
  const isSveFixPrPath = pathname.startsWith(prefix) && pathname.endsWith(suffix);
  if (!isSveFixPrPath) {
    return undefined;
  }

  const rawSveId = pathname.slice(prefix.length, -suffix.length);
  const sveId = safeDecodeURIComponent(rawSveId);
  const hasSveId = sveId.length > 0;
  if (!hasSveId) {
    return undefined;
  }

  return sveId;
}

function readFixPrRunApiPath(pathname: string): string | undefined {
  const prefix = "/api/fix-prs/";
  const isFixPrRunPath = pathname.startsWith(prefix);
  if (!isFixPrRunPath) {
    return undefined;
  }

  const rawFixId = pathname.slice(prefix.length);
  const hasSubresource = rawFixId.includes("/");
  if (hasSubresource) {
    return undefined;
  }

  const fixId = safeDecodeURIComponent(rawFixId);
  const hasFixId = fixId.length > 0;
  if (!hasFixId) {
    return undefined;
  }

  return fixId;
}

function readFixPrStreamApiPath(pathname: string): string | undefined {
  return readFixPrRunSubresourcePath(pathname, "/stream");
}

function readFixPrLlmOutputApiPath(pathname: string): string | undefined {
  return readFixPrRunSubresourcePath(pathname, "/llm-output");
}

function readScanStreamApiPath(pathname: string): string | undefined {
  return readScanRunSubresourcePath(pathname, "/stream");
}

function readLlmOutputApiPath(pathname: string): string | undefined {
  return readScanRunSubresourcePath(pathname, "/llm-output");
}

function readScanIssueApiPath(pathname: string): string | undefined {
  return readScanRunSubresourcePath(pathname, "/issues");
}

function readScanCancelApiPath(pathname: string): string | undefined {
  return readScanRunSubresourcePath(pathname, "/cancel");
}

function readScanDetailApiPath(pathname: string): string | undefined {
  const prefix = "/api/scans/";
  const isScanPath = pathname.startsWith(prefix);
  if (!isScanPath) {
    return undefined;
  }

  const rawDeliveryId = pathname.slice(prefix.length);
  const hasDeliveryId = rawDeliveryId.length > 0;
  const hasSubresource = rawDeliveryId.includes("/");
  if (!hasDeliveryId || hasSubresource) {
    return undefined;
  }

  const deliveryId = safeDecodeURIComponent(rawDeliveryId);
  const hasDecodedDeliveryId = deliveryId.length > 0;
  if (!hasDecodedDeliveryId) {
    return undefined;
  }

  return deliveryId;
}

function readInstallationPolicySettingsApiPath(pathname: string): string | undefined {
  const prefix = "/api/settings/installation-policies/";
  const isPolicyPath = pathname.startsWith(prefix);
  if (!isPolicyPath) {
    return undefined;
  }

  const rawInstallationId = pathname.slice(prefix.length);
  const hasInstallationId = rawInstallationId.length > 0;
  if (!hasInstallationId) {
    return undefined;
  }

  const installationId = safeDecodeURIComponent(rawInstallationId);
  const hasDecodedInstallationId = installationId.length > 0;
  if (!hasDecodedInstallationId) {
    return undefined;
  }

  return installationId;
}

function readScanPolicySettingsApiPath(pathname: string): string | undefined {
  const prefix = "/api/settings/scan-policies/";
  const isPolicyPath = pathname.startsWith(prefix);
  if (!isPolicyPath) {
    return undefined;
  }

  const rawPolicyId = pathname.slice(prefix.length);
  const hasPolicyId = rawPolicyId.length > 0;
  if (!hasPolicyId) {
    return undefined;
  }

  const policyId = safeDecodeURIComponent(rawPolicyId);
  const hasDecodedPolicyId = policyId.length > 0;
  if (!hasDecodedPolicyId) {
    return undefined;
  }

  return policyId;
}

function readScanPolicyCreateInputFromJsonBody(body: string): ScanPolicyCreateInput {
  const parsed = readJsonObjectBody(body, "Invalid scan policy request body");
  const installationId = Number(parsed.installationId);
  const isInstallationIdValid = Number.isInteger(installationId) && installationId > 0;
  if (!isInstallationIdValid) {
    throw new Error("Invalid installationId");
  }

  const enabled = parsed.enabled;
  const hasEnabled = enabled !== undefined;
  if (hasEnabled && typeof enabled !== "boolean") {
    throw new Error("Invalid enabled");
  }

  return {
    enabled: enabled ?? true,
    installationId,
    name: readRequiredJsonString(parsed, "name"),
    rule: readRequiredJsonString(parsed, "rule"),
  };
}

function readScanPolicyUpdateInputFromJsonBody(body: string): ScanPolicyUpdateInput {
  const parsed = readJsonObjectBody(body, "Invalid scan policy request body");
  const enabled = parsed.enabled;
  const hasEnabled = enabled !== undefined;
  if (hasEnabled && typeof enabled !== "boolean") {
    throw new Error("Invalid enabled");
  }

  const name = parsed.name;
  const hasName = name !== undefined;
  if (hasName && (typeof name !== "string" || name.trim().length === 0)) {
    throw new Error("Invalid name");
  }

  const rule = parsed.rule;
  const hasRule = rule !== undefined;
  if (hasRule && (typeof rule !== "string" || rule.trim().length === 0)) {
    throw new Error("Invalid rule");
  }

  return {
    ...(hasEnabled ? { enabled } : {}),
    ...(hasName ? { name } : {}),
    ...(hasRule ? { rule } : {}),
  };
}

function readFindingIdFromJsonBody(body: string): string | undefined {
  const hasBody = body.length > 0;
  if (!hasBody) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  const isObject = typeof parsed === "object" && parsed !== null;
  if (!isObject) {
    return undefined;
  }

  const findingId = (parsed as { findingId?: unknown }).findingId;
  const hasFindingId = typeof findingId === "string" && findingId.length > 0;
  if (!hasFindingId) {
    return undefined;
  }

  return findingId;
}

function readFixPrInputFromJsonBody(
  body: string,
): { findingId: string; llmModel?: string } | undefined {
  const hasBody = body.length > 0;
  if (!hasBody) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  const isObject = typeof parsed === "object" && parsed !== null;
  if (!isObject) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const findingId = record.findingId;
  const hasFindingId = typeof findingId === "string" && findingId.length > 0;
  if (!hasFindingId) {
    return undefined;
  }

  const llmModel = record.llmModel;
  const hasLlmModel = typeof llmModel === "string" && llmModel.length > 0;
  return {
    findingId,
    ...(hasLlmModel ? { llmModel } : {}),
  };
}

function readInstallationPolicyUpdateInputFromJsonBody(
  body: string,
): InstallationPolicyUpdateInput {
  const parsed = readJsonObjectBody(body, "Invalid installation policy request body");
  const enabled = parsed.enabled;
  const hasEnabled = typeof enabled === "boolean";
  if (!hasEnabled) {
    throw new Error("Invalid enabled");
  }

  const inviteCode = parsed.inviteCode;
  const hasInviteCode = inviteCode !== undefined;
  if (hasInviteCode && typeof inviteCode !== "string") {
    throw new Error("Invalid inviteCode");
  }

  return {
    enabled,
    ...(hasInviteCode ? { inviteCode } : {}),
  };
}

function readScheduledScanUpdateInputFromJsonBody(body: string): {
  enabled: boolean;
  schedule: string;
  timeZone: string;
} {
  const parsed = readJsonObjectBody(body, "Invalid scheduled scan request body");
  const enabled = parsed.enabled;
  const hasEnabled = typeof enabled === "boolean";
  if (!hasEnabled) {
    throw new Error("Invalid enabled");
  }

  return {
    enabled,
    schedule: readRequiredJsonString(parsed, "schedule"),
    timeZone: readRequiredJsonString(parsed, "timeZone"),
  };
}

function readSveVerificationInputFromJsonBody(
  body: string,
): BatchRepositoryManualScanInput & { sveIds?: string[] } {
  const hasBody = body.length > 0;
  if (!hasBody) {
    return { llmEnabled: true, osvEnabled: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Invalid SVE verification request body");
  }

  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isObject) {
    throw new Error("Invalid SVE verification request body");
  }

  const record = parsed as Record<string, unknown>;
  const llmModel = readOptionalJsonString(record, "llmModel");
  const sveIds = record.sveIds;
  const hasSveIds = sveIds !== undefined;
  if (!hasSveIds) {
    return {
      llmEnabled: true,
      ...(llmModel === undefined ? {} : { llmModel }),
      osvEnabled: true,
    };
  }

  const isStringArray = Array.isArray(sveIds) && sveIds.every((sveId) => typeof sveId === "string");
  if (!isStringArray) {
    throw new Error("Invalid sveIds");
  }

  return {
    llmEnabled: true,
    ...(llmModel === undefined ? {} : { llmModel }),
    osvEnabled: true,
    sveIds: [...new Set(sveIds.map((sveId) => sveId.trim()).filter((sveId) => sveId.length > 0))],
  };
}

function readJsonObjectBody(body: string, message: string): Record<string, unknown> {
  const hasBody = body.length > 0;
  if (!hasBody) {
    throw new Error(message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(message);
  }

  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isObject) {
    throw new Error(message);
  }

  return parsed as Record<string, unknown>;
}

function readRequiredJsonString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  const hasValue = typeof value === "string" && value.trim().length > 0;
  if (!hasValue) {
    throw new Error(`Invalid ${key}`);
  }

  return value.trim();
}

function readScanRunSubresourcePath(pathname: string, suffix: string): string | undefined {
  const prefix = "/api/scans/";
  const hasPrefix = pathname.startsWith(prefix);
  const hasSuffix = pathname.endsWith(suffix);
  if (!hasPrefix || !hasSuffix) {
    return undefined;
  }

  const rawDeliveryId = pathname.slice(prefix.length, -suffix.length);
  const hasDeliveryId = rawDeliveryId.length > 0;
  if (!hasDeliveryId) {
    return undefined;
  }

  const deliveryId = safeDecodeURIComponent(rawDeliveryId);
  const hasDecodedDeliveryId = deliveryId.length > 0;
  if (!hasDecodedDeliveryId) {
    return undefined;
  }

  return deliveryId;
}

function readFixPrRunSubresourcePath(pathname: string, suffix: string): string | undefined {
  const prefix = "/api/fix-prs/";
  const hasPrefix = pathname.startsWith(prefix);
  const hasSuffix = pathname.endsWith(suffix);
  if (!hasPrefix || !hasSuffix) {
    return undefined;
  }

  const rawFixId = pathname.slice(prefix.length, -suffix.length);
  const hasFixId = rawFixId.length > 0;
  if (!hasFixId) {
    return undefined;
  }

  const fixId = safeDecodeURIComponent(rawFixId);
  const hasDecodedFixId = fixId.length > 0;
  if (!hasDecodedFixId) {
    return undefined;
  }

  return fixId;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function readRepositoryConfigApiPath(
  pathname: string,
): { owner: string; repo: string } | undefined {
  const prefix = "/api/repositories/";
  const suffix = "/config";
  const hasPrefix = pathname.startsWith(prefix);
  const hasSuffix = pathname.endsWith(suffix);
  if (!hasPrefix || !hasSuffix) {
    return undefined;
  }

  const rawPath = pathname.slice(prefix.length, -suffix.length);
  const parts = rawPath.split("/");
  const hasRepositoryPath = parts.length === 2;
  if (!hasRepositoryPath) {
    return undefined;
  }

  const [encodedOwner = "", encodedRepo = ""] = parts;
  const owner = safeDecodeURIComponent(encodedOwner);
  const repo = safeDecodeURIComponent(encodedRepo);
  const hasOwnerAndRepo = owner.length > 0 && repo.length > 0;
  if (!hasOwnerAndRepo) {
    return undefined;
  }

  return { owner, repo };
}

function readRepositoryBranchesApiPath(
  pathname: string,
): { owner: string; repo: string } | undefined {
  const prefix = "/api/repositories/";
  const suffix = "/branches";
  const hasPrefix = pathname.startsWith(prefix);
  const hasSuffix = pathname.endsWith(suffix);
  if (!hasPrefix || !hasSuffix) {
    return undefined;
  }

  const rawPath = pathname.slice(prefix.length, -suffix.length);
  const parts = rawPath.split("/");
  const hasRepositoryPath = parts.length === 2;
  if (!hasRepositoryPath) {
    return undefined;
  }

  const [encodedOwner = "", encodedRepo = ""] = parts;
  const owner = safeDecodeURIComponent(encodedOwner);
  const repo = safeDecodeURIComponent(encodedRepo);
  const hasOwnerAndRepo = owner.length > 0 && repo.length > 0;
  if (!hasOwnerAndRepo) {
    return undefined;
  }

  return { owner, repo };
}

function readRepositoryManualScanInputFromJson(body: string): RepositoryManualScanInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Invalid Scan request body");
  }

  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isObject) {
    throw new Error("Invalid Scan request body");
  }

  const record = parsed as Record<string, unknown>;
  const configSource = readOptionalJsonString(record, "configSource");
  const llmEnabled = readRequiredJsonBoolean(record, "llmEnabled");
  const llmModel = readOptionalJsonString(record, "llmModel");
  const osvEnabled = readRequiredJsonBoolean(record, "osvEnabled");
  const repositoryId = readJsonPositiveInteger(record, "repositoryId");
  const input: RepositoryManualScanInput = {
    defaultBranch: readJsonString(record, "defaultBranch"),
    defaultBranchHeadSha: readJsonString(record, "defaultBranchHeadSha"),
    installationId: readJsonPositiveInteger(record, "installationId"),
    llmEnabled,
    ...(llmModel === undefined ? {} : { llmModel }),
    osvEnabled,
    owner: readJsonString(record, "owner"),
    repo: readJsonString(record, "repo"),
    repositoryId,
    ...(configSource === undefined ? {} : { configSource }),
  };
  const isConfigTooLarge = configSource !== undefined && configSource.length > 100_000;
  if (isConfigTooLarge) {
    throw new Error("Configuration YAML is too large");
  }

  const isLlmModelTooLarge = llmModel !== undefined && llmModel.length > 200;
  if (isLlmModelTooLarge) {
    throw new Error("LLM model is too large");
  }

  return input;
}

function readBatchRepositoryManualScanInputFromFormBody(
  body: string,
): BatchRepositoryManualScanInput {
  const params = new URLSearchParams(body);
  const llmEnabled = readRequiredFormBoolean(params, "llmEnabled");
  const osvEnabled = readRequiredFormBoolean(params, "osvEnabled");
  const llmModel = params.get("llmModel")?.trim();
  const hasLlmModel = llmModel !== undefined && llmModel.length > 0;
  if (!hasLlmModel) {
    return { llmEnabled, osvEnabled };
  }

  const isLlmModelTooLarge = llmModel.length > 200;
  if (isLlmModelTooLarge) {
    throw new Error("LLM model is too large");
  }

  return { llmEnabled, llmModel, osvEnabled };
}

function readRequiredJsonBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  const isBoolean = typeof value === "boolean";
  if (!isBoolean) {
    throw new Error(`Invalid ${key}`);
  }

  return value;
}

function readRequiredFormBoolean(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  const isTrue = value === "true";
  if (isTrue) {
    return true;
  }

  const isFalse = value === "false";
  if (isFalse) {
    return false;
  }

  throw new Error(`Invalid ${key}`);
}

function readJsonString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  const isString = typeof value === "string";
  if (!isString) {
    throw new Error(`Missing ${key}`);
  }

  const trimmed = value.trim();
  const hasValue = trimmed.length > 0;
  if (!hasValue) {
    throw new Error(`Missing ${key}`);
  }

  return trimmed;
}

function readOptionalJsonString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  const hasValue = value !== undefined;
  if (!hasValue) {
    return undefined;
  }

  const isString = typeof value === "string";
  if (!isString) {
    throw new Error(`Invalid ${key}`);
  }

  return value.trim();
}

function readJsonPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  const isNumber = typeof value === "number" && Number.isInteger(value) && value > 0;
  const isInvalidNumber = !isNumber;
  if (isInvalidNumber) {
    throw new Error(`Invalid ${key}`);
  }

  return value;
}

function readPositiveIntegerSearchParam(requestUrl: URL, key: string): number | undefined {
  const value = requestUrl.searchParams.get(key);
  const hasValue = value !== null && value.length > 0;
  if (!hasValue) {
    return undefined;
  }

  const parsed = Number(value);
  const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
  if (!isPositiveInteger) {
    return undefined;
  }

  return parsed;
}

function isGitHubIssuePermissionError(error: unknown): boolean {
  const isError = error instanceof Error;
  if (!isError) {
    return false;
  }

  const hasForbiddenStatus = error.message.includes("GitHub request failed: 403");
  const hasIntegrationPermissionMessage = error.message.includes(
    "Resource not accessible by integration",
  );
  return hasForbiddenStatus && hasIntegrationPermissionMessage;
}

function isGitHubFixPrPermissionError(error: unknown): boolean {
  const isError = error instanceof Error;
  if (!isError) {
    return false;
  }

  const hasForbiddenStatus = error.message.includes("GitHub request failed: 403");
  const hasIntegrationPermissionMessage = error.message.includes(
    "Resource not accessible by integration",
  );
  const hasInstallationTokenPermissionMessage =
    error.message.includes("Failed to create installation token: 403") ||
    error.message.includes("Failed to create installation token: 422");
  const hasNormalizedFixPrPermissionMessage = error.message.includes(
    "GitHub App requires Contents: Read and write and Pull requests: Read and write permissions",
  );
  return (
    (hasForbiddenStatus && hasIntegrationPermissionMessage) ||
    hasInstallationTokenPermissionMessage ||
    hasNormalizedFixPrPermissionMessage
  );
}

async function sendClientApp(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  const hasViteDevServer = context.viteDevServer !== undefined;
  if (hasViteDevServer) {
    const html = await readFile(resolve(process.cwd(), "index.html"), "utf8");
    const transformedHtml =
      (await context.viteDevServer?.transformIndexHtml?.(request.url ?? "/", html)) ?? html;
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    const isHeadRequest = request.method === "HEAD";
    if (isHeadRequest) {
      response.end();
      return;
    }

    response.end(transformedHtml);
    return;
  }

  const html = await readFile(join(context.clientDirectory, "index.html"), "utf8");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
  });
  const isHeadRequest = request.method === "HEAD";
  if (isHeadRequest) {
    response.end();
    return;
  }

  response.end(html);
}

async function sendStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: ConsoleServerContext,
): Promise<boolean> {
  const hasViteDevServer = context.viteDevServer !== undefined;
  if (hasViteDevServer) {
    await runViteMiddleware(request, response, context);
    return true;
  }

  const decodedPath = safeDecodeURIComponent(pathname);
  const hasDecodedPath = decodedPath.length > 0;
  if (!hasDecodedPath) {
    sendText(response, 404, "Not Found");
    return true;
  }

  const normalizedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const assetPath = resolve(context.clientDirectory, `.${normalizedPath}`);
  const isInsideClientDirectory = assetPath.startsWith(context.clientDirectory);
  if (!isInsideClientDirectory) {
    sendText(response, 403, "Forbidden");
    return true;
  }

  const assetStat = await stat(assetPath).catch(() => undefined);
  const isFile = assetStat?.isFile() === true;
  if (!isFile) {
    return false;
  }

  response.writeHead(200, {
    "content-length": String(assetStat.size),
    "content-type": readContentType(assetPath),
  });
  const isHeadRequest = request.method === "HEAD";
  if (isHeadRequest) {
    response.end();
    return true;
  }

  createReadStream(assetPath).pipe(response);
  return true;
}

async function runViteMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleServerContext,
): Promise<void> {
  const viteDevServer = context.viteDevServer;
  const hasViteDevServer = viteDevServer !== undefined;
  if (!hasViteDevServer) {
    return;
  }

  await new Promise<void>((resolveMiddleware) => {
    const finish = () => {
      cleanup();
      resolveMiddleware();
    };
    const next = () => {
      cleanup();
      resolveMiddleware();
    };
    const cleanup = () => {
      response.off("finish", finish);
      response.off("close", finish);
    };
    response.on("finish", finish);
    response.on("close", finish);
    viteDevServer.middlewares(request, response, next);
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function readSession(request: IncomingMessage, context: ConsoleServerContext): string | undefined {
  return readSignedSessionCookie(
    request.headers.cookie ?? null,
    context.dependencies.readSessionSecret(),
  );
}

function readRequestUrl(request: IncomingMessage, context: ConsoleServerContext): URL {
  const hostHeader = request.headers.host ?? `localhost:${context.port}`;
  const protocol = context.env.NODE_ENV === "production" ? "https" : "http";
  return new URL(request.url ?? "/", `${protocol}://${hostHeader}`);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

function sendRedirect(
  response: ServerResponse,
  location: string,
  status = 302,
  cookies: string[] = [],
): void {
  response.writeHead(status, {
    location,
    ...(cookies.length > 0 ? { "set-cookie": cookies } : {}),
  });
  response.end();
}

function createOAuthStateCookie(state: string): string {
  return [
    `${productOAuthStateCookieName}=${state}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Secure",
    "Max-Age=600",
  ].join("; ");
}

function createExpiredOAuthStateCookie(): string {
  return [
    `${productOAuthStateCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0",
  ].join("; ");
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  const hasCookie = cookieHeader !== null && cookieHeader.length > 0;
  if (!hasCookie) {
    return undefined;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const hasMatchingCookie = cookie !== undefined;
  if (!hasMatchingCookie) {
    return undefined;
  }

  return cookie.slice(name.length + 1);
}

function isPublicAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@vite/") ||
    pathname === "/@react-refresh" ||
    pathname === "/__vite_ping" ||
    pathname === "/favicon.ico"
  );
}

function readContentType(filePath: string): string {
  const extension = extname(filePath);
  const contentType = contentTypes[extension];
  const hasContentType = contentType !== undefined;
  if (hasContentType) {
    return contentType;
  }

  return "application/octet-stream";
}

async function createViteDevServer({
  isProduction,
}: {
  isProduction: boolean;
}): Promise<ViteDevServerLike | undefined> {
  if (isProduction) {
    return undefined;
  }

  const { createServer: createViteServer } = await import("vite");
  return createViteServer({
    appType: "spa",
    server: {
      middlewareMode: true,
    },
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};
