import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PublishedWithChangesIcon from "@mui/icons-material/PublishedWithChanges";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import TerminalIcon from "@mui/icons-material/Terminal";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { FixPrRunRecord, ScanFindingRecord, ScanRunRecord } from "@scanveil/core";
import { experimental_streamedQuery as streamedQuery, useQuery } from "@tanstack/react-query";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { useEffect, useState, type ReactNode } from "react";
import type { RepositoryDashboardData, RepositoryRow } from "../github-installations";
import type { SveResolutionSummary } from "../sve-status";
import ConsoleShell from "./ConsoleShell";
import { formatDate, isScanStreamTerminalError } from "./console-format";
import { LlmModelCostRankButton } from "./LlmModelCostRankDialog";
import RepositoryConfigScanDialog from "./RepositoryConfigScanDialog";
import {
  chooseInitialLlmModel,
  readSavedLlmModel,
  writeSavedLlmModel,
} from "./llm-model-selection";
import {
  AppBadge,
  FixPrStatusBadge,
  ScanStatusBadge,
  SeverityBadge,
  SveStatusBadge,
} from "./status-badges";

interface ConsoleDashboardProps {
  dashboard: RepositoryDashboardData;
  fixPrRuns: FixPrRunRecord[];
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  mode: ConsoleDashboardMode;
  scanCount: string | null;
  scanError: string | null;
  scanStatus: string | null;
  sveSummaries: SveResolutionSummary[];
}

export type ConsoleDashboardMode = "dashboard" | "fixPrs" | "repositories" | "scans" | "sve";

interface LlmModelOption {
  displayName: string;
  estimatedCostRank: number;
  id: string;
  source: "configured";
}

interface LlmModelsResponse {
  models: LlmModelOption[];
}

export default function ConsoleDashboard({
  dashboard,
  fixPrRuns,
  findingsByRun,
  history,
  mode,
  scanCount,
  scanError,
  scanStatus,
  sveSummaries,
}: ConsoleDashboardProps) {
  const repositories = dashboard.repositories;
  const hasRepositories = repositories.length > 0;
  const isScanQueued = scanStatus === "queued";
  const isScanFailed = scanStatus === "failed";
  const [configScanRepository, setConfigScanRepository] = useState<RepositoryRow | undefined>(
    undefined,
  );
  const [sveVerificationState, setSveVerificationState] = useState<SveVerificationState>({
    status: "idle",
  });
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsError, setLlmModelsError] = useState<string | undefined>(undefined);
  const [selectedLlmModel, setSelectedLlmModel] = useState("");
  const [llmEnabled, setLlmEnabled] = useState(true);
  const [osvEnabled, setOsvEnabled] = useState(true);
  const [scanCancelState, setScanCancelState] = useState<ScanCancelState>({ status: "idle" });
  const [cancelledRunsById, setCancelledRunsById] = useState<Record<string, ScanRunRecord>>({});
  const visibleHistory = history.map((run) => cancelledRunsById[run.deliveryId] ?? run);
  const isVerifyingSve = sveVerificationState.status === "submitting";
  const hasSelectedLlmModelOption = llmModels.some((model) => model.id === selectedLlmModel);
  const selectedLlmModelValue = hasSelectedLlmModelOption ? selectedLlmModel : "";
  const hasEnabledScanner = llmEnabled || osvEnabled;
  const shell = dashboardShell(mode);

  useEffect(() => {
    void fetchLlmModels()
      .then((models) => {
        setLlmModels(models);
        setSelectedLlmModel((currentModel) => {
          const hasCurrentModel = models.some((model) => model.id === currentModel);
          if (hasCurrentModel) {
            return currentModel;
          }

          return chooseInitialLlmModel(models, readSavedLlmModel());
        });
      })
      .catch((error) => setLlmModelsError(error instanceof Error ? error.message : String(error)));
  }, []);

  function handleSelectedLlmModelChange(model: string): void {
    setSelectedLlmModel(model);
    writeSavedLlmModel(model);
  }

  async function handleCancelScan(deliveryId: string): Promise<void> {
    setScanCancelState({ deliveryId, status: "submitting" });
    try {
      const run = await cancelScan(deliveryId);
      setCancelledRunsById((currentRuns) => ({ ...currentRuns, [deliveryId]: run }));
      setScanCancelState({ deliveryId, status: "cancelled" });
    } catch (error) {
      setScanCancelState({
        deliveryId,
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    }
  }

  return (
    <ConsoleShell active={shell.active} title={shell.title} subtitle={shell.subtitle}>
      <Stack spacing={3}>
        {isScanQueued && (
          <Alert severity="success">
            Scan queued: {scanCount ?? repositories.length} repositories
          </Alert>
        )}
        {sveVerificationState.status === "queued" && (
          <Alert severity="success">
            SVE verification queued: {sveVerificationState.count} repositories
          </Alert>
        )}
        {sveVerificationState.status === "failed" && (
          <Alert severity="error">
            SVE verification を起動できませんでした: {sveVerificationState.message}
          </Alert>
        )}
        {isScanFailed && <Alert severity="error">Scan を起動できませんでした: {scanError}</Alert>}
        {scanCancelState.status === "cancelled" && (
          <Alert severity="success">Scan をキャンセルしました: {scanCancelState.deliveryId}</Alert>
        )}
        {scanCancelState.status === "failed" && (
          <Alert severity="error">
            Scan をキャンセルできませんでした: {scanCancelState.message}
          </Alert>
        )}
        {llmModelsError !== undefined && (
          <Alert severity="warning">LLM model list request failed: {llmModelsError}</Alert>
        )}
        {!dashboard.isConfigured && (
          <Alert severity="warning">GitHub App の管理用 credentials が未設定です。</Alert>
        )}
        {dashboard.error && (
          <Alert severity="error">
            GitHub API から repository を取得できませんでした: {dashboard.error}
          </Alert>
        )}

        {mode === "dashboard" && (
          <DashboardOverview
            findingsByRun={findingsByRun}
            fixPrRuns={fixPrRuns}
            history={visibleHistory}
            repositories={repositories}
            sveSummaries={sveSummaries}
          />
        )}
        {mode === "repositories" && (
          <RepositorySection
            hasEnabledScanner={hasEnabledScanner}
            hasRepositories={hasRepositories}
            llmEnabled={llmEnabled}
            llmModels={llmModels}
            onConfigureScan={setConfigScanRepository}
            onLlmEnabledChange={setLlmEnabled}
            onOsvEnabledChange={setOsvEnabled}
            onSelectedLlmModelChange={handleSelectedLlmModelChange}
            osvEnabled={osvEnabled}
            repositories={repositories}
            selectedLlmModelValue={selectedLlmModelValue}
          />
        )}
        {mode === "sve" && (
          <SveSection
            isVerifyingSve={isVerifyingSve}
            onVerify={() => {
              void verifySveFindings(setSveVerificationState, selectedLlmModel);
            }}
            summaries={sveSummaries}
          />
        )}
        {mode === "scans" && (
          <ScanHistorySection
            cancelState={scanCancelState}
            findingsByRun={findingsByRun}
            history={visibleHistory}
            onCancel={(deliveryId) => {
              void handleCancelScan(deliveryId);
            }}
          />
        )}
        {mode === "fixPrs" && <FixPrRunsTable fixPrRuns={fixPrRuns} />}
        <RepositoryConfigScanDialog
          initialLlmModel={selectedLlmModel}
          onClose={() => setConfigScanRepository(undefined)}
          open={configScanRepository !== undefined}
          repository={configScanRepository}
          onLlmModelChange={handleSelectedLlmModelChange}
        />
      </Stack>
    </ConsoleShell>
  );
}

type SveVerificationState =
  | { status: "failed"; message: string }
  | { count: number; status: "queued" }
  | { status: "idle" }
  | { status: "submitting" };

type ScanCancelState =
  | { status: "cancelled"; deliveryId: string }
  | { status: "failed"; deliveryId: string; message: string }
  | { status: "idle" }
  | { status: "submitting"; deliveryId: string };

export function dashboardShell(mode: ConsoleDashboardMode): {
  active: "dashboard" | "fixPrs" | "history" | "repositories" | "sve";
  subtitle: string;
  title: string;
} {
  if (mode === "repositories") {
    return {
      active: "repositories",
      subtitle: "GitHub App installation から取得した repository を管理します。",
      title: "Repositories",
    };
  }

  if (mode === "sve") {
    return {
      active: "sve",
      subtitle: "Stable vulnerability evidence の検出状態と verification を確認します。",
      title: "SVE",
    };
  }

  if (mode === "scans") {
    return {
      active: "history",
      subtitle: "Scan execution の履歴と実行中ジョブを確認します。",
      title: "Scan history",
    };
  }

  if (mode === "fixPrs") {
    return {
      active: "fixPrs",
      subtitle: "Create fix PR で enqueue された修正 PR 実行を確認します。",
      title: "Fix PRs",
    };
  }

  return {
    active: "dashboard",
    subtitle: "Scanveil の現在の状態を短く確認します。",
    title: "Dashboard",
  };
}

function DashboardOverview({
  findingsByRun,
  fixPrRuns,
  history,
  repositories,
  sveSummaries,
}: {
  findingsByRun: Record<string, ScanFindingRecord[]>;
  fixPrRuns: FixPrRunRecord[];
  history: ScanRunRecord[];
  repositories: RepositoryRow[];
  sveSummaries: SveResolutionSummary[];
}) {
  const activeRuns = history.filter(isActiveRun);
  const activeFixPrRuns = fixPrRuns.filter(isActiveFixPrRun);
  const unresolvedSveCount = sveSummaries.filter(
    (summary) => summary.status === "active" || summary.status === "unverified",
  ).length;

  return (
    <Stack spacing={2.5}>
      <DashboardMetrics
        findingsByRun={findingsByRun}
        history={history}
        sveSummaries={sveSummaries}
      />
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            lg: "repeat(4, minmax(0, 1fr))",
            sm: "repeat(2, minmax(0, 1fr))",
            xs: "1fr",
          },
        }}
      >
        <SummaryLinkCard
          href="/repositories"
          label="Repositories"
          value={String(repositories.length)}
        />
        <SummaryLinkCard href="/sve" label="Unresolved SVE" value={String(unresolvedSveCount)} />
        <SummaryLinkCard href="/scans" label="Active scans" value={String(activeRuns.length)} />
        <SummaryLinkCard
          href="/fix-prs"
          label="Active Fix PRs"
          value={String(activeFixPrRuns.length)}
        />
      </Box>
      <Paper variant="outlined">
        <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
          <Typography component="h2" variant="h6">
            Active work
          </Typography>
        </Box>
        <Box sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            {activeRuns.slice(0, 3).map((run) => (
              <WorkSummaryRow
                badge={<ScanStatusBadge status={run.status} />}
                href={`/scans/${encodeURIComponent(run.deliveryId)}`}
                key={run.deliveryId}
                primary={`${run.owner}/${run.repo}`}
                secondary={`Scan ${formatScanId(run.deliveryId)} · ${formatDate(run.updatedAt)}`}
              />
            ))}
            {activeFixPrRuns.slice(0, 3).map((run) => (
              <WorkSummaryRow
                badge={<FixPrStatusBadge status={run.status} />}
                href={`/sve/${encodeURIComponent(run.sveId)}`}
                key={run.fixId}
                primary={`${run.owner}/${run.repo}`}
                secondary={`Fix PR ${run.fixId} · ${formatDate(run.updatedAt)}`}
              />
            ))}
            {activeRuns.length === 0 && activeFixPrRuns.length === 0 && (
              <Alert severity="info">実行中または queued の作業はありません。</Alert>
            )}
          </Stack>
        </Box>
      </Paper>
    </Stack>
  );
}

function SummaryLinkCard({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Paper
      component="a"
      href={href}
      sx={{ color: "text.primary", p: 2.5, textDecoration: "none" }}
      variant="outlined"
    >
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography component="p" sx={{ fontWeight: 800, mt: 0.75 }} variant="h4">
        {value}
      </Typography>
    </Paper>
  );
}

function WorkSummaryRow({
  badge,
  href,
  primary,
  secondary,
}: {
  badge: ReactNode;
  href: string;
  primary: string;
  secondary: string;
}) {
  return (
    <Box
      sx={{
        alignItems: "center",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        display: "flex",
        gap: 1.5,
        justifyContent: "space-between",
        p: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Link href={href} sx={{ fontWeight: 700 }}>
          {primary}
        </Link>
        <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">
          {secondary}
        </Typography>
      </Box>
      {badge}
    </Box>
  );
}

function RepositorySection({
  hasEnabledScanner,
  hasRepositories,
  llmEnabled,
  llmModels,
  onConfigureScan,
  onLlmEnabledChange,
  onOsvEnabledChange,
  onSelectedLlmModelChange,
  osvEnabled,
  repositories,
  selectedLlmModelValue,
}: {
  hasEnabledScanner: boolean;
  hasRepositories: boolean;
  llmEnabled: boolean;
  llmModels: LlmModelOption[];
  onConfigureScan(repository: RepositoryRow): void;
  onLlmEnabledChange(enabled: boolean): void;
  onOsvEnabledChange(enabled: boolean): void;
  onSelectedLlmModelChange(model: string): void;
  osvEnabled: boolean;
  repositories: RepositoryRow[];
  selectedLlmModelValue: string;
}) {
  return (
    <Paper variant="outlined">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Box>
            <Typography component="h2" variant="h6">
              Repositories
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Scan は GitHub App installation から取得した repository の default branch を enqueue
              します。
            </Typography>
          </Box>
          <Stack
            component="form"
            action="/scans/start"
            direction={{ xs: "column", sm: "row" }}
            method="post"
            spacing={1.5}
            sx={{ alignItems: { sm: "center" }, minWidth: { sm: 420, xs: 1 } }}
          >
            <input name="llmEnabled" type="hidden" value={String(llmEnabled)} />
            <input name="osvEnabled" type="hidden" value={String(osvEnabled)} />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={llmEnabled}
                    onChange={(_, checked) => onLlmEnabledChange(checked)}
                    size="small"
                  />
                }
                label="LLM"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={osvEnabled}
                    onChange={(_, checked) => onOsvEnabledChange(checked)}
                    size="small"
                  />
                }
                label="OSV"
              />
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: 1 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="scan-all-llm-model-label">LLM model</InputLabel>
                <Select
                  disabled={!llmEnabled}
                  label="LLM model"
                  labelId="scan-all-llm-model-label"
                  name="llmModel"
                  onChange={(event) => onSelectedLlmModelChange(event.target.value)}
                  value={selectedLlmModelValue}
                >
                  {llmModels.map((model) => (
                    <MenuItem key={model.id} value={model.id}>
                      {formatLlmModelLabel(model)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <LlmModelCostRankButton models={llmModels} />
            </Stack>
            <Button
              disabled={!hasRepositories || !hasEnabledScanner}
              startIcon={<PlayArrowIcon />}
              sx={{ minWidth: 120 }}
              type="submit"
              variant="contained"
            >
              Scan all
            </Button>
          </Stack>
        </Stack>
      </Box>
      {hasRepositories ? (
        <RepositoryTable onConfigureScan={onConfigureScan} repositories={repositories} />
      ) : (
        <Box sx={{ p: 2.5 }}>
          <Alert severity="info">表示できる GitHub App repository はまだありません。</Alert>
        </Box>
      )}
    </Paper>
  );
}

function SveSection({
  isVerifyingSve,
  onVerify,
  summaries,
}: {
  isVerifyingSve: boolean;
  onVerify(): void;
  summaries: SveResolutionSummary[];
}) {
  return (
    <Paper variant="outlined">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Box>
            <Typography component="h2" variant="h6">
              SVE verification
            </Typography>
            <Typography color="text.secondary" variant="body2">
              最新の repository scan で検出が残っているかを判定します。
            </Typography>
          </Box>
          <Button
            disabled={!hasVerifiableSve(summaries) || isVerifyingSve}
            onClick={onVerify}
            startIcon={<PublishedWithChangesIcon />}
            variant="outlined"
          >
            {isVerifyingSve ? "Verifying" : "Verify unresolved"}
          </Button>
        </Stack>
      </Box>
      <SveVerificationTable summaries={summaries} />
    </Paper>
  );
}

function ScanHistorySection({
  cancelState,
  findingsByRun,
  history,
  onCancel,
}: {
  cancelState: ScanCancelState;
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  onCancel(deliveryId: string): void;
}) {
  return (
    <Paper variant="outlined">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
        <Typography component="h2" variant="h6">
          Scan history
        </Typography>
      </Box>
      <ScanHistoryTable
        cancelState={cancelState}
        findingsByRun={findingsByRun}
        history={history}
        onCancel={onCancel}
      />
    </Paper>
  );
}

function FixPrRunsTable({ fixPrRuns }: { fixPrRuns: FixPrRunRecord[] }) {
  const hasFixPrRuns = fixPrRuns.length > 0;
  if (!hasFixPrRuns) {
    return (
      <Paper variant="outlined">
        <Box sx={{ p: 2.5 }}>
          <Alert severity="info">Fix PR queue はまだありません。</Alert>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
        <Typography component="h2" variant="h6">
          Fix PR runs
        </Typography>
      </Box>
      <TableContainer>
        <Table sx={{ minWidth: 1120 }}>
          <TableHead>
            <TableRow>
              <TableCell>Fix ID</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>SVE-ID</TableCell>
              <TableCell>Repository</TableCell>
              <TableCell>Finding</TableCell>
              <TableCell>Queued</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fixPrRuns.map((run) => (
              <TableRow key={run.fixId}>
                <TableCell>
                  <Typography
                    sx={{
                      fontFamily:
                        '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontWeight: 700,
                    }}
                    variant="body2"
                  >
                    <Link href={`/fix-prs/${encodeURIComponent(run.fixId)}`}>
                      {formatFixId(run.fixId)}
                    </Link>
                  </Typography>
                </TableCell>
                <TableCell>
                  <FixPrStatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  <Link href={`/sve/${encodeURIComponent(run.sveId)}`}>{run.sveId}</Link>
                </TableCell>
                <TableCell>{`${run.owner}/${run.repo}`}</TableCell>
                <TableCell>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">{run.title}</Typography>
                    <Typography color="text.secondary" variant="caption">
                      {run.file}:{run.startLine}-{run.endLine}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>{formatDate(run.queuedAt)}</TableCell>
                <TableCell>{formatDate(run.updatedAt)}</TableCell>
                <TableCell align="right">
                  <FixPrRunResult run={run} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function FixPrRunResult({ run }: { run: FixPrRunRecord }) {
  const pullRequestUrl = run.pullRequestUrl;
  const hasPullRequestUrl = pullRequestUrl !== undefined;
  if (hasPullRequestUrl) {
    return (
      <Button
        endIcon={<OpenInNewIcon />}
        href={pullRequestUrl}
        rel="noreferrer"
        size="small"
        target="_blank"
        variant="text"
      >
        Open fix PR
      </Button>
    );
  }

  const errorMessage = run.errorMessage;
  const hasErrorMessage = errorMessage !== undefined && errorMessage.length > 0;
  if (hasErrorMessage) {
    const errorSummary = summarizeFixPrError(errorMessage);
    return (
      <Stack spacing={0.75} sx={{ alignItems: "flex-end", maxWidth: 360 }}>
        <Typography
          color="error"
          sx={{ overflowWrap: "anywhere", textAlign: "right" }}
          variant="body2"
        >
          {errorSummary}
        </Typography>
        <Box
          component="details"
          sx={{
            "& summary": {
              color: "text.secondary",
              cursor: "pointer",
              fontSize: "0.8125rem",
              listStylePosition: "inside",
            },
            maxWidth: 1,
            textAlign: "left",
          }}
        >
          <Box component="summary">Details</Box>
          <Typography
            component="pre"
            sx={{
              bgcolor: "grey.950",
              borderRadius: 1,
              color: "grey.100",
              fontFamily:
                '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: "0.75rem",
              maxHeight: 240,
              maxWidth: 360,
              mt: 1,
              overflow: "auto",
              p: 1.25,
              whiteSpace: "pre-wrap",
            }}
          >
            {errorMessage}
          </Typography>
        </Box>
      </Stack>
    );
  }

  return (
    <Typography color="text.secondary" variant="body2">
      -
    </Typography>
  );
}

function summarizeFixPrError(message: string): string {
  const agyReason = readAgyRunnerFailureReason(message);
  const hasAgyReason = agyReason !== undefined;
  if (hasAgyReason) {
    return agyReason;
  }

  const githubMessage = readEmbeddedJsonMessage(message);
  const hasGithubMessage = githubMessage !== undefined;
  if (hasGithubMessage) {
    return githubMessage;
  }

  const firstLine = message.split(/\r?\n/, 1)[0]?.trim();
  const hasFirstLine = firstLine !== undefined && firstLine.length > 0;
  if (!hasFirstLine) {
    return "Fix PR run failed";
  }

  const maxLength = 180;
  const isLong = firstLine.length > maxLength;
  if (!isLong) {
    return firstLine;
  }

  return `${firstLine.slice(0, maxLength - 1)}...`;
}

function readAgyRunnerFailureReason(message: string): string | undefined {
  const matches = message.matchAll(/\{[^{}]*"message":"agy_runner_failed"[^{}]*\}/g);
  for (const match of matches) {
    const rawJson = match[0];
    try {
      const parsed = JSON.parse(rawJson) as { reason?: unknown };
      const reason = parsed.reason;
      const hasReason = typeof reason === "string" && reason.length > 0;
      if (hasReason) {
        return reason;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function readEmbeddedJsonMessage(message: string): string | undefined {
  const jsonStart = message.indexOf("{");
  const hasJson = jsonStart >= 0;
  if (!hasJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as { message?: unknown };
    const embeddedMessage = parsed.message;
    const hasEmbeddedMessage = typeof embeddedMessage === "string" && embeddedMessage.length > 0;
    if (hasEmbeddedMessage) {
      return embeddedMessage;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function DashboardMetrics({
  findingsByRun,
  history,
  sveSummaries,
}: {
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  sveSummaries: SveResolutionSummary[];
}) {
  const metrics = createDashboardMetrics(history, findingsByRun, sveSummaries);

  return (
    <Stack spacing={2.5}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            lg: "repeat(4, minmax(0, 1fr))",
            sm: "repeat(2, minmax(0, 1fr))",
            xs: "1fr",
          },
        }}
      >
        <MetricCard label="Scan runs" value={String(metrics.totalRuns)} />
        <MetricCard label="Detected SVE" value={String(metrics.uniqueSveCount)} />
        <MetricCard label="Resolved SVE" value={String(metrics.resolvedSveCount)} />
        <MetricCard
          label="Active / Unverified"
          value={`${metrics.activeSveCount} / ${metrics.unverifiedSveCount}`}
        />
        <MetricCard label="Critical / High" value={String(metrics.criticalHighCount)} />
        <MetricCard label="Running / Queued" value={String(metrics.activeRunCount)} />
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { lg: "minmax(0, 1.4fr) minmax(320px, 0.6fr)", xs: "1fr" },
        }}
      >
        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Typography component="h2" variant="h6">
              Scan executions
            </Typography>
          </Box>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { md: "repeat(2, minmax(0, 1fr))", xs: "1fr" },
              p: 2.5,
            }}
          >
            <BarChartCard bars={metrics.hourlyRuns} title="By hour" />
            <BarChartCard bars={metrics.monthlyRuns} title="By month" />
          </Box>
        </Paper>

        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Typography component="h2" variant="h6">
              Severity
            </Typography>
          </Box>
          <SeverityDonut counts={metrics.severityCounts} />
        </Paper>
      </Box>
    </Stack>
  );
}

function SveVerificationTable({ summaries }: { summaries: SveResolutionSummary[] }) {
  const hasSummaries = summaries.length > 0;
  if (!hasSummaries) {
    return (
      <Box sx={{ p: 2.5 }}>
        <Alert severity="info">検出済み SVE はまだありません。</Alert>
      </Box>
    );
  }

  return (
    <TableContainer>
      <Table sx={{ minWidth: 1040 }}>
        <TableHead>
          <TableRow>
            <TableCell>SVE-ID</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Repository</TableCell>
            <TableCell>Severity</TableCell>
            <TableCell>Latest detection</TableCell>
            <TableCell>Latest verification</TableCell>
            <TableCell>Finding</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {summaries.slice(0, 10).map((summary) => (
            <TableRow key={summary.sveId}>
              <TableCell>
                <Link href={`/sve/${encodeURIComponent(summary.sveId)}`}>{summary.sveId}</Link>
              </TableCell>
              <TableCell>
                <SveStatusBadge status={summary.status} />
              </TableCell>
              <TableCell>{summary.latestFinding.repoFullName}</TableCell>
              <TableCell>
                <SeverityBadge severity={summary.latestFinding.severity} />
              </TableCell>
              <TableCell>{formatDate(summary.latestDetectedAt)}</TableCell>
              <TableCell>
                {summary.latestVerificationRun === undefined ? (
                  "-"
                ) : (
                  <Link
                    href={`/scans/${encodeURIComponent(summary.latestVerificationRun.deliveryId)}`}
                  >
                    {formatDate(summary.latestVerificationRun.updatedAt)}
                  </Link>
                )}
              </TableCell>
              <TableCell>{summary.latestFinding.title}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper sx={{ p: 2.5 }} variant="outlined">
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography component="p" sx={{ fontWeight: 800, mt: 0.75 }} variant="h4">
        {value}
      </Typography>
    </Paper>
  );
}

function BarChartCard({ bars, title }: { bars: ChartBar[]; title: string }) {
  return (
    <Box>
      <Typography sx={{ fontWeight: 700, mb: 1.5 }} variant="body2">
        {title}
      </Typography>
      <BarChart
        borderRadius={6}
        colors={["#1976d2"]}
        height={220}
        margin={{ bottom: 32, left: 36, right: 12, top: 16 }}
        series={[{ data: bars.map((bar) => bar.value), label: title }]}
        xAxis={[{ data: bars.map((bar) => bar.label), scaleType: "band" }]}
        yAxis={[{ width: 32 }]}
      />
    </Box>
  );
}

function SeverityDonut({ counts }: { counts: SeverityCounts }) {
  const segments = severitySegments(counts);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const hasFindings = total > 0;
  const data = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => ({
      color: segment.color,
      id: segment.label,
      label: segment.label,
      value: segment.value,
    }));

  return (
    <Stack spacing={2} sx={{ alignItems: "center", p: 2.5 }}>
      <Box sx={{ height: 220, position: "relative", width: 1 }}>
        {hasFindings ? (
          <PieChart
            height={220}
            margin={{ bottom: 8, left: 8, right: 8, top: 8 }}
            series={[
              {
                arcLabel: "value",
                data,
                innerRadius: 58,
                outerRadius: 92,
                paddingAngle: 2,
              },
            ]}
            skipAnimation
          />
        ) : (
          <Box
            sx={{
              bgcolor: "action.hover",
              borderRadius: "50%",
              height: 184,
              left: "50%",
              position: "absolute",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 184,
            }}
          />
        )}
        <Stack
          spacing={0}
          sx={{
            alignItems: "center",
            inset: 0,
            justifyContent: "center",
            position: "absolute",
          }}
        >
          <Typography sx={{ fontWeight: 800 }} variant="h4">
            {total}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            findings
          </Typography>
        </Stack>
      </Box>
      <Stack spacing={1} sx={{ width: 1 }}>
        {segments.map((segment) => (
          <Stack
            direction="row"
            key={segment.label}
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ bgcolor: segment.color, borderRadius: 0.5, height: 10, width: 10 }} />
              <Typography variant="body2">{segment.label}</Typography>
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {segment.value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function ScanHistoryTable({
  cancelState,
  findingsByRun,
  history,
  onCancel,
}: {
  cancelState: ScanCancelState;
  findingsByRun: Record<string, ScanFindingRecord[]>;
  history: ScanRunRecord[];
  onCancel(deliveryId: string): void;
}) {
  const hasHistory = history.length > 0;
  const newFindingKeys = createNewFindingKeys(findingsByRun);
  if (!hasHistory) {
    return (
      <Box sx={{ p: 2.5 }}>
        <Alert severity="info">Scan execution history はまだありません。</Alert>
      </Box>
    );
  }

  return (
    <TableContainer>
      <Table sx={{ minWidth: 1120 }}>
        <TableHead>
          <TableRow>
            <TableCell>Scan ID</TableCell>
            <TableCell>Repository</TableCell>
            <TableCell>Target</TableCell>
            <TableCell>Findings</TableCell>
            <TableCell>New</TableCell>
            <TableCell>LLM</TableCell>
            <TableCell>Cost</TableCell>
            <TableCell>Region</TableCell>
            <TableCell>Updated</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {history.map((run) => (
            <ScanHistoryRows
              findings={findingsByRun[run.deliveryId] ?? []}
              key={run.deliveryId}
              newFindingKeys={newFindingKeys}
              cancelState={cancelState}
              onCancel={onCancel}
              run={run}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ScanHistoryRows({
  cancelState,
  findings,
  newFindingKeys,
  onCancel,
  run,
}: {
  cancelState: ScanCancelState;
  findings: ScanFindingRecord[];
  newFindingKeys: Set<string>;
  onCancel(deliveryId: string): void;
  run: ScanRunRecord;
}) {
  const isRunning = run.status === "running";
  const isCancelable = run.status === "queued" || run.status === "running";
  const isCancelling =
    cancelState.status === "submitting" && cancelState.deliveryId === run.deliveryId;
  const totalFindingCount = run.findingCount ?? findings.length;
  const newFindingCount = countNewFindings(findings, newFindingKeys);

  return (
    <>
      <TableRow>
        <TableCell>
          <Stack spacing={0.75}>
            <Link
              href={`/scans/${encodeURIComponent(run.deliveryId)}`}
              sx={{
                fontFamily:
                  '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontWeight: 700,
              }}
              title={run.deliveryId}
              variant="body2"
            >
              {formatScanId(run.deliveryId)}
            </Link>
            <ScanStatusBadge status={run.status} />
          </Stack>
        </TableCell>
        <TableCell>{`${run.owner}/${run.repo}`}</TableCell>
        <TableCell>{run.target}</TableCell>
        <TableCell>
          <FindingCountSummary total={totalFindingCount} />
        </TableCell>
        <TableCell>
          <FindingCountSummary total={newFindingCount} />
        </TableCell>
        <TableCell>{formatLlmUsage(run)}</TableCell>
        <TableCell>{formatScanCost(run)}</TableCell>
        <TableCell>{formatScanRegion(run)}</TableCell>
        <TableCell>{formatDate(run.updatedAt)}</TableCell>
        <TableCell align="right">
          {isCancelable && (
            <Button
              color="error"
              disabled={isCancelling}
              onClick={() => onCancel(run.deliveryId)}
              size="small"
              startIcon={<StopCircleIcon />}
              variant="outlined"
            >
              {isCancelling ? "Cancelling" : "Cancel"}
            </Button>
          )}
        </TableCell>
      </TableRow>
      {isRunning && (
        <TableRow>
          <TableCell colSpan={10} sx={{ bgcolor: "background.default", py: 2 }}>
            <LlmStreamPanel
              streamId={run.deliveryId}
              streamUrl={`/api/scans/${encodeURIComponent(run.deliveryId)}/stream`}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function FindingCountSummary({ total }: { total: number }) {
  return (
    <Typography color="text.primary" variant="body2">
      {total}
    </Typography>
  );
}

function countNewFindings(findings: ScanFindingRecord[], newFindingKeys: Set<string>): number {
  return findings.filter((finding) => newFindingKeys.has(finding.findingId)).length;
}

function createNewFindingKeys(findingsByRun: Record<string, ScanFindingRecord[]>): Set<string> {
  const earliestByStableId = new Map<string, ScanFindingRecord>();
  for (const finding of Object.values(findingsByRun).flat()) {
    const isSuppressedDuplicate = finding.suppressedById !== undefined;
    if (isSuppressedDuplicate) {
      continue;
    }

    const stableId = finding.sveId ?? finding.findingId;
    const existing = earliestByStableId.get(stableId);
    const isEarlier = existing === undefined || finding.writtenAt < existing.writtenAt;
    if (!isEarlier) {
      continue;
    }

    earliestByStableId.set(stableId, finding);
  }

  return new Set([...earliestByStableId.values()].map((finding) => finding.findingId));
}

function formatScanId(deliveryId: string): string {
  const manualPrefix = "manual-";
  const isManualScan = deliveryId.startsWith(manualPrefix);
  if (isManualScan) {
    return `${manualPrefix}${deliveryId.slice(manualPrefix.length, manualPrefix.length + 8)}`;
  }

  return deliveryId.slice(0, 12);
}

function formatFixId(fixId: string): string {
  const fixPrefix = "fix-";
  const isFixId = fixId.startsWith(fixPrefix);
  if (isFixId) {
    return `${fixPrefix}${fixId.slice(fixPrefix.length, fixPrefix.length + 8)}`;
  }

  return fixId.slice(0, 12);
}

export interface LlmStreamChunkView {
  sequence: number;
  text: string;
}

export function LlmStreamPanel({
  initialChunks = [],
  streamId,
  streamUrl,
}: {
  initialChunks?: LlmStreamChunkView[];
  streamId: string;
  streamUrl: string;
}) {
  const streamQuery = useQuery({
    queryFn: streamedQuery({
      initialValue: initialChunks,
      reducer: appendUniqueChunk,
      streamFn: () => readLlmStream(streamUrl),
    }),
    queryKey: ["llmStream", streamId],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  const chunks = streamQuery.data ?? [];
  const output = chunks.map((chunk) => chunk.text).join("");
  const hasOutput = output.length > 0;
  const hasError = streamQuery.isError;
  return (
    <Box
      sx={{
        bgcolor: "grey.950",
        borderRadius: 1,
        color: "grey.100",
        fontFamily: "monospace",
        minHeight: 160,
        overflow: "auto",
        p: 2,
        whiteSpace: "pre-wrap",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <TerminalIcon sx={{ fontSize: 18 }} />
        <Typography
          sx={{ color: "grey.300", fontFamily: "inherit", fontWeight: 700 }}
          variant="caption"
        >
          LLM stream
        </Typography>
      </Stack>
      {hasError && (
        <Typography sx={{ color: "warning.light", fontFamily: "inherit" }} variant="body2">
          LLM stream を読み込めませんでした。
        </Typography>
      )}
      {hasOutput ? (
        <Typography component="pre" sx={{ fontFamily: "inherit", m: 0 }} variant="body2">
          {output}
        </Typography>
      ) : (
        <Typography sx={{ color: "grey.500", fontFamily: "inherit" }} variant="body2">
          waiting for LLM output...
        </Typography>
      )}
    </Box>
  );
}

function appendUniqueChunk(
  chunks: LlmStreamChunkView[],
  chunk: LlmStreamChunkView,
): LlmStreamChunkView[] {
  const alreadyExists = chunks.some((candidate) => candidate.sequence === chunk.sequence);
  if (alreadyExists) {
    return chunks;
  }

  return [...chunks, chunk].sort((left, right) => left.sequence - right.sequence);
}

function readLlmStream(streamUrl: string): AsyncIterable<LlmStreamChunkView> {
  return {
    async *[Symbol.asyncIterator]() {
      const supportsEventSource = typeof EventSource !== "undefined";
      if (!supportsEventSource) {
        return;
      }

      const queue: LlmStreamChunkView[] = [];
      let wake: (() => void) | undefined;
      let isClosed = false;
      const events = new EventSource(streamUrl, {
        withCredentials: true,
      });
      const handleChunkEvent = (event: Event) => {
        const message = event as MessageEvent<string>;
        queue.push(JSON.parse(message.data) as LlmStreamChunkView);
        wake?.();
        wake = undefined;
      };
      const handleErrorEvent = (event: Event) => {
        const message = event as MessageEvent<string | undefined>;
        // Why not close on every error: a native EventSource error carries no data
        // (connection drop) and the browser auto-reconnects via the server's retry
        // directive. Only an explicit server-sent terminal event ends the stream;
        // transient server errors (stream_unavailable) are also left to reconnect.
        const isTerminalServerError = isScanStreamTerminalError(message.data);
        // Why still close on a native error: a fatal failure (non-200 response,
        // wrong content-type) leaves readyState CLOSED with no reconnect, so the
        // generator would otherwise await `wake` forever and never run cleanup.
        const isFatalConnectionClose = events.readyState === EventSource.CLOSED;
        const isTerminal = isTerminalServerError || isFatalConnectionClose;
        if (!isTerminal) {
          return;
        }

        isClosed = true;
        wake?.();
        wake = undefined;
      };
      events.addEventListener("chunk", handleChunkEvent);
      events.addEventListener("error", handleErrorEvent);

      try {
        while (!isClosed) {
          const next = queue.shift();
          const hasNext = next !== undefined;
          if (hasNext) {
            yield next;
            continue;
          }

          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        events.removeEventListener("chunk", handleChunkEvent);
        events.removeEventListener("error", handleErrorEvent);
        events.close();
      }
    },
  };
}

function RepositoryTable({
  onConfigureScan,
  repositories,
}: {
  onConfigureScan(repository: RepositoryRow): void;
  repositories: RepositoryRow[];
}) {
  return (
    <TableContainer>
      <Table sx={{ minWidth: 960 }}>
        <TableHead>
          <TableRow>
            <TableCell>Repository</TableCell>
            <TableCell>Account</TableCell>
            <TableCell>Visibility</TableCell>
            <TableCell>Default branch</TableCell>
            <TableCell>Updated</TableCell>
            <TableCell>Installation</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {repositories.map((repository) => (
            <RepositoryRows
              key={repository.fullName}
              onConfigureScan={onConfigureScan}
              repository={repository}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface ChartBar {
  label: string;
  value: number;
}

interface DashboardMetricSummary {
  activeRunCount: number;
  activeSveCount: number;
  criticalHighCount: number;
  hourlyRuns: ChartBar[];
  monthlyRuns: ChartBar[];
  resolvedSveCount: number;
  severityCounts: SeverityCounts;
  totalRuns: number;
  uniqueSveCount: number;
  unverifiedSveCount: number;
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

function createDashboardMetrics(
  history: ScanRunRecord[],
  findingsByRun: Record<string, ScanFindingRecord[]>,
  sveSummaries: SveResolutionSummary[],
): DashboardMetricSummary {
  const findings = Object.values(findingsByRun).flat();
  const uniqueSveIds = new Set(
    findings.map((finding) => finding.sveId ?? finding.findingId).filter((id) => id.length > 0),
  );
  const severityCounts = countSeverities(findings);
  return {
    activeRunCount: history.filter(isActiveRun).length,
    activeSveCount: sveSummaries.filter((summary) => summary.status === "active").length,
    criticalHighCount: severityCounts.critical + severityCounts.high,
    hourlyRuns: countRunsByHour(history),
    monthlyRuns: countRunsByMonth(history),
    resolvedSveCount: sveSummaries.filter((summary) => summary.status === "resolved").length,
    severityCounts,
    totalRuns: history.length,
    uniqueSveCount: uniqueSveIds.size,
    unverifiedSveCount: sveSummaries.filter((summary) => summary.status === "unverified").length,
  };
}

function hasVerifiableSve(summaries: SveResolutionSummary[]): boolean {
  return summaries.some(
    (summary) => summary.status === "active" || summary.status === "unverified",
  );
}

async function verifySveFindings(
  setState: (state: SveVerificationState) => void,
  llmModel: string,
): Promise<void> {
  setState({ status: "submitting" });
  const hasLlmModel = llmModel.length > 0;
  try {
    const response = await fetch("/api/sve-verifications", {
      body: JSON.stringify(hasLlmModel ? { llmModel } : {}),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
    });
    const isUnauthorized = response.status === 401;
    if (isUnauthorized) {
      window.location.assign("/login");
      return;
    }

    const isInviteRequired = response.status === 403;
    if (isInviteRequired) {
      window.location.assign("/invite");
      return;
    }

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { count: number };
    setState({ count: body.count, status: "queued" });
  } catch (error) {
    setState({ message: error instanceof Error ? error.message : String(error), status: "failed" });
  }
}

async function fetchLlmModels(): Promise<LlmModelOption[]> {
  const response = await fetch("/api/llm-models", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as LlmModelsResponse;
  return body.models;
}

interface CancelScanResponse {
  error?: string;
  run?: ScanRunRecord;
}

async function cancelScan(deliveryId: string): Promise<ScanRunRecord> {
  const response = await fetch(`/api/scans/${encodeURIComponent(deliveryId)}/cancel`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    method: "POST",
  });
  const isUnauthorized = response.status === 401;
  if (isUnauthorized) {
    window.location.assign("/login");
    throw new Error("Unauthorized");
  }

  const isInviteRequired = response.status === 403;
  if (isInviteRequired) {
    window.location.assign("/invite");
    throw new Error("Invite required");
  }

  const body = (await response.json()) as CancelScanResponse;
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(body.error ?? `Cancel request failed: ${response.status}`);
  }

  const run = body.run;
  const hasRun = run !== undefined;
  if (!hasRun) {
    throw new Error("Cancel response did not include scan run");
  }

  return run;
}

function formatLlmModelLabel(model: LlmModelOption): string {
  return model.displayName.length > 0 ? model.displayName : model.id;
}

function isActiveRun(run: ScanRunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

function isActiveFixPrRun(run: FixPrRunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

function countSeverities(findings: ScanFindingRecord[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, info: 0, low: 0, medium: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

function countRunsByHour(history: ScanRunRecord[]): ChartBar[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const run of history) {
    const date = new Date(run.queuedAt);
    const isValidDate = !Number.isNaN(date.getTime());
    if (!isValidDate) {
      continue;
    }

    const hour = date.getHours();
    counts[hour] = (counts[hour] ?? 0) + 1;
  }

  return counts.map((value, hour) => ({
    label: String(hour).padStart(2, "0"),
    value,
  }));
}

function countRunsByMonth(history: ScanRunRecord[]): ChartBar[] {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
    return monthKey(date);
  });
  const counts = new Map(months.map((month) => [month, 0]));
  for (const run of history) {
    const date = new Date(run.queuedAt);
    const isValidDate = !Number.isNaN(date.getTime());
    if (!isValidDate) {
      continue;
    }

    const key = monthKey(date);
    const hasMonth = counts.has(key);
    if (!hasMonth) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return months.map((month) => ({
    label: month.slice(5),
    value: counts.get(month) ?? 0,
  }));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function severitySegments(counts: SeverityCounts): Array<{
  color: string;
  label: keyof SeverityCounts;
  value: number;
}> {
  return [
    { color: "#d32f2f", label: "critical", value: counts.critical },
    { color: "#ed6c02", label: "high", value: counts.high },
    { color: "#f9a825", label: "medium", value: counts.medium },
    { color: "#2e7d32", label: "low", value: counts.low },
    { color: "#607d8b", label: "info", value: counts.info },
  ];
}

function formatLlmUsage(run: ScanRunRecord): string {
  const provider = run.llmProvider ?? "llm";
  const model = run.llmModel ?? "-";
  const hasTokens = run.llmTotalTokens !== undefined;
  if (!hasTokens) {
    return `${provider} · ${model}`;
  }

  return `${provider} · ${model} · ${run.llmTotalTokens} tokens`;
}

function formatScanCost(run: ScanRunRecord): string {
  const cost = run.llmEstimatedCostUsd;
  const hasCost = cost !== undefined;
  if (!hasCost) {
    return "-";
  }

  return `$${cost.toFixed(6)}`;
}

function formatScanRegion(run: ScanRunRecord): string {
  const runnerRegion = run.runnerRegion ?? "-";
  const llmLocation = run.llmLocation ?? "-";
  return `${runnerRegion} / ${llmLocation}`;
}

function RepositoryRows({
  onConfigureScan,
  repository,
}: {
  onConfigureScan(repository: RepositoryRow): void;
  repository: RepositoryRow;
}) {
  const hasPullRequestsError = repository.openPullRequestsError !== undefined;
  const hasOpenPullRequests = repository.openPullRequests.length > 0;

  return (
    <>
      <TableRow>
        <TableCell>
          <ExternalLink href={repository.htmlUrl}>{repository.fullName}</ExternalLink>
        </TableCell>
        <TableCell>{repository.account}</TableCell>
        <TableCell>
          <AppBadge emphasis="outline" label={repository.visibility} />
        </TableCell>
        <TableCell>{repository.defaultBranch}</TableCell>
        <TableCell>{repository.updatedAt}</TableCell>
        <TableCell>{repository.installationId}</TableCell>
        <TableCell align="right">
          <Button
            onClick={() => onConfigureScan(repository)}
            size="small"
            startIcon={<PlayArrowIcon />}
            variant="outlined"
          >
            Scan
          </Button>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ bgcolor: "background.default", py: 2 }}>
          {hasPullRequestsError ? (
            <Alert severity="warning">
              {repository.openPullRequestsError} GitHub App settings で Pull requests: Read-only
              を追加し、installation の権限更新を承認すると PR 一覧も表示されます。
            </Alert>
          ) : hasOpenPullRequests ? (
            <Stack spacing={1.25}>
              {repository.openPullRequests.map((pullRequest) => (
                <Box
                  key={pullRequest.number}
                  sx={{
                    alignItems: { sm: "center" },
                    bgcolor: "background.paper",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 1.5,
                    justifyContent: "space-between",
                    p: 1.5,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <ExternalLink href={pullRequest.htmlUrl}>
                      #{pullRequest.number} {pullRequest.title}
                    </ExternalLink>
                    <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">
                      {pullRequest.isDraft ? "Draft" : "Open"} by {pullRequest.author} ·{" "}
                      {pullRequest.updatedAt}
                    </Typography>
                  </Box>
                  <Chip icon={<PlayArrowIcon />} label="Scan target" size="small" />
                </Box>
              ))}
            </Stack>
          ) : (
            <Alert severity="info">Open pull requests はありません。</Alert>
          )}
        </TableCell>
      </TableRow>
    </>
  );
}

function ExternalLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      href={href}
      rel="noreferrer"
      sx={{
        alignItems: "center",
        display: "inline-flex",
        gap: 0.5,
        maxWidth: "100%",
        minWidth: 0,
        verticalAlign: "middle",
      }}
      target="_blank"
    >
      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </Box>
      <OpenInNewIcon sx={{ flexShrink: 0, fontSize: 16 }} />
    </Link>
  );
}
