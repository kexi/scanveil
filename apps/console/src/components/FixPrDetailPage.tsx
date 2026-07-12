import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { FixPrRunRecord, FixPrStreamChunkRecord } from "@scanveil/core";

import ConsoleShell from "./ConsoleShell";
import { LlmStreamPanel } from "./ConsoleDashboard";
import { AppBadge, FixPrStatusBadge, SeverityBadge } from "./status-badges";

export interface FixPrDetailData {
  chunks?: FixPrStreamChunkRecord[];
  fixPrRun: FixPrRunRecord;
}

export default function FixPrDetailPage({ detail }: { detail: FixPrDetailData }) {
  const run = detail.fixPrRun;
  const chunks = detail.chunks ?? [];
  const hasErrorMessage = run.errorMessage !== undefined && run.errorMessage.length > 0;
  const hasSavedOutput =
    run.llmOutputObjectPath !== undefined && run.llmOutputObjectPath.length > 0;
  const hasProposal = run.proposalTitle !== undefined && run.proposalTitle.length > 0;
  return (
    <ConsoleShell
      active="fixPrs"
      title={formatFixId(run.fixId)}
      subtitle={`${run.owner}/${run.repo} · ${run.title}`}
      actions={
        <Button href="/fix-prs" startIcon={<ArrowBackIcon />} variant="outlined">
          Fix PRs
        </Button>
      }
    >
      <Stack spacing={3}>
        {hasErrorMessage && <Alert severity="error">{run.errorMessage}</Alert>}
        {run.status === "succeeded" && run.pullRequestUrl !== undefined && (
          <Alert
            action={
              <Button
                color="inherit"
                endIcon={<OpenInNewIcon />}
                href={run.pullRequestUrl}
                rel="noreferrer"
                size="small"
                target="_blank"
              >
                Open PR
              </Button>
            }
            severity="success"
          >
            Fix PR created.
          </Alert>
        )}

        <Paper variant="outlined">
          <Box sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack
                direction={{ sm: "row", xs: "column" }}
                spacing={1.5}
                sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
              >
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <FixPrStatusBadge status={run.status} />
                  <SeverityBadge severity={run.severity} />
                  {run.llmModel !== undefined && (
                    <AppBadge emphasis="outline" label={run.llmModel} />
                  )}
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  Updated {formatDate(run.updatedAt)}
                </Typography>
              </Stack>

              <Typography component="h2" variant="h5">
                {run.title}
              </Typography>

              <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
                <Link href={`/sve/${encodeURIComponent(run.sveId)}`}>{run.sveId}</Link>
                <Typography color="text.secondary">·</Typography>
                <Link href={`/scans/${encodeURIComponent(run.deliveryId)}`}>
                  {formatScanId(run.deliveryId)}
                </Link>
                <Typography color="text.secondary">·</Typography>
                <Typography>{`${run.owner}/${run.repo}`}</Typography>
              </Stack>
            </Stack>
          </Box>
        </Paper>

        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Typography component="h2" variant="h6">
              Run details
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <Stack spacing={1.5}>
              <DetailRow label="Fix ID" value={run.fixId} />
              <DetailRow label="Location" value={`${run.file}:${run.startLine}-${run.endLine}`} />
              <DetailRow label="Base branch" value={`${run.defaultBranch} @ ${run.baseSha}`} />
              <DetailRow label="Queued" value={formatDate(run.queuedAt)} />
              {run.executionName !== undefined && (
                <DetailRow label="Execution" value={run.executionName} />
              )}
              {run.branchName !== undefined && <DetailRow label="Branch" value={run.branchName} />}
              {run.pullRequestNumber !== undefined && (
                <DetailRow label="Pull request" value={`#${run.pullRequestNumber}`} />
              )}
            </Stack>
          </Box>
        </Paper>

        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Stack
              direction={{ sm: "row", xs: "column" }}
              spacing={1}
              sx={{ justifyContent: "space-between" }}
            >
              <Typography component="h2" variant="h6">
                Agent output
              </Typography>
              {hasSavedOutput && (
                <Link
                  href={`/api/fix-prs/${encodeURIComponent(run.fixId)}/llm-output`}
                  rel="noreferrer"
                  target="_blank"
                  variant="body2"
                >
                  Saved output
                </Link>
              )}
            </Stack>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <LlmStreamPanel
              initialChunks={chunks}
              streamId={run.fixId}
              streamUrl={`/api/fix-prs/${encodeURIComponent(run.fixId)}/stream`}
            />
          </Box>
        </Paper>

        {hasProposal && (
          <Paper variant="outlined">
            <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
              <Typography component="h2" variant="h6">
                Proposal
              </Typography>
            </Box>
            <Box sx={{ p: 2.5 }}>
              <Stack spacing={2}>
                <TextBlock label="Title" value={run.proposalTitle ?? ""} />
                {run.proposalBody !== undefined && (
                  <TextBlock label="Body" value={run.proposalBody} />
                )}
              </Stack>
            </Box>
          </Paper>
        )}

        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Typography component="h2" variant="h6">
              Finding context
            </Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <TextBlock label="Evidence" value={run.evidence} />
              <TextBlock label="Recommendation" value={run.recommendation} />
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </ConsoleShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction={{ sm: "row", xs: "column" }} spacing={1} sx={{ overflowWrap: "anywhere" }}>
      <Typography color="text.secondary" sx={{ flex: "0 0 140px" }} variant="body2">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.75}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography sx={{ whiteSpace: "pre-wrap" }} variant="body2">
        {value}
      </Typography>
    </Stack>
  );
}

function formatFixId(fixId: string): string {
  const fixPrefix = "fix-";
  const isFixId = fixId.startsWith(fixPrefix);
  if (isFixId) {
    return `${fixPrefix}${fixId.slice(fixPrefix.length, fixPrefix.length + 8)}`;
  }

  return fixId.slice(0, 12);
}

function formatScanId(deliveryId: string): string {
  const manualPrefix = "manual-";
  const isManualScan = deliveryId.startsWith(manualPrefix);
  if (isManualScan) {
    return `${manualPrefix}${deliveryId.slice(manualPrefix.length, manualPrefix.length + 8)}`;
  }

  return deliveryId.slice(0, 12);
}

function formatDate(value: string): string {
  const date = new Date(value);
  const isInvalidDate = Number.isNaN(date.getTime());
  if (isInvalidDate) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
