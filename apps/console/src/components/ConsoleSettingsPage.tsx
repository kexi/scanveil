import SaveIcon from "@mui/icons-material/Save";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { InstallationPolicy, InstallationScanPolicy } from "@scanveil/core";
import { useEffect, useState } from "react";

import ConsoleShell from "./ConsoleShell";

interface ConsoleSettingsData {
  installationPolicies: InstallationPolicy[];
  scanPolicies: InstallationScanPolicy[];
  scheduledScan: ScheduledScanSettings;
}

interface ScheduledScanSettings {
  available: boolean;
  enabled: boolean;
  name?: string;
  schedule: string;
  state?: string;
  timeZone: string;
  updatedAt?: string;
}

interface InstallationPoliciesResponse {
  policies: InstallationPolicy[];
}

interface ScheduledScanResponse {
  settings: ScheduledScanSettings;
}

interface ScanPoliciesResponse {
  policies: InstallationScanPolicy[];
}

interface ScanPolicyResponse {
  policy: InstallationScanPolicy;
}

const scheduledScanFrequencyOptions = [
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 03:00", value: "0 3 * * *" },
  { label: "Daily at 09:00", value: "0 9 * * *" },
  { label: "Weekdays at 09:00", value: "0 9 * * 1-5" },
  { label: "Mondays at 09:00", value: "0 9 * * 1" },
] as const;

const customScheduleValue = "custom";

const timeZoneOptions = [
  { label: "Japan time (JST)", value: "Asia/Tokyo" },
  { label: "UTC", value: "UTC" },
] as const;

export default function ConsoleSettingsPage() {
  const [data, setData] = useState<ConsoleSettingsData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setBusy] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void loadConsoleSettings()
      .then((nextData) => {
        if (isCancelled) {
          return;
        }

        setData(nextData);
      })
      .catch((loadError: unknown) => {
        if (isCancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <ConsoleShell
      active="settings"
      subtitle="Repository scan schedule and installation access"
      title="Settings"
    >
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}
        {data === undefined ? (
          <Paper sx={{ p: 3 }} variant="outlined">
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <CircularProgress size={20} />
              <Typography>Loading settings</Typography>
            </Stack>
          </Paper>
        ) : (
          <>
            <InstallationPolicyPanel
              installationPolicies={data.installationPolicies}
              isBusy={isBusy}
              setBusy={setBusy}
              setData={setData}
              setError={setError}
            />
            <ScanPolicyPanel
              data={data}
              isBusy={isBusy}
              setBusy={setBusy}
              setData={setData}
              setError={setError}
            />
            <ScheduledScanPanel
              isBusy={isBusy}
              scheduledScan={data.scheduledScan}
              setBusy={setBusy}
              setData={setData}
              setError={setError}
            />
          </>
        )}
      </Stack>
    </ConsoleShell>
  );
}

function ScheduledScanPanel({
  isBusy,
  scheduledScan,
  setBusy,
  setData,
  setError,
}: {
  isBusy: boolean;
  scheduledScan: ScheduledScanSettings;
  setBusy(value: boolean): void;
  setData(value: ConsoleSettingsData): void;
  setError(error: string | undefined): void;
}) {
  const [enabled, setEnabled] = useState(scheduledScan.enabled);
  const [schedule, setSchedule] = useState(scheduledScan.schedule);
  const [frequency, setFrequency] = useState(readScheduleFrequency(scheduledScan.schedule));
  const [timeZone, setTimeZone] = useState(normalizeTimeZone(scheduledScan.timeZone));

  useEffect(() => {
    setEnabled(scheduledScan.enabled);
    setSchedule(scheduledScan.schedule);
    setFrequency(readScheduleFrequency(scheduledScan.schedule));
    setTimeZone(normalizeTimeZone(scheduledScan.timeZone));
  }, [scheduledScan]);

  const saveSchedule = async () => {
    await mutateSettings(setBusy, setError, async () => {
      const nextScheduledScan = await updateScheduledScan({ enabled, schedule, timeZone });
      const [installationPolicies, scanPolicies] = await Promise.all([
        fetchInstallationPolicies(),
        fetchScanPolicies(),
      ]);
      setData({ installationPolicies, scanPolicies, scheduledScan: nextScheduledScan });
    });
  };

  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Cloud Scheduler job used by repository-wide scans."
        title="Scheduled scan"
      />
      <Box sx={{ p: 2.5 }}>
        {!scheduledScan.available && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Scheduled scan job is not available in this environment.
          </Alert>
        )}
        <Stack
          direction={{ md: "row", xs: "column" }}
          spacing={2}
          sx={{ alignItems: { md: "center" } }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 160 }}>
            <Switch
              checked={enabled}
              disabled={isBusy || !scheduledScan.available}
              onChange={(_, checked) => setEnabled(checked)}
            />
            <Typography>{enabled ? "Enabled" : "Paused"}</Typography>
          </Stack>
          <TextField
            disabled={isBusy || !scheduledScan.available}
            label="Frequency"
            onChange={(event) => {
              const nextFrequency = event.target.value;
              setFrequency(nextFrequency);
              const isCustomSchedule = nextFrequency === customScheduleValue;
              if (isCustomSchedule) {
                return;
              }

              setSchedule(nextFrequency);
            }}
            select
            size="small"
            sx={{ minWidth: 220 }}
            value={frequency}
          >
            {scheduledScanFrequencyOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
            <MenuItem value={customScheduleValue}>Custom cron</MenuItem>
          </TextField>
          <TextField
            disabled={isBusy || !scheduledScan.available || frequency !== customScheduleValue}
            fullWidth
            label="Cron"
            onChange={(event) => {
              setSchedule(event.target.value);
              setFrequency(readScheduleFrequency(event.target.value));
            }}
            size="small"
            value={schedule}
          />
          <TextField
            disabled={isBusy || !scheduledScan.available}
            label="Time zone"
            onChange={(event) => setTimeZone(event.target.value)}
            select
            size="small"
            sx={{ minWidth: 180 }}
            value={timeZone}
          >
            {timeZoneOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            disabled={isBusy || !scheduledScan.available}
            onClick={() => void saveSchedule()}
            startIcon={<SaveIcon />}
            variant="contained"
          >
            Save
          </Button>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 1.5 }} variant="caption">
          {scheduledScan.name ?? "No scheduler job"} / {scheduledScan.state ?? "-"}
        </Typography>
      </Box>
    </Paper>
  );
}

function readScheduleFrequency(schedule: string): string {
  const matchingOption = scheduledScanFrequencyOptions.find((option) => option.value === schedule);
  const hasMatchingOption = matchingOption !== undefined;
  if (hasMatchingOption) {
    return matchingOption.value;
  }

  return customScheduleValue;
}

function normalizeTimeZone(timeZone: string): string {
  const isUtcAlias = timeZone === "Etc/UTC";
  if (isUtcAlias) {
    return "UTC";
  }

  const isKnownTimeZone = timeZoneOptions.some((option) => option.value === timeZone);
  if (isKnownTimeZone) {
    return timeZone;
  }

  return "Asia/Tokyo";
}

function InstallationPolicyPanel({
  installationPolicies,
  isBusy,
  setBusy,
  setData,
  setError,
}: {
  installationPolicies: InstallationPolicy[];
  isBusy: boolean;
  setBusy(value: boolean): void;
  setData(value: ConsoleSettingsData): void;
  setError(error: string | undefined): void;
}) {
  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="GitHub App installations require an invite-backed policy before scans can run."
        title="GitHub installations"
      />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Enabled</TableCell>
              <TableCell>Account</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Invite</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Save</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {installationPolicies.map((policy) => (
              <InstallationPolicyRow
                isBusy={isBusy}
                key={policy.installationId}
                policy={policy}
                setBusy={setBusy}
                setData={setData}
                setError={setError}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function InstallationPolicyRow({
  isBusy,
  policy,
  setBusy,
  setData,
  setError,
}: {
  isBusy: boolean;
  policy: InstallationPolicy;
  setBusy(value: boolean): void;
  setData(value: ConsoleSettingsData): void;
  setError(error: string | undefined): void;
}) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    setEnabled(policy.enabled);
    setInviteCode("");
  }, [policy]);

  const savePolicy = async (nextEnabled = enabled) => {
    await mutateSettings(setBusy, setError, async () => {
      const installationPolicies = await updateInstallationPolicy(policy.installationId, {
        enabled: nextEnabled,
        inviteCode,
      });
      const [scanPolicies, scheduledScan] = await Promise.all([
        fetchScanPolicies(),
        fetchScheduledScanSettings(),
      ]);
      setData({ installationPolicies, scanPolicies, scheduledScan });
    });
  };

  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={enabled && policy.inviteCode !== undefined}
          disabled={isBusy}
          onChange={(_, checked) => {
            setEnabled(checked);
            void savePolicy(checked);
          }}
        />
      </TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <Stack spacing={0.5}>
          <Typography>{policy.accountLogin}</Typography>
          <Typography color="text.secondary" variant="caption">
            {`installation ${policy.installationId}`}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {policy.accountType}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 260 }}>
        <Stack spacing={0.5}>
          <Typography variant="body2">{formatInstallationScope(policy)}</Typography>
          <Typography color="text.secondary" variant="caption">
            {policy.repositorySelection} / {policy.repositoryCount ?? 0} repositories
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 260 }}>
        <Stack spacing={0.75}>
          <TextField
            disabled={isBusy}
            label="Invite code"
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder={policy.inviteName ?? policy.inviteCode ?? "SV-..."}
            size="small"
            value={inviteCode}
          />
          <Typography color="text.secondary" variant="caption">
            {policy.inviteName ?? policy.inviteCode ?? "invite required"}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <Stack spacing={0}>
          <Typography variant="body2">{formatDate(policy.updatedAt)}</Typography>
          <Typography color="text.secondary" variant="caption">
            {policy.updatedBy ?? "-"}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell align="right">
        <Button
          disabled={isBusy}
          onClick={() => void savePolicy()}
          size="small"
          startIcon={<SaveIcon fontSize="small" />}
          variant="outlined"
        >
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ScanPolicyPanel({
  data,
  isBusy,
  setBusy,
  setData,
  setError,
}: {
  data: ConsoleSettingsData;
  isBusy: boolean;
  setBusy(value: boolean): void;
  setData(value: ConsoleSettingsData): void;
  setError(error: string | undefined): void;
}) {
  const installations = data.installationPolicies;
  const [installationId, setInstallationId] = useState(
    installations[0]?.installationId.toString() ?? "",
  );
  const [name, setName] = useState("");
  const [rule, setRule] = useState("");

  const refreshScanPolicies = async () => {
    const scanPolicies = await fetchScanPolicies();
    setData({ ...data, scanPolicies });
  };

  const addPolicy = async () => {
    await mutateSettings(setBusy, setError, async () => {
      await createScanPolicyRequest({
        enabled: true,
        installationId: Number(installationId),
        name,
        rule,
      });
      setName("");
      setRule("");
      await refreshScanPolicies();
    });
  };

  const isAddDisabled =
    isBusy || installationId === "" || name.trim().length === 0 || rule.trim().length === 0;
  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Organization rules the LLM checks during every scan, including pull request CI scans."
        title="Scan policies"
      />
      <Box sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          {data.scanPolicies.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No scan policies yet. Add a rule below, for example: pnpm workspaces must set
              minimumReleaseAge to 1440 or higher.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Enabled</TableCell>
                    <TableCell>Policy</TableCell>
                    <TableCell>Installation</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.scanPolicies.map((policy) => (
                    <ScanPolicyRow
                      installations={installations}
                      isBusy={isBusy}
                      key={policy.id}
                      onMutate={refreshScanPolicies}
                      policy={policy}
                      setBusy={setBusy}
                      setError={setError}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          <Stack
            direction={{ md: "row", xs: "column" }}
            spacing={2}
            sx={{ alignItems: { md: "flex-start" } }}
          >
            <TextField
              disabled={isBusy || installations.length === 0}
              label="Installation"
              onChange={(event) => setInstallationId(event.target.value)}
              select
              size="small"
              sx={{ minWidth: 220 }}
              value={installationId}
            >
              {installations.map((installation) => (
                <MenuItem
                  key={installation.installationId}
                  value={installation.installationId.toString()}
                >
                  {installation.accountLogin}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              disabled={isBusy}
              label="Policy name"
              onChange={(event) => setName(event.target.value)}
              placeholder="pnpm minimumReleaseAge"
              size="small"
              sx={{ minWidth: 240 }}
              value={name}
            />
            <TextField
              disabled={isBusy}
              fullWidth
              label="Rule"
              minRows={2}
              multiline
              onChange={(event) => setRule(event.target.value)}
              placeholder="pnpm workspaces must set minimumReleaseAge to 1440 or higher."
              size="small"
              value={rule}
            />
            <Button
              disabled={isAddDisabled}
              onClick={() => void addPolicy()}
              startIcon={<SaveIcon />}
              variant="contained"
            >
              Add
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );
}

function ScanPolicyRow({
  installations,
  isBusy,
  onMutate,
  policy,
  setBusy,
  setError,
}: {
  installations: InstallationPolicy[];
  isBusy: boolean;
  onMutate(): Promise<void>;
  policy: InstallationScanPolicy;
  setBusy(value: boolean): void;
  setError(error: string | undefined): void;
}) {
  const [name, setName] = useState(policy.name);
  const [rule, setRule] = useState(policy.rule);

  useEffect(() => {
    setName(policy.name);
    setRule(policy.rule);
  }, [policy]);

  const savePolicy = async (enabled = policy.enabled) => {
    await mutateSettings(setBusy, setError, async () => {
      await updateScanPolicyRequest(policy.id, { enabled, name, rule });
      await onMutate();
    });
  };

  const removePolicy = async () => {
    await mutateSettings(setBusy, setError, async () => {
      await deleteScanPolicyRequest(policy.id);
      await onMutate();
    });
  };

  const accountLogin = installations.find(
    (installation) => installation.installationId === policy.installationId,
  )?.accountLogin;
  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={policy.enabled}
          disabled={isBusy}
          onChange={(_, checked) => void savePolicy(checked)}
        />
      </TableCell>
      <TableCell sx={{ minWidth: 320 }}>
        <Stack spacing={0.75}>
          <TextField
            disabled={isBusy}
            label="Policy name"
            onChange={(event) => setName(event.target.value)}
            size="small"
            value={name}
          />
          <TextField
            disabled={isBusy}
            label="Rule"
            minRows={2}
            multiline
            onChange={(event) => setRule(event.target.value)}
            size="small"
            value={rule}
          />
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <Stack spacing={0.5}>
          <Typography variant="body2">{accountLogin ?? "-"}</Typography>
          <Typography color="text.secondary" variant="caption">
            {`installation ${policy.installationId}`}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <Stack spacing={0}>
          <Typography variant="body2">{formatDate(policy.updatedAt)}</Typography>
          <Typography color="text.secondary" variant="caption">
            {policy.updatedBy ?? "-"}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button
            disabled={isBusy}
            onClick={() => void savePolicy()}
            size="small"
            startIcon={<SaveIcon fontSize="small" />}
            variant="outlined"
          >
            Save
          </Button>
          <Button
            color="error"
            disabled={isBusy}
            onClick={() => void removePolicy()}
            size="small"
            variant="outlined"
          >
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

function SectionHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2.5 }}>
      <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
        {title}
      </Typography>
      <Typography color="text.secondary" variant="body2">
        {subtitle}
      </Typography>
    </Box>
  );
}

async function mutateSettings(
  setBusy: (value: boolean) => void,
  setError: (value: string | undefined) => void,
  action: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  setError(undefined);
  try {
    await action();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function loadConsoleSettings(): Promise<ConsoleSettingsData> {
  const [installationPolicies, scanPolicies, scheduledScan] = await Promise.all([
    fetchInstallationPolicies(),
    fetchScanPolicies(),
    fetchScheduledScanSettings(),
  ]);
  return { installationPolicies, scanPolicies, scheduledScan };
}

async function fetchInstallationPolicies(): Promise<InstallationPolicy[]> {
  const response = await fetch("/api/settings/installation-policies", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const redirect = redirectApiAccess<InstallationPolicy[]>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Installation policy request failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as InstallationPoliciesResponse;
  return body.policies;
}

async function updateInstallationPolicy(
  installationId: number,
  input: { enabled: boolean; inviteCode: string },
): Promise<InstallationPolicy[]> {
  const response = await fetch(
    `/api/settings/installation-policies/${encodeURIComponent(String(installationId))}`,
    {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "PATCH",
    },
  );
  const redirect = redirectApiAccess<InstallationPolicy[]>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Installation policy update failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as InstallationPoliciesResponse;
  return body.policies;
}

async function fetchScanPolicies(): Promise<InstallationScanPolicy[]> {
  const response = await fetch("/api/settings/scan-policies", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const redirect = redirectApiAccess<InstallationScanPolicy[]>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scan policy request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ScanPoliciesResponse;
  return body.policies;
}

async function createScanPolicyRequest(input: {
  enabled: boolean;
  installationId: number;
  name: string;
  rule: string;
}): Promise<InstallationScanPolicy> {
  const response = await fetch("/api/settings/scan-policies", {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });
  const redirect = redirectApiAccess<InstallationScanPolicy>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scan policy create failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ScanPolicyResponse;
  return body.policy;
}

async function updateScanPolicyRequest(
  id: string,
  input: { enabled?: boolean; name?: string; rule?: string },
): Promise<InstallationScanPolicy> {
  const response = await fetch(`/api/settings/scan-policies/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "PATCH",
  });
  const redirect = redirectApiAccess<InstallationScanPolicy>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scan policy update failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ScanPolicyResponse;
  return body.policy;
}

async function deleteScanPolicyRequest(id: string): Promise<void> {
  const response = await fetch(`/api/settings/scan-policies/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    method: "DELETE",
  });
  const redirect = redirectApiAccess<void>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scan policy delete failed: ${response.status} ${await response.text()}`);
  }
}

async function fetchScheduledScanSettings(): Promise<ScheduledScanSettings> {
  const response = await fetch("/api/settings/scheduled-scan", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const redirect = redirectApiAccess<ScheduledScanSettings>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scheduled scan request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ScheduledScanResponse;
  return body.settings;
}

async function updateScheduledScan(input: {
  enabled: boolean;
  schedule: string;
  timeZone: string;
}): Promise<ScheduledScanSettings> {
  const response = await fetch("/api/settings/scheduled-scan", {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "PATCH",
  });
  const redirect = redirectApiAccess<ScheduledScanSettings>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Scheduled scan update failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ScheduledScanResponse;
  return body.settings;
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

function formatDate(value: string | undefined): string {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatInstallationScope(policy: InstallationPolicy): string {
  const isOrganization = policy.accountType === "Organization";
  if (isOrganization) {
    return "Organization installation";
  }

  const isUser = policy.accountType === "User";
  if (isUser) {
    return "Repository or user installation";
  }

  return "GitHub App installation";
}
