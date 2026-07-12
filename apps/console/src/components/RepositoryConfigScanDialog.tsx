import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Editor, {
  type BeforeMount,
  type Monaco,
  type OnChange,
  type OnMount,
} from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configureMonacoYaml, type MonacoYaml } from "monaco-yaml";
import YamlWorker from "monaco-yaml/yaml.worker?worker";
import type { RepositoryRow } from "../github-installations";
import {
  chooseInitialLlmModel,
  readSavedLlmModel,
  writeSavedLlmModel,
} from "./llm-model-selection";
import { LlmModelCostRankButton } from "./LlmModelCostRankDialog";
import { AppBadge, ConfigSourceBadge, configStatusLabels } from "./status-badges";

interface RepositoryConfigResponse {
  path: string;
  source: string;
  status: "default" | "legacy" | "repository";
  warnings: string[];
}

interface RepositoryBranch {
  name: string;
  sha: string;
}

interface RepositoryBranchesResponse {
  branches: RepositoryBranch[];
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

interface RepositoryConfigScanDialogProps {
  initialLlmModel: string;
  onLlmModelChange(model: string): void;
  onClose(): void;
  open: boolean;
  repository: RepositoryRow | undefined;
}

interface MonacoEnvironmentWithWorker {
  getWorker?(workerId: string, label: string): Worker;
}

type ScanDialogTab = "basic" | "advanced";

const llmModelDefaultValue = "";

let isMonacoEnvironmentConfigured = false;
let monacoYaml: MonacoYaml | undefined;

export default function RepositoryConfigScanDialog({
  initialLlmModel,
  onLlmModelChange,
  onClose,
  open,
  repository,
}: RepositoryConfigScanDialogProps) {
  const [config, setConfig] = useState<RepositoryConfigResponse | undefined>(undefined);
  const [configSource, setConfigSource] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [configBranchHeadSha, setConfigBranchHeadSha] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isBranchesLoading, setIsBranchesLoading] = useState(false);
  const [isLlmModelsLoading, setIsLlmModelsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsError, setLlmModelsError] = useState<string | undefined>(undefined);
  const [selectedLlmModel, setSelectedLlmModel] = useState(llmModelDefaultValue);
  const [llmEnabled, setLlmEnabled] = useState(true);
  const [osvEnabled, setOsvEnabled] = useState(true);
  const [queuedDeliveryId, setQueuedDeliveryId] = useState<string | undefined>(undefined);
  const [selectedBranch, setSelectedBranch] = useState<RepositoryBranch | undefined>(undefined);
  const [selectedTab, setSelectedTab] = useState<ScanDialogTab>("basic");
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  const repositoryName = repository?.fullName ?? "Repository";
  const selectedBranchName = selectedBranch?.name ?? repository?.defaultBranch ?? "";
  const selectedBranchHeadSha = selectedBranch?.sha ?? repository?.defaultBranchHeadSha ?? "";
  const branchOptions = useMemo(() => {
    const hasSelectedBranchOption = branches.some((branch) => branch.name === selectedBranchName);
    if (hasSelectedBranchOption || selectedBranchName.length === 0) {
      return branches;
    }

    return [{ name: selectedBranchName, sha: selectedBranchHeadSha }, ...branches];
  }, [branches, selectedBranchHeadSha, selectedBranchName]);
  const isAdvancedTab = selectedTab === "advanced";
  const isConfigForSelectedBranch = configBranchHeadSha === selectedBranchHeadSha;
  const hasAdvancedConfig = configSource.trim().length > 0 && isConfigForSelectedBranch;
  const hasSelectedBranch = selectedBranchName.length > 0 && selectedBranchHeadSha.length > 0;
  const effectiveLlmModel = selectedLlmModel;
  const hasEnabledScanner = llmEnabled || osvEnabled;
  const canScan =
    repository !== undefined &&
    hasSelectedBranch &&
    hasEnabledScanner &&
    !isScanning &&
    (!isAdvancedTab || hasAdvancedConfig);
  const statusLabel = useMemo(() => readConfigStatusLabel(config?.status), [config?.status]);
  const hasSelectedLlmModelOption = llmModels.some((model) => model.id === selectedLlmModel);
  const selectedLlmModelValue = hasSelectedLlmModelOption ? selectedLlmModel : "";

  const loadConfig = useCallback(async () => {
    const hasRepository = repository !== undefined;
    const hasBranchHeadSha = selectedBranchHeadSha.length > 0;
    if (!hasRepository || !hasBranchHeadSha) {
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setConfig(undefined);
    setConfigBranchHeadSha(undefined);
    setConfigSource("");
    setError(undefined);
    setIsLoading(true);
    setQueuedDeliveryId(undefined);
    try {
      const requestedBranchHeadSha = selectedBranchHeadSha;
      const nextConfig = await fetchRepositoryConfig(
        repository,
        requestedBranchHeadSha,
        abortController.signal,
      );
      setConfig(nextConfig);
      setConfigBranchHeadSha(requestedBranchHeadSha);
      setConfigSource(nextConfig.source);
    } catch (loadError) {
      const isAbortError = loadError instanceof DOMException && loadError.name === "AbortError";
      if (!isAbortError) {
        setError(toErrorMessage(loadError));
      }
    } finally {
      setIsLoading(false);
    }
  }, [repository, selectedBranchHeadSha]);

  const loadBranches = useCallback(async () => {
    const hasRepository = repository !== undefined;
    if (!hasRepository) {
      return;
    }

    setIsBranchesLoading(true);
    try {
      const nextBranches = await fetchRepositoryBranches(repository);
      const hasBranches = nextBranches.length > 0;
      setBranches(
        hasBranches
          ? nextBranches
          : [{ name: repository.defaultBranch, sha: repository.defaultBranchHeadSha }],
      );
    } catch (branchError) {
      setError(toErrorMessage(branchError));
      setBranches([{ name: repository.defaultBranch, sha: repository.defaultBranchHeadSha }]);
    } finally {
      setIsBranchesLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    const shouldPrepareDialog = open && repository !== undefined;
    if (!shouldPrepareDialog) {
      setBranches([]);
      setLlmModels([]);
      setLlmModelsError(undefined);
      setSelectedLlmModel(initialLlmModel);
      setSelectedBranch(undefined);
      setConfigBranchHeadSha(undefined);
      setConfigSource("");
      abortControllerRef.current?.abort();
      return;
    }

    setSelectedBranch({ name: repository.defaultBranch, sha: repository.defaultBranchHeadSha });
    setSelectedLlmModel(initialLlmModel);
    void loadBranches();
  }, [initialLlmModel, loadBranches, open, repository]);

  useEffect(() => {
    const shouldLoadConfig = open && selectedBranchHeadSha.length > 0;
    if (!shouldLoadConfig) {
      abortControllerRef.current?.abort();
      return;
    }

    void loadConfig();
  }, [loadConfig, open, selectedBranchHeadSha]);

  useEffect(() => {
    const shouldLoadModels = open;
    if (!shouldLoadModels) {
      setLlmModels([]);
      setLlmModelsError(undefined);
      return;
    }

    setIsLlmModelsLoading(true);
    setLlmModelsError(undefined);
    void fetchLlmModels()
      .then((models) => {
        setLlmModels(models);
        setSelectedLlmModel((currentModel) => {
          const candidateModel = currentModel.length > 0 ? currentModel : initialLlmModel;
          const hasCandidateModel = models.some((model) => model.id === candidateModel);
          if (hasCandidateModel) {
            return candidateModel;
          }

          return chooseInitialLlmModel(models, readSavedLlmModel());
        });
      })
      .catch((modelError) => {
        setLlmModels([]);
        setLlmModelsError(toErrorMessage(modelError));
      })
      .finally(() => setIsLlmModelsLoading(false));
  }, [initialLlmModel, open]);

  const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
    configureMonacoWorkers();
    configureYamlLanguage(monaco);
  }, []);

  const handleEditorDidMount: OnMount = useCallback((editor) => {
    editor.focus();
  }, []);

  const handleEditorChange: OnChange = useCallback((value) => {
    setConfigSource(value ?? "");
    setQueuedDeliveryId(undefined);
  }, []);

  const handleTabChange = useCallback((_event: unknown, value: ScanDialogTab) => {
    setSelectedTab(value);
    setQueuedDeliveryId(undefined);
  }, []);

  const handleBranchChange = useCallback(
    (branchName: string) => {
      const branch = branches.find((candidate) => candidate.name === branchName);
      const hasBranch = branch !== undefined;
      if (!hasBranch) {
        return;
      }

      setSelectedBranch(branch);
      setQueuedDeliveryId(undefined);
    },
    [branches],
  );

  const handleLlmModelChange = useCallback(
    (model: string) => {
      setSelectedLlmModel(model);
      onLlmModelChange(model);
      writeSavedLlmModel(model);
      setQueuedDeliveryId(undefined);
    },
    [onLlmModelChange],
  );

  const handleScan = useCallback(async () => {
    const hasRepository = repository !== undefined;
    if (!hasRepository) {
      return;
    }

    setError(undefined);
    setQueuedDeliveryId(undefined);
    setIsScanning(true);
    try {
      const result = await startRepositoryScan(
        repository,
        { name: selectedBranchName, sha: selectedBranchHeadSha },
        isAdvancedTab && isConfigForSelectedBranch ? configSource : undefined,
        effectiveLlmModel.length > 0 ? effectiveLlmModel : undefined,
        { llmEnabled, osvEnabled },
      );
      setQueuedDeliveryId(result.deliveryId);
    } catch (scanError) {
      setError(toErrorMessage(scanError));
    } finally {
      setIsScanning(false);
    }
  }, [
    configSource,
    effectiveLlmModel,
    isAdvancedTab,
    isConfigForSelectedBranch,
    llmEnabled,
    osvEnabled,
    repository,
    selectedBranchHeadSha,
    selectedBranchName,
  ]);

  return (
    <Dialog
      fullWidth
      maxWidth="lg"
      onClose={onClose}
      open={open}
      slotProps={{
        paper: {
          sx: {
            bgcolor: "background.paper",
            overflow: "hidden",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          px: 3,
          py: 2,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", minHeight: 32, pr: 5 }}
        >
          <Typography component="span" sx={{ fontWeight: 800 }} variant="h6">
            Scan config
          </Typography>
          <AppBadge emphasis="outline" label={repositoryName} />
          {config?.status !== undefined && <ConfigSourceBadge status={config.status} />}
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Stack spacing={0}>
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3 }}>
            <Tabs onChange={handleTabChange} sx={{ minHeight: 48 }} value={selectedTab}>
              <Tab label="Basic" value="basic" />
              <Tab label="Advanced" value="advanced" />
            </Tabs>
          </Box>
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3, py: 2 }}>
            <Stack
              direction={{ sm: "row", xs: "column" }}
              spacing={2}
              sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
            >
              <Box sx={{ maxWidth: 760, minWidth: 0 }}>
                <Typography color="text.secondary" sx={{ lineHeight: 1.7 }} variant="body2">
                  {isAdvancedTab
                    ? `${config?.path ?? ".scanveil/config.yml"} を読み込み、編集した内容で選択 branch を scan します。`
                    : "選択 branch を、repository 内の設定または Scanveil default 設定で scan します。"}
                </Typography>
                {config?.warnings.map((warning) => (
                  <Typography
                    color="warning.main"
                    key={warning}
                    sx={{ display: "block", mt: 0.5 }}
                    variant="caption"
                  >
                    {warning}
                  </Typography>
                ))}
              </Box>
              <Stack
                direction={{ sm: "row", xs: "column" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" }, minWidth: { sm: 360, xs: 1 } }}
              >
                <FormControl
                  disabled={isBranchesLoading || repository === undefined}
                  fullWidth
                  size="small"
                >
                  <InputLabel id="scan-branch-label">Branch</InputLabel>
                  <Select
                    label="Branch"
                    labelId="scan-branch-label"
                    onChange={(event) => handleBranchChange(event.target.value)}
                    value={selectedBranchName}
                  >
                    {branchOptions.map((branch) => (
                      <MenuItem key={branch.name} value={branch.name}>
                        {branch.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: 1 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="scan-llm-model-label">LLM model</InputLabel>
                    <Select
                      disabled={!llmEnabled || isLlmModelsLoading}
                      label="LLM model"
                      labelId="scan-llm-model-label"
                      onChange={(event) => handleLlmModelChange(event.target.value)}
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
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={llmEnabled}
                        onChange={(_, checked) => setLlmEnabled(checked)}
                        size="small"
                      />
                    }
                    label="LLM"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={osvEnabled}
                        onChange={(_, checked) => setOsvEnabled(checked)}
                        size="small"
                      />
                    }
                    label="OSV"
                  />
                </Stack>
                <Button
                  disabled={isLoading || repository === undefined}
                  onClick={() => void loadConfig()}
                  startIcon={<RefreshIcon />}
                  sx={{ minWidth: 112 }}
                  variant="outlined"
                >
                  Reload
                </Button>
              </Stack>
            </Stack>
          </Box>

          {error !== undefined && (
            <Alert severity="error" sx={{ borderRadius: 0 }}>
              {error}
            </Alert>
          )}
          {llmModelsError !== undefined && (
            <Alert severity="warning" sx={{ borderRadius: 0 }}>
              LLM model list request failed: {llmModelsError}
            </Alert>
          )}
          {queuedDeliveryId !== undefined && (
            <Alert severity="success" sx={{ borderRadius: 0 }}>
              Scan queued:{" "}
              <a href={`/scans/${encodeURIComponent(queuedDeliveryId)}`}>{queuedDeliveryId}</a>
            </Alert>
          )}

          {isAdvancedTab ? (
            <Box sx={{ height: { md: "66vh", xs: "58vh" }, minHeight: 420, position: "relative" }}>
              {isLoading ? (
                <Stack
                  spacing={2}
                  sx={{ alignItems: "center", height: 1, justifyContent: "center" }}
                >
                  <CircularProgress />
                  <Typography color="text.secondary">Loading repository config</Typography>
                </Stack>
              ) : (
                <Editor
                  beforeMount={handleEditorWillMount}
                  height="100%"
                  language="yaml"
                  loading={<CircularProgress />}
                  onChange={handleEditorChange}
                  onMount={handleEditorDidMount}
                  options={{
                    automaticLayout: true,
                    fontFamily:
                      '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontLigatures: true,
                    fontSize: 13,
                    minimap: { enabled: false },
                    renderWhitespace: "selection",
                    scrollBeyondLastLine: false,
                    tabSize: 2,
                    wordWrap: "on",
                  }}
                  path="file:///.scanveil/config.yml"
                  theme="vs-dark"
                  value={configSource}
                />
              )}
            </Box>
          ) : (
            <Box sx={{ minHeight: 176, p: 3 }}>
              <Box
                sx={{
                  display: "grid",
                  gap: 1.5,
                  gridTemplateColumns: {
                    md: "repeat(auto-fit, minmax(150px, 1fr))",
                    xs: "1fr",
                  },
                }}
              >
                <ScanDialogFact label="Repository" value={repositoryName} />
                <ScanDialogFact label="Branch" value={selectedBranchName || "-"} />
                <ScanDialogFact
                  label="LLM model"
                  value={llmEnabled ? formatSelectedLlmModel(effectiveLlmModel, llmModels) : "Off"}
                />
                <ScanDialogFact label="OSV" value={osvEnabled ? "On" : "Off"} />
                <ScanDialogFact label="Config source" value={statusLabel ?? "Loading"} />
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ borderTop: "1px solid", borderColor: "divider", px: 3, py: 1.5 }}>
        <Button onClick={onClose}>Close</Button>
        <Button
          disabled={!canScan}
          onClick={() => void handleScan()}
          startIcon={isScanning ? <CircularProgress size={18} /> : <PlayArrowIcon />}
          variant="contained"
        >
          {isAdvancedTab ? "Scan with YAML" : "Scan"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ScanDialogFact({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        bgcolor: "background.default",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        minHeight: 96,
        p: 2,
      }}
    >
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, mt: 0.5, overflowWrap: "anywhere" }} variant="body2">
        {value}
      </Typography>
    </Box>
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
  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      const isYamlWorker = label === "yaml";
      if (isYamlWorker) {
        return new YamlWorker();
      }

      return new EditorWorker();
    },
  };
  isMonacoEnvironmentConfigured = true;
}

function configureYamlLanguage(monaco: Monaco): void {
  const nextOptions = {
    completion: true,
    enableSchemaRequest: true,
    format: {
      enable: true,
      printWidth: 100,
      singleQuote: false,
    },
    hover: true,
    schemas: [
      {
        fileMatch: ["file:///.scanveil/config.yml", "**/.scanveil.yml", "**/.scanveil/config.yml"],
        uri: readConfigSchemaUri(),
      },
    ],
    validate: true,
  };
  const yamlLanguage = monacoYaml;
  const shouldCreateYamlLanguage = yamlLanguage === undefined;
  if (shouldCreateYamlLanguage) {
    monacoYaml = configureMonacoYaml(monaco, nextOptions);
    return;
  }

  void yamlLanguage.update(nextOptions);
}

function readConfigSchemaUri(): string {
  return new URL("/api/config-schema", globalThis.location.origin).toString();
}

async function fetchRepositoryConfig(
  repository: RepositoryRow,
  headSha: string,
  signal: AbortSignal,
): Promise<RepositoryConfigResponse> {
  const params = new URLSearchParams({
    headSha,
    installationId: String(repository.installationId),
    repositoryId: String(repository.repositoryId),
  });
  const response = await fetch(
    `/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/config?${params.toString()}`,
    {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    },
  );
  const redirect = redirectApiAccess<RepositoryConfigResponse>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Config request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as RepositoryConfigResponse;
}

async function fetchRepositoryBranches(repository: RepositoryRow): Promise<RepositoryBranch[]> {
  const params = new URLSearchParams({
    installationId: String(repository.installationId),
    repositoryId: String(repository.repositoryId),
  });
  const response = await fetch(
    `/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/branches?${params.toString()}`,
    {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  const redirect = redirectApiAccess<RepositoryBranch[]>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Branch request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as RepositoryBranchesResponse;
  return body.branches;
}

async function fetchLlmModels(): Promise<LlmModelOption[]> {
  const response = await fetch("/api/llm-models", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const redirect = redirectApiAccess<LlmModelOption[]>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`LLM model request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as LlmModelsResponse;
  return body.models;
}

function formatLlmModelLabel(model: LlmModelOption): string {
  return model.displayName.length > 0 ? model.displayName : model.id;
}

function formatSelectedLlmModel(modelId: string, models: LlmModelOption[]): string {
  const model = models.find((candidate) => candidate.id === modelId);
  const hasModel = model !== undefined;
  if (hasModel) {
    return formatLlmModelLabel(model);
  }

  return modelId.length > 0 ? modelId : "-";
}

async function startRepositoryScan(
  repository: RepositoryRow,
  branch: RepositoryBranch,
  configSource: string | undefined,
  llmModel: string | undefined,
  scanners: { llmEnabled: boolean; osvEnabled: boolean },
): Promise<{ deliveryId: string; executionName: string }> {
  const hasConfigSource = configSource !== undefined;
  const hasLlmModel = llmModel !== undefined;
  const response = await fetch("/scans/start", {
    body: JSON.stringify({
      defaultBranch: branch.name,
      defaultBranchHeadSha: branch.sha,
      installationId: repository.installationId,
      llmEnabled: scanners.llmEnabled,
      ...(hasLlmModel ? { llmModel } : {}),
      osvEnabled: scanners.osvEnabled,
      owner: repository.owner,
      repo: repository.repo,
      repositoryId: repository.repositoryId,
      ...(hasConfigSource ? { configSource } : {}),
    }),
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });
  const redirect = redirectApiAccess<{ deliveryId: string; executionName: string }>(response);
  if (redirect !== undefined) {
    return redirect;
  }

  const isOk = response.ok;
  if (!isOk) {
    const body = await response.text();
    throw new Error(`Scan request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as { deliveryId: string; executionName: string };
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

function readConfigStatusLabel(
  status: RepositoryConfigResponse["status"] | undefined,
): string | undefined {
  const hasStatus = status !== undefined;
  if (!hasStatus) {
    return undefined;
  }

  return configStatusLabels[status];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
