import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type {
  FixPrRunRecord,
  FixPrStreamChunkRecord,
  ScanFindingRecord,
  ScanRunRecord,
} from "@scanveil/core";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import ConsoleDashboard, {
  dashboardShell,
  type ConsoleDashboardMode,
} from "./components/ConsoleDashboard";
import ConsoleSettingsPage from "./components/ConsoleSettingsPage";
import ConsoleShell from "./components/ConsoleShell";
import FixPrDetailPage, { type FixPrDetailData } from "./components/FixPrDetailPage";
import InvitePage from "./components/InvitePage";
import LoginPage from "./components/LoginPage";
import ScanDetailPage, { type ScanDetailData } from "./components/ScanDetailPage";
import SveDetailPage, { type SveDetailData } from "./components/SveDetailPage";
import type { RepositoryDashboardData } from "./github-installations";
import type { SveResolutionSummary } from "./sve-status";

interface DashboardResponse {
  dashboard: RepositoryDashboardData;
}

interface ScanHistoryResponse {
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  sveSummaries: SveResolutionSummary[];
}

interface FixPrRunsResponse {
  fixPrRuns: FixPrRunRecord[];
}

interface FixPrRunResponse {
  chunks?: FixPrStreamChunkRecord[];
  fixPrRun: FixPrRunRecord;
}

interface BrowserRoute {
  hash: string;
  pathname: string;
  search: string;
}

const dashboardQueryKey = ["dashboard"] as const;
const fixPrRunsQueryKey = ["fixPrRuns"] as const;
const scanHistoryQueryKey = ["scanHistory"] as const;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 3000,
    },
  },
});

function App() {
  const route = useBrowserRoute();
  const isLoginPath = route.pathname === "/login";
  if (isLoginPath) {
    return <LoginPage />;
  }

  const isInvitePath = route.pathname === "/invite";
  if (isInvitePath) {
    return <InvitePage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ConsoleApp route={route} />
    </QueryClientProvider>
  );
}

function ConsoleApp({ route }: { route: BrowserRoute }) {
  const isSettingsPath = route.pathname === "/settings";
  if (isSettingsPath) {
    return <ConsoleSettingsPage />;
  }

  const sveId = readSveIdPath(route.pathname);
  if (sveId !== undefined) {
    return <SveDetailApp sveId={sveId} />;
  }

  const scanDeliveryId = readScanPath(route.pathname);
  if (scanDeliveryId !== undefined) {
    return <ScanDetailApp deliveryId={scanDeliveryId} />;
  }

  const fixPrId = readFixPrPath(route.pathname);
  if (fixPrId !== undefined) {
    return <FixPrDetailApp fixId={fixPrId} />;
  }

  // Why not keep the dashboard hooks here: React discards hook state without running
  // useEffect cleanups when these earlier returns switch the rendered branch on SPA
  // navigation, which would leak the EventSource/polling. Mounting a dedicated child
  // guarantees the cleanups run on unmount.
  return <DashboardApp route={route} />;
}

function DashboardApp({ route }: { route: BrowserRoute }) {
  const dashboardMode = readDashboardModePath(route.pathname);

  const dashboardQuery = useQuery({
    queryFn: ({ signal }) => loadDashboard(signal),
    queryKey: dashboardQueryKey,
  });
  const historyQuery = useQuery({
    queryFn: ({ signal }) => loadScanHistory(signal),
    queryKey: scanHistoryQueryKey,
    refetchInterval: 3000,
  });
  const fixPrRunsQuery = useQuery({
    queryFn: ({ signal }) => loadFixPrRuns(signal),
    queryKey: fixPrRunsQueryKey,
    refetchInterval: 3000,
  });
  useScanHistoryStream(dashboardQuery.isSuccess);

  const searchParams = new URLSearchParams(route.search);
  const scanStatus = searchParams.get("scan");
  const scanCount = searchParams.get("count");
  const scanError = searchParams.get("error");
  const shell = dashboardShell(dashboardMode);
  const isLoading = dashboardQuery.isPending || historyQuery.isPending;
  if (isLoading) {
    return (
      <FullPageStatus
        active={shell.active}
        message="Loading dashboard"
        subtitle={shell.subtitle}
        title={shell.title}
      />
    );
  }

  const hasError = dashboardQuery.isError;
  if (hasError) {
    return (
      <FullPageStatus
        active={shell.active}
        error={toErrorMessage(dashboardQuery.error)}
        message="Dashboard を読み込めませんでした"
        subtitle={shell.subtitle}
        title={shell.title}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  const hasDashboardData = dashboard !== undefined;
  if (!hasDashboardData) {
    return (
      <FullPageStatus
        active={shell.active}
        error="Dashboard response was empty"
        message="Dashboard を読み込めませんでした"
        subtitle={shell.subtitle}
        title={shell.title}
      />
    );
  }

  return (
    <ConsoleDashboard
      dashboard={dashboard}
      fixPrRuns={fixPrRunsQuery.data?.fixPrRuns ?? []}
      findingsByRun={historyQuery.data?.findingsByRun ?? {}}
      history={historyQuery.data?.history ?? []}
      mode={dashboardMode}
      scanCount={scanCount}
      scanError={scanError}
      scanStatus={scanStatus}
      sveSummaries={historyQuery.data?.sveSummaries ?? []}
    />
  );
}

function useBrowserRoute(): BrowserRoute {
  const [route, setRoute] = useState(readBrowserRoute);

  const navigate = useCallback((url: URL) => {
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const isSamePath = nextPath === currentPath;
    if (!isSamePath) {
      window.history.pushState(null, "", nextPath);
    }

    setRoute(readBrowserRoute());
    scrollToRouteTarget(url.hash);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(readBrowserRoute());
      scrollToRouteTarget(window.location.hash);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const anchor = findAnchor(event.target);
      const hasAnchor = anchor !== undefined;
      if (!hasAnchor) {
        return;
      }

      const shouldNavigate = shouldHandleSpaNavigation(event, anchor);
      if (!shouldNavigate) {
        return;
      }

      event.preventDefault();
      navigate(new URL(anchor.href));
    };

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [navigate]);

  return route;
}

function ScanDetailApp({ deliveryId }: { deliveryId: string }) {
  const detailQuery = useQuery({
    queryFn: ({ signal }) => loadScanDetail(deliveryId, signal),
    queryKey: ["scan", deliveryId],
    refetchInterval: 3000,
  });
  const isLoading = detailQuery.isPending;
  if (isLoading) {
    return (
      <FullPageStatus
        active="history"
        message="Loading Scan"
        subtitle={deliveryId}
        title="Scan details"
      />
    );
  }

  const hasError = detailQuery.isError;
  if (hasError) {
    return (
      <FullPageStatus
        active="history"
        error={toErrorMessage(detailQuery.error)}
        message="Scan を読み込めませんでした"
        subtitle={deliveryId}
        title="Scan details"
      />
    );
  }

  const detail = detailQuery.data;
  const hasDetail = detail !== undefined;
  if (!hasDetail) {
    return (
      <FullPageStatus
        active="history"
        error="Scan response was empty"
        message="Scan を読み込めませんでした"
        subtitle={deliveryId}
        title="Scan details"
      />
    );
  }

  return <ScanDetailPage detail={detail} />;
}

function SveDetailApp({ sveId }: { sveId: string }) {
  const detailQuery = useQuery({
    queryFn: ({ signal }) => loadSveDetail(sveId, signal),
    queryKey: ["sve", sveId],
  });
  const isLoading = detailQuery.isPending;
  if (isLoading) {
    return <FullPageStatus active="history" message="Loading SVE-ID" title={sveId} />;
  }

  const hasError = detailQuery.isError;
  if (hasError) {
    return (
      <FullPageStatus
        active="history"
        error={toErrorMessage(detailQuery.error)}
        message="SVE-ID を読み込めませんでした"
        title={sveId}
      />
    );
  }

  const detail = detailQuery.data;
  const hasDetail = detail !== undefined;
  if (!hasDetail) {
    return (
      <FullPageStatus
        active="history"
        error="SVE-ID response was empty"
        message="SVE-ID を読み込めませんでした"
        title={sveId}
      />
    );
  }

  return <SveDetailPage detail={detail} />;
}

function FixPrDetailApp({ fixId }: { fixId: string }) {
  const detailQuery = useQuery({
    queryFn: ({ signal }) => loadFixPrDetail(fixId, signal),
    queryKey: ["fixPr", fixId],
    refetchInterval: (query) => {
      const status = query.state.data?.fixPrRun.status;
      const shouldRefetch = status === undefined || status === "queued" || status === "running";
      return shouldRefetch ? 3000 : false;
    },
  });
  const isLoading = detailQuery.isPending;
  if (isLoading) {
    return (
      <FullPageStatus active="fixPrs" message="Loading Fix PR" subtitle={fixId} title="Fix PR" />
    );
  }

  const hasError = detailQuery.isError;
  if (hasError) {
    return (
      <FullPageStatus
        active="fixPrs"
        error={toErrorMessage(detailQuery.error)}
        message="Fix PR を読み込めませんでした"
        subtitle={fixId}
        title="Fix PR"
      />
    );
  }

  const detail = detailQuery.data;
  const hasDetail = detail !== undefined;
  if (!hasDetail) {
    return (
      <FullPageStatus
        active="fixPrs"
        error="Fix PR response was empty"
        message="Fix PR を読み込めませんでした"
        subtitle={fixId}
        title="Fix PR"
      />
    );
  }

  return <FixPrDetailPage detail={detail} />;
}

function useScanHistoryStream(isEnabled: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const supportsEventSource = typeof EventSource !== "undefined";
    if (!supportsEventSource) {
      return;
    }

    const events = new EventSource("/api/scans/history/stream", {
      withCredentials: true,
    });
    const handleHistoryEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      const body = JSON.parse(message.data) as ScanHistoryResponse;
      queryClient.setQueryData<ScanHistoryResponse>(scanHistoryQueryKey, body);
    };
    const handleStreamError = (event: Event) => {
      const message = event as MessageEvent<string>;
      const data = typeof message.data === "string" ? message.data : "";
      const isSessionExpired = data.includes("session_expired");
      if (isSessionExpired) {
        events.close();
        window.location.assign("/login");
        return;
      }

      const isAccessRevoked = data.includes("access_revoked");
      if (!isAccessRevoked) {
        return;
      }

      events.close();
      window.location.assign("/invite");
    };
    events.addEventListener("history", handleHistoryEvent);
    events.addEventListener("error", handleStreamError);

    return () => {
      events.removeEventListener("history", handleHistoryEvent);
      events.removeEventListener("error", handleStreamError);
      events.close();
    };
  }, [isEnabled, queryClient]);
}

async function loadDashboard(signal: AbortSignal): Promise<RepositoryDashboardData> {
  const response = await fetch("/api/dashboard", {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const redirect = redirectApiAccess<RepositoryDashboardData>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Dashboard request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as DashboardResponse;
  return body.dashboard;
}

async function loadScanHistory(signal: AbortSignal): Promise<ScanHistoryResponse> {
  const response = await fetch("/api/scans/history", {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const isOk = response.ok;
  if (!isOk) {
    const redirect = redirectApiAccess<ScanHistoryResponse>(response);
    if (redirect !== undefined) {
      return redirect;
    }

    return { findingsByRun: {}, history: [], sveSummaries: [] };
  }

  const body = (await response.json()) as ScanHistoryResponse;
  return body;
}

async function loadFixPrRuns(signal: AbortSignal): Promise<FixPrRunsResponse> {
  const response = await fetch("/api/fix-prs", {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const isOk = response.ok;
  if (!isOk) {
    const redirect = redirectApiAccess<FixPrRunsResponse>(response);
    if (redirect !== undefined) {
      return redirect;
    }

    return { fixPrRuns: [] };
  }

  return (await response.json()) as FixPrRunsResponse;
}

async function loadFixPrDetail(fixId: string, signal: AbortSignal): Promise<FixPrDetailData> {
  const response = await fetch(`/api/fix-prs/${encodeURIComponent(fixId)}`, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const redirect = redirectApiAccess<FixPrDetailData>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Fix PR request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as FixPrRunResponse;
  return { chunks: body.chunks ?? [], fixPrRun: body.fixPrRun };
}

async function loadSveDetail(sveId: string, signal: AbortSignal): Promise<SveDetailData> {
  const response = await fetch(`/api/sve/${encodeURIComponent(sveId)}`, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const redirect = redirectApiAccess<SveDetailData>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`SVE-ID request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as SveDetailData;
}

async function loadScanDetail(deliveryId: string, signal: AbortSignal): Promise<ScanDetailData> {
  const response = await fetch(`/api/scans/${encodeURIComponent(deliveryId)}`, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    signal,
  });
  const redirect = redirectApiAccess<ScanDetailData>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scan request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as ScanDetailData;
}

function redirectApiAccess<T>(response: Response): Promise<T> | undefined {
  const isUnauthorized = response.status === 401;
  if (isUnauthorized) {
    window.location.assign("/login");
    return new Promise<T>(() => {});
  }

  const isInviteRequired = response.status === 403;
  if (isInviteRequired) {
    window.location.assign("/invite");
    return new Promise<T>(() => {});
  }

  return undefined;
}

function readSveIdPath(pathname: string): string | undefined {
  const prefix = "/sve/";
  const isSvePath = pathname.startsWith(prefix);
  if (!isSvePath) {
    return undefined;
  }

  const encodedSveId = pathname.slice(prefix.length);
  const hasSveId = encodedSveId.length > 0;
  if (!hasSveId) {
    return undefined;
  }

  const sveId = safeDecodeURIComponent(encodedSveId);
  const hasDecodedSveId = sveId.length > 0;
  if (!hasDecodedSveId) {
    return undefined;
  }

  return sveId;
}

function readDashboardModePath(pathname: string): ConsoleDashboardMode {
  if (pathname === "/repositories") {
    return "repositories";
  }

  if (pathname === "/sve") {
    return "sve";
  }

  if (pathname === "/scans") {
    return "scans";
  }

  if (pathname === "/fix-prs") {
    return "fixPrs";
  }

  return "dashboard";
}

function readFixPrPath(pathname: string): string | undefined {
  const prefix = "/fix-prs/";
  const isFixPrPath = pathname.startsWith(prefix);
  if (!isFixPrPath) {
    return undefined;
  }

  const encodedFixId = pathname.slice(prefix.length);
  const hasFixId = encodedFixId.length > 0;
  if (!hasFixId) {
    return undefined;
  }

  const fixId = safeDecodeURIComponent(encodedFixId);
  const hasDecodedFixId = fixId.length > 0;
  if (!hasDecodedFixId) {
    return undefined;
  }

  return fixId;
}

function readScanPath(pathname: string): string | undefined {
  const prefix = "/scans/";
  const isScanPath = pathname.startsWith(prefix);
  if (!isScanPath) {
    return undefined;
  }

  const encodedDeliveryId = pathname.slice(prefix.length);
  const hasDeliveryId = encodedDeliveryId.length > 0;
  if (!hasDeliveryId) {
    return undefined;
  }

  const deliveryId = safeDecodeURIComponent(encodedDeliveryId);
  const hasDecodedDeliveryId = deliveryId.length > 0;
  if (!hasDecodedDeliveryId) {
    return undefined;
  }

  return deliveryId;
}

function readBrowserRoute(): BrowserRoute {
  return {
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

function findAnchor(target: EventTarget | null): HTMLAnchorElement | undefined {
  const isElement = target instanceof Element;
  if (!isElement) {
    return undefined;
  }

  const anchor = target.closest("a");
  const isAnchor = anchor instanceof HTMLAnchorElement;
  if (!isAnchor) {
    return undefined;
  }

  return anchor;
}

function shouldHandleSpaNavigation(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  const isDefaultPrevented = event.defaultPrevented;
  if (isDefaultPrevented) {
    return false;
  }

  const isPrimaryClick = event.button === 0;
  if (!isPrimaryClick) {
    return false;
  }

  const isModifiedClick = event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
  if (isModifiedClick) {
    return false;
  }

  const hasHref = anchor.href.length > 0;
  if (!hasHref) {
    return false;
  }

  const opensNewContext = anchor.target.length > 0 || anchor.hasAttribute("download");
  if (opensNewContext) {
    return false;
  }

  const url = new URL(anchor.href);
  const isSameOrigin = url.origin === window.location.origin;
  if (!isSameOrigin) {
    return false;
  }

  return isSpaRoute(url);
}

function isSpaRoute(url: URL): boolean {
  const pathname = url.pathname;
  const isApiPath = pathname.startsWith("/api/");
  if (isApiPath) {
    return false;
  }

  const isServerActionPath =
    pathname === "/logout" || pathname === "/oauth/callback" || pathname === "/scans/start";
  if (isServerActionPath) {
    return false;
  }

  const startsGitHubLogin = pathname === "/login" && url.searchParams.get("start") === "github";
  if (startsGitHubLogin) {
    return false;
  }

  return true;
}

function scrollToRouteTarget(hash: string): void {
  window.requestAnimationFrame(() => {
    const hasHash = hash.length > 1;
    if (!hasHash) {
      window.scrollTo({ top: 0 });
      return;
    }

    const id = safeDecodeURIComponent(hash.slice(1));
    const hasId = id.length > 0;
    if (!hasId) {
      return;
    }

    const target = document.getElementById(id);
    const hasTarget = target !== null;
    if (!hasTarget) {
      return;
    }

    target.scrollIntoView();
  });
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function FullPageStatus({
  active,
  error,
  message,
  subtitle,
  title,
}: {
  active: "dashboard" | "fixPrs" | "history" | "repositories" | "sve";
  error?: string;
  message: string;
  subtitle?: string;
  title: string;
}) {
  const hasError = error !== undefined;
  return (
    <ConsoleShell active={active} title={title} {...(subtitle === undefined ? {} : { subtitle })}>
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          justifyContent: "center",
          minHeight: "60vh",
        }}
      >
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {hasError ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
          <Typography color="text.secondary">{message}</Typography>
        </Stack>
      </Box>
    </ConsoleShell>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const rootElement = document.getElementById("root");
const hasRootElement = rootElement !== null;
if (!hasRootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
