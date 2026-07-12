import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ScanFindingRecord, ScanRunRecord, ScanStreamChunkRecord } from "@scanveil/core";

import ConsoleShell from "./ConsoleShell";
import { LlmStreamPanel } from "./ConsoleDashboard";
import { AppBadge, FindingSourceBadge, ScanStatusBadge, SeverityBadge } from "./status-badges";

export interface ScanDetailData {
  chunks: ScanStreamChunkRecord[];
  findings: ScanFindingRecord[];
  run: ScanRunRecord;
}

export default function ScanDetailPage({ detail }: { detail: ScanDetailData }) {
  const run = detail.run;
  const hasFindings = detail.findings.length > 0;
  const hasSavedOutput =
    run.llmOutputObjectPath !== undefined && run.llmOutputObjectPath.length > 0;
  const llmFindings = detail.findings.filter((finding) => finding.source === "llm");
  const osvFindings = detail.findings.filter((finding) => finding.source === "osv");

  return (
    <ConsoleShell
      active="history"
      title="Scan details"
      subtitle={`${run.owner}/${run.repo} · ${run.target} · ${run.deliveryId}`}
      actions={
        <>
          <ScanStatusBadge status={run.status} />
          <Button href="/" startIcon={<ArrowBackIcon />} variant="outlined">
            Dashboard
          </Button>
        </>
      }
    >
      <Stack spacing={3}>
        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ justifyContent: "space-between" }}
            >
              <Box>
                <Typography component="h2" variant="h6">
                  LLM stream
                </Typography>
              </Box>
              {hasSavedOutput && (
                <Link
                  href={`/api/scans/${encodeURIComponent(run.deliveryId)}/llm-output`}
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
              initialChunks={detail.chunks}
              streamId={run.deliveryId}
              streamUrl={`/api/scans/${encodeURIComponent(run.deliveryId)}/stream`}
            />
          </Box>
        </Paper>

        <Paper variant="outlined">
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ justifyContent: "space-between" }}
            >
              <Typography component="h2" variant="h6">
                Findings
              </Typography>
              <Stack direction="row" spacing={1}>
                <AppBadge emphasis="outline" label={`OSV ${osvFindings.length}`} />
                <AppBadge emphasis="outline" label={`LLM ${llmFindings.length}`} />
              </Stack>
            </Stack>
          </Box>
          <Stack spacing={1.25} sx={{ p: 2.5 }}>
            {hasFindings ? (
              <>
                <FindingSourceSection findings={osvFindings} title="OSV findings" />
                <FindingSourceSection findings={llmFindings} title="LLM findings" />
              </>
            ) : (
              <Alert severity="info">Findings はまだありません。</Alert>
            )}
          </Stack>
        </Paper>
      </Stack>
    </ConsoleShell>
  );
}

function FindingSourceSection({
  findings,
  title,
}: {
  findings: ScanFindingRecord[];
  title: string;
}) {
  const hasFindings = findings.length > 0;
  if (!hasFindings) {
    return null;
  }

  return (
    <Stack spacing={1.25}>
      <Typography component="h3" sx={{ fontWeight: 800, mt: 1 }} variant="subtitle2">
        {title}
      </Typography>
      {findings.map((finding) => (
        <FindingCard finding={finding} key={finding.findingId} />
      ))}
    </Stack>
  );
}

function FindingCard({ finding }: { finding: ScanFindingRecord }) {
  const hasAliases = finding.aliases.length > 0;
  const location = formatFindingLocation(finding);

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} variant="body2">
            {finding.title}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {location}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <FindingSourceBadge source={finding.source} />
          <SeverityBadge severity={finding.severity} />
        </Stack>
      </Stack>
      {hasAliases && (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", mt: 1 }}>
          {finding.aliases.map((alias) => (
            <AppBadge emphasis="outline" key={alias} label={alias} />
          ))}
        </Stack>
      )}
      <Typography sx={{ mt: 1.25 }} variant="body2">
        {finding.evidence}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
        {finding.recommendation}
      </Typography>
      <Typography color="text.secondary" sx={{ display: "block", mt: 1 }} variant="caption">
        {finding.sveId ?? finding.findingId}
      </Typography>
    </Box>
  );
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
