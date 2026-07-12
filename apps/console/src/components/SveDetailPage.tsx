import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BugReportIcon from "@mui/icons-material/BugReport";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PublishedWithChangesIcon from "@mui/icons-material/PublishedWithChanges";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
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
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { FixPrRunRecord, ScanFindingRecord, ScanRunRecord } from "@scanveil/core";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useCallback, useEffect, useState } from "react";
import type { SveResolutionSummary } from "../sve-status";

import ConsoleShell from "./ConsoleShell";
import {
  chooseInitialLlmModel,
  readSavedLlmModel,
  writeSavedLlmModel,
} from "./llm-model-selection";
import { LlmModelCostRankButton } from "./LlmModelCostRankDialog";
import {
  FindingSourceBadge,
  ScanStatusBadge,
  SeverityBadge,
  SveStatusBadge,
} from "./status-badges";

export interface SveDetailData {
  fixPrRuns: FixPrRunRecord[];
  findings: ScanFindingRecord[];
  history: ScanRunRecord[];
  source?: SveSourceContext;
  summary?: SveResolutionSummary;
  sveId: string;
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

interface LlmModelOption {
  displayName: string;
  estimatedCostRank: number;
  id: string;
  source: "configured";
}

interface LlmModelsResponse {
  models: LlmModelOption[];
}

interface MonacoEnvironmentWithWorker {
  getWorker(workerId: string, label: string): Worker;
}

let isMonacoEnvironmentConfigured = false;

export default function SveDetailPage({ detail }: { detail: SveDetailData }) {
  const latestFinding = detail.findings[0];
  const hasFindings = latestFinding !== undefined;
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | "idle">("idle");
  const [issueState, setIssueState] = useState<IssueCreateState>({ status: "idle" });
  const [fixPrState, setFixPrState] = useState<FixPrCreateState>({ status: "idle" });
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsError, setLlmModelsError] = useState<string | undefined>(undefined);
  const [selectedLlmModel, setSelectedLlmModel] = useState("");
  const [isFixPrDialogOpen, setIsFixPrDialogOpen] = useState(false);
  const [fixPrLlmModel, setFixPrLlmModel] = useState("");
  const [verificationState, setVerificationState] = useState<SveVerificationState>({
    status: "idle",
  });
  const isCreatingIssue = issueState.status === "creating";
  const isCreatingFixPr = fixPrState.status === "creating";
  const hasIssueUrl = issueState.status === "created";
  const hasIssueError = issueState.status === "failed";
  const hasFixPrQueued = fixPrState.status === "queued";
  const hasFixPrError = fixPrState.status === "failed";
  const latestRun = latestFinding
    ? detail.history.find((run) => run.deliveryId === latestFinding.deliveryId)
    : undefined;
  const canCreateFixPr =
    latestRun?.target === "repository" &&
    latestFinding?.file !== undefined &&
    latestFinding.startLine !== undefined &&
    latestFinding.endLine !== undefined;
  const latestFixPr = detail.fixPrRuns[0];
  const isVerifyingSve = verificationState.status === "submitting";
  const hasSelectedLlmModelOption = llmModels.some((model) => model.id === selectedLlmModel);
  const selectedLlmModelValue = hasSelectedLlmModelOption ? selectedLlmModel : "";

  useEffect(() => {
    let isCancelled = false;
    void fetchLlmModels()
      .then((models) => {
        if (isCancelled) {
          return;
        }

        setLlmModels(models);
        setSelectedLlmModel(chooseInitialLlmModel(models, readSavedLlmModel()));
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setLlmModelsError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const copyFinding = async () => {
    const hasCopyTarget = latestFinding !== undefined;
    if (!hasCopyTarget) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createClipboardText(detail, latestFinding));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const createIssue = async () => {
    const hasIssueTarget = latestFinding !== undefined;
    if (!hasIssueTarget) {
      return;
    }

    setIssueState({ status: "creating" });
    try {
      const issue = await createGitHubIssue(latestFinding.deliveryId, latestFinding.findingId);
      setIssueState({ issueUrl: issue.htmlUrl, status: "created" });
    } catch (error) {
      setIssueState({
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    }
  };

  const openFixPrDialog = () => {
    setFixPrLlmModel(chooseInitialLlmModel(llmModels, selectedLlmModelValue || undefined));
    setIsFixPrDialogOpen(true);
  };

  const createFixPr = async (llmModel: string) => {
    const hasFixTarget = latestFinding !== undefined;
    if (!hasFixTarget) {
      return;
    }

    setIsFixPrDialogOpen(false);
    writeSavedLlmModel(llmModel);
    setFixPrState({ status: "creating" });
    try {
      const fixPr = await createGitHubFixPr(detail.sveId, latestFinding.findingId, llmModel);
      setFixPrState({ fixId: fixPr.fixId, status: "queued" });
    } catch (error) {
      setFixPrState({
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    }
  };

  return (
    <ConsoleShell
      active="history"
      title={detail.sveId}
      subtitle="Stable vulnerability evidence across scan runs"
      actions={
        <Button href="/" startIcon={<ArrowBackIcon />} variant="outlined">
          Dashboard
        </Button>
      }
    >
      <Stack spacing={3}>
        {!hasFindings ? (
          <Alert severity="info">この SVE-ID の finding は見つかりません。</Alert>
        ) : (
          <>
            {copyStatus === "copied" && (
              <Alert severity="success">Codex / Antigravity CLI 用の要約をコピーしました。</Alert>
            )}
            {copyStatus === "failed" && (
              <Alert severity="error">クリップボードにコピーできませんでした。</Alert>
            )}
            {verificationState.status === "queued" && (
              <Alert severity="success">
                SVE verification queued: {verificationState.count} repository
              </Alert>
            )}
            {verificationState.status === "failed" && (
              <Alert severity="error">
                SVE verification を起動できませんでした: {verificationState.message}
              </Alert>
            )}
            {hasFixPrQueued && (
              <Alert severity="success">
                Fix PR creation queued: {fixPrState.fixId}.{" "}
                <Link href={`/fix-prs/${encodeURIComponent(fixPrState.fixId)}`}>
                  Open Fix PR details
                </Link>
              </Alert>
            )}
            {hasFixPrError && (
              <Alert severity="error">Fix PR を起動できませんでした: {fixPrState.message}</Alert>
            )}
            {llmModelsError !== undefined && (
              <Alert severity="warning">LLM model list request failed: {llmModelsError}</Alert>
            )}
            <Paper variant="outlined">
              <Box sx={{ p: 2.5 }}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ sm: "row", xs: "column" }}
                    spacing={1.5}
                    sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
                  >
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                      {detail.summary && <SveStatusBadge status={detail.summary.status} />}
                      <FindingSourceBadge source={latestFinding.source} />
                      <SeverityBadge severity={latestFinding.severity} />
                    </Stack>
                    <Stack
                      direction={{ sm: "row", xs: "column" }}
                      spacing={1}
                      sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}
                    >
                      <FormControl size="small" sx={{ minWidth: { sm: 220, xs: 1 } }}>
                        <InputLabel id="sve-verify-llm-model-label">LLM model</InputLabel>
                        <Select
                          label="LLM model"
                          labelId="sve-verify-llm-model-label"
                          onChange={(event) => {
                            const model = event.target.value;
                            setSelectedLlmModel(model);
                            writeSavedLlmModel(model);
                          }}
                          value={selectedLlmModelValue}
                        >
                          {llmModels.map((model) => (
                            <MenuItem key={model.id} value={model.id}>
                              {formatLlmModelLabel(model)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        onClick={copyFinding}
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        variant="contained"
                      >
                        Copy
                      </Button>
                      <Button
                        disabled={isCreatingIssue || hasIssueUrl}
                        onClick={() => {
                          void createIssue();
                        }}
                        size="small"
                        startIcon={<BugReportIcon />}
                        variant="outlined"
                      >
                        {isCreatingIssue ? "Creating Issue" : "Create Issue"}
                      </Button>
                      <Button
                        disabled={!canCreateFixPr || isCreatingFixPr || hasFixPrQueued}
                        onClick={openFixPrDialog}
                        size="small"
                        startIcon={<AutoFixHighIcon />}
                        variant="outlined"
                      >
                        {isCreatingFixPr ? "Creating fix PR" : "Create fix PR"}
                      </Button>
                      <Button
                        disabled={isVerifyingSve || detail.summary?.status === "resolved"}
                        onClick={() => {
                          void verifySveFinding(
                            detail.sveId,
                            selectedLlmModel,
                            setVerificationState,
                          );
                        }}
                        size="small"
                        startIcon={<PublishedWithChangesIcon />}
                        variant="outlined"
                      >
                        {isVerifyingSve ? "Verifying" : "Verify fix"}
                      </Button>
                      {hasIssueUrl && (
                        <Button
                          endIcon={<OpenInNewIcon />}
                          href={issueState.issueUrl}
                          rel="noreferrer"
                          size="small"
                          target="_blank"
                          variant="text"
                        >
                          Open Issue
                        </Button>
                      )}
                      {latestFixPr?.pullRequestUrl && (
                        <Button
                          endIcon={<OpenInNewIcon />}
                          href={latestFixPr.pullRequestUrl}
                          rel="noreferrer"
                          size="small"
                          target="_blank"
                          variant="text"
                        >
                          Open fix PR
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                  {hasIssueError && <Alert severity="error">{issueState.message}</Alert>}
                  <Typography component="h2" variant="h6">
                    {latestFinding.title}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {formatFindingLocation(latestFinding)}
                  </Typography>
                  <Typography variant="body2">{latestFinding.evidence}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {latestFinding.recommendation}
                  </Typography>
                  {detail.summary?.latestVerificationRun && (
                    <Typography color="text.secondary" variant="caption">
                      Latest verification:{" "}
                      <Link
                        href={`/scans/${encodeURIComponent(
                          detail.summary.latestVerificationRun.deliveryId,
                        )}`}
                      >
                        {formatDate(detail.summary.latestVerificationRun.updatedAt)}
                      </Link>
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Paper>
            {detail.source && <SveSourcePreview source={detail.source} />}
            <Paper variant="outlined">
              <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
                <Typography component="h2" variant="h6">
                  Detection history
                </Typography>
              </Box>
              <DetectionHistoryTable findings={detail.findings} history={detail.history} />
            </Paper>
            <Dialog
              fullWidth
              maxWidth="xs"
              onClose={() => setIsFixPrDialogOpen(false)}
              open={isFixPrDialogOpen}
            >
              <DialogTitle>Create fix PR</DialogTitle>
              <DialogContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", pt: 1 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="sve-fix-pr-llm-model-label">LLM model</InputLabel>
                    <Select
                      label="LLM model"
                      labelId="sve-fix-pr-llm-model-label"
                      onChange={(event) => {
                        setFixPrLlmModel(event.target.value);
                      }}
                      value={
                        llmModels.some((model) => model.id === fixPrLlmModel) ? fixPrLlmModel : ""
                      }
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
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsFixPrDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={fixPrLlmModel.length === 0}
                  onClick={() => {
                    void createFixPr(fixPrLlmModel);
                  }}
                  startIcon={<AutoFixHighIcon />}
                  variant="contained"
                >
                  Create fix PR
                </Button>
              </DialogActions>
            </Dialog>
          </>
        )}
      </Stack>
    </ConsoleShell>
  );
}

function SveSourcePreview({ source }: { source: SveSourceContext }) {
  const handleEditorWillMount: BeforeMount = useCallback(() => {
    configureMonacoWorkers();
  }, []);
  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      const startLine = source.startLine ?? 1;
      const endLine = source.endLine ?? startLine;
      const decorations = [
        {
          options: {
            className: "sve-source-highlight-line",
            glyphMarginClassName: "sve-source-highlight-glyph",
            isWholeLine: true,
          },
          range: new monaco.Range(startLine, 1, endLine, 1),
        },
      ];
      editor.deltaDecorations([], decorations);
      editor.revealLineInCenter(startLine);
    },
    [source.endLine, source.startLine],
  );
  const shortSha = source.commitSha.slice(0, 12);
  const content = source.content;
  const hasContent = content !== undefined;

  return (
    <Paper variant="outlined">
      <Box
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          p: 2.5,
        }}
      >
        <Stack
          direction={{ sm: "row", xs: "column" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
              Source
            </Typography>
            <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }} variant="body2">
              {source.file} @ {shortSha}
            </Typography>
          </Box>
          <Button
            endIcon={<OpenInNewIcon />}
            href={source.githubUrl}
            rel="noreferrer"
            target="_blank"
            variant="outlined"
          >
            GitHub
          </Button>
        </Stack>
      </Box>
      {source.error && (
        <Box sx={{ p: 2.5 }}>
          <Alert severity="warning">{source.error}</Alert>
        </Box>
      )}
      {hasContent && (
        <Box
          sx={{
            "& .sve-source-highlight-glyph": {
              backgroundColor: "warning.main",
              borderRadius: "999px",
              marginLeft: "4px",
              width: "8px !important",
            },
            "& .sve-source-highlight-line": {
              background: "rgba(245, 158, 11, 0.18)",
            },
            height: { md: 560, xs: 420 },
            overflow: "hidden",
          }}
        >
          <Editor
            beforeMount={handleEditorWillMount}
            defaultLanguage={source.language}
            onMount={handleEditorDidMount}
            options={{
              glyphMargin: true,
              lineNumbers: "on",
              minimap: { enabled: false },
              readOnly: true,
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
            theme="vs-dark"
            value={content}
          />
        </Box>
      )}
    </Paper>
  );
}

function configureMonacoWorkers(): void {
  const hasMonacoEnvironment = isMonacoEnvironmentConfigured;
  if (hasMonacoEnvironment) {
    return;
  }

  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: MonacoEnvironmentWithWorker;
  };
  const hasExistingEnvironment = globalScope.MonacoEnvironment !== undefined;
  if (hasExistingEnvironment) {
    isMonacoEnvironmentConfigured = true;
    return;
  }

  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, _label: string): Worker {
      return new EditorWorker();
    },
  };
  isMonacoEnvironmentConfigured = true;
}

type IssueCreateState =
  | { status: "creating" }
  | { issueUrl: string; status: "created" }
  | { message: string; status: "failed" }
  | { status: "idle" };

type FixPrCreateState =
  | { status: "creating" }
  | { fixId: string; status: "queued" }
  | { message: string; status: "failed" }
  | { status: "idle" };

type SveVerificationState =
  | { status: "failed"; message: string }
  | { count: number; status: "queued" }
  | { status: "idle" }
  | { status: "submitting" };

async function createGitHubIssue(
  deliveryId: string,
  findingId: string,
): Promise<{ htmlUrl: string; number: number }> {
  const response = await fetch(`/api/scans/${encodeURIComponent(deliveryId)}/issues`, {
    body: JSON.stringify({ findingId }),
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
    return new Promise<{ htmlUrl: string; number: number }>(() => {});
  }

  const isInviteRequired = response.status === 403;
  if (isInviteRequired) {
    window.location.assign("/invite");
    return new Promise<{ htmlUrl: string; number: number }>(() => {});
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Issue request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { issue: { htmlUrl: string; number: number } };
  return body.issue;
}

async function createGitHubFixPr(
  sveId: string,
  findingId: string,
  llmModel: string,
): Promise<{ executionName: string; fixId: string }> {
  const hasLlmModel = llmModel.length > 0;
  const response = await fetch(`/api/sve/${encodeURIComponent(sveId)}/fix-prs`, {
    body: JSON.stringify({ findingId, ...(hasLlmModel ? { llmModel } : {}) }),
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
    return new Promise<{ executionName: string; fixId: string }>(() => {});
  }

  const isInviteRequired = response.status === 403;
  if (isInviteRequired) {
    window.location.assign("/invite");
    return new Promise<{ executionName: string; fixId: string }>(() => {});
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(await readApiErrorMessage(response, "Fix PR request failed"));
  }

  const body = (await response.json()) as {
    fixPr: { executionName: string; fixId: string };
  };
  return body.fixPr;
}

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  if (!isJson) {
    return `${fallback}: ${response.status} ${await response.text()}`;
  }

  const body = (await response.json()) as { message?: unknown };
  const message = body.message;
  const hasMessage = typeof message === "string" && message.length > 0;
  if (hasMessage) {
    return message;
  }

  return `${fallback}: ${response.status}`;
}

async function verifySveFinding(
  sveId: string,
  llmModel: string,
  setState: (state: SveVerificationState) => void,
): Promise<void> {
  setState({ status: "submitting" });
  const hasLlmModel = llmModel.length > 0;
  try {
    const response = await fetch("/api/sve-verifications", {
      body: JSON.stringify({ ...(hasLlmModel ? { llmModel } : {}), sveIds: [sveId] }),
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

function formatLlmModelLabel(model: LlmModelOption): string {
  return model.displayName.length > 0 ? model.displayName : model.id;
}

function createClipboardText(detail: SveDetailData, finding: ScanFindingRecord): string {
  const issueTitle = `[Scanveil] ${finding.severity.toUpperCase()}: ${finding.title}`;
  return [
    "GitHub Issue title:",
    issueTitle,
    "",
    "GitHub Issue body:",
    `## Summary`,
    "",
    finding.title,
    "",
    "## Scanveil metadata",
    "",
    `- SVE-ID: ${detail.sveId}`,
    `- Finding ID: ${finding.findingId}`,
    `- Source: ${finding.source}`,
    `- Severity: ${finding.severity}`,
    `- Repository: ${finding.repoFullName}`,
    `- Location: ${formatFindingLocation(finding)}`,
    `- Category: ${finding.category}`,
    `- Confidence: ${Math.round(finding.confidence * 100)}%`,
    `- Aliases: ${finding.aliases.length > 0 ? finding.aliases.join(", ") : "-"}`,
    `- Detected runs: ${detail.findings.length}`,
    "",
    "## Evidence",
    "",
    finding.evidence,
    "",
    "## Recommended fix",
    "",
    finding.recommendation,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The vulnerable code path or dependency version is fixed.",
    "- [ ] Regression tests or dependency verification cover the fix.",
    "- [ ] Scanveil is rerun and this finding no longer appears as active.",
  ].join("\n");
}

function DetectionHistoryTable({
  findings,
  history,
}: {
  findings: ScanFindingRecord[];
  history: ScanRunRecord[];
}) {
  const runByDeliveryId = new Map(history.map((run) => [run.deliveryId, run]));
  return (
    <TableContainer>
      <Table sx={{ minWidth: 1080 }}>
        <TableHead>
          <TableRow>
            <TableCell>Detected</TableCell>
            <TableCell>Scan</TableCell>
            <TableCell>Repository</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>LLM</TableCell>
            <TableCell>Cost</TableCell>
            <TableCell>Region</TableCell>
            <TableCell>Finding</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {findings.map((finding) => {
            const run = runByDeliveryId.get(finding.deliveryId);
            return (
              <TableRow key={`${finding.deliveryId}-${finding.findingId}`}>
                <TableCell>{formatDate(finding.writtenAt)}</TableCell>
                <TableCell>{finding.deliveryId}</TableCell>
                <TableCell>{run ? `${run.owner}/${run.repo}` : finding.repoFullName}</TableCell>
                <TableCell>
                  <ScanStatusBadge status={run?.status ?? "unknown"} />
                </TableCell>
                <TableCell>{run ? formatLlmUsage(run) : "-"}</TableCell>
                <TableCell>{run ? formatScanCost(run) : "-"}</TableCell>
                <TableCell>{run ? formatScanRegion(run) : "-"}</TableCell>
                <TableCell>
                  <Link href={`/sve/${encodeURIComponent(finding.sveId ?? finding.findingId)}`}>
                    {finding.findingId}
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
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

function formatFindingLocation(finding: ScanFindingRecord): string {
  const file = finding.file;
  const hasFile = file !== undefined && file.length > 0;
  if (!hasFile) {
    return finding.findingId;
  }

  const hasStartLine = finding.startLine !== undefined;
  if (!hasStartLine) {
    return file;
  }

  const endLine = finding.endLine ?? finding.startLine;
  const isSingleLine = endLine === finding.startLine;
  if (isSingleLine) {
    return `${file}:${finding.startLine}`;
  }

  return `${file}:${finding.startLine}-${endLine}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  const isValidDate = !Number.isNaN(date.getTime());
  if (!isValidDate) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
