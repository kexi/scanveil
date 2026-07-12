import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SecurityIcon from "@mui/icons-material/Security";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import CssBaseline from "@mui/material/CssBaseline";
import Divider from "@mui/material/Divider";
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
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { InstallationPolicy } from "@scanveil/core";
import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useMemo, useState } from "react";

const allowedAdminEmail = "kei.of.nakayama@gmail.com";
const adminApiBasePath = "/api";

export default function AdminApp() {
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: "dark",
          primary: { main: "#8bd3ff" },
          background: {
            default: "#0c1116",
            paper: "#111820",
          },
        },
        shape: { borderRadius: 8 },
      }),
    [],
  );
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [data, setData] = useState<AdminBootstrapResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void initializeFirebaseAuth()
      .then((auth) =>
        onAuthStateChanged(auth, (user) => {
          if (!isMounted) {
            return;
          }

          const hasUser = user !== null;
          if (!hasUser) {
            setAuthState({ status: "signed_out" });
            setData(undefined);
            return;
          }

          const isAllowed = user.email === allowedAdminEmail;
          setAuthState({ status: isAllowed ? "allowed" : "denied", user });
        }),
      )
      .catch((authError) => {
        if (!isMounted) {
          return;
        }

        setError(authError instanceof Error ? authError.message : String(authError));
        setAuthState({ status: "signed_out" });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const shouldLoad = authState.status === "allowed";
    if (!shouldLoad) {
      return;
    }

    void loadData(authState.user, setData, setError);
  }, [authState]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ bgcolor: "background.default", minHeight: "100vh", px: 3, py: 3 }}>
        <Stack spacing={3} sx={{ maxWidth: 1440, mx: "auto" }}>
          <Header authState={authState} setError={setError} />
          {error && <Alert severity="error">{error}</Alert>}
          <AdminBody
            authState={authState}
            data={data}
            isBusy={isBusy}
            refresh={() => {
              const isAllowed = authState.status === "allowed";
              if (!isAllowed) {
                return;
              }

              void loadData(authState.user, setData, setError);
            }}
            setBusy={setIsBusy}
            setData={setData}
            setError={setError}
          />
        </Stack>
      </Box>
    </ThemeProvider>
  );
}

function Header({
  authState,
  setError,
}: {
  authState: AuthState;
  setError(error: string | undefined): void;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
    >
      <Box>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <SecurityIcon color="primary" />
          <Typography component="h1" sx={{ fontWeight: 800 }} variant="h4">
            Scanveil Admin
          </Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Invite codes, usage history, and user access controls.
        </Typography>
      </Box>
      <Stack direction="row" spacing={1}>
        {authState.status === "allowed" && (
          <Chip color="success" label={authState.user.email ?? "admin"} variant="outlined" />
        )}
        {authState.status === "allowed" && (
          <Button
            color="inherit"
            onClick={() => {
              setError(undefined);
              void signOut(getAuth());
            }}
            startIcon={<LogoutIcon />}
          >
            Sign out
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

function AdminBody({
  authState,
  data,
  isBusy,
  refresh,
  setBusy,
  setData,
  setError,
}: {
  authState: AuthState;
  data: AdminBootstrapResponse | undefined;
  isBusy: boolean;
  refresh(): void;
  setBusy(value: boolean): void;
  setData(data: AdminBootstrapResponse): void;
  setError(error: string | undefined): void;
}) {
  const isLoading = authState.status === "loading";
  if (isLoading) {
    return <CenteredStatus label="Checking authentication" />;
  }

  const isSignedOut = authState.status === "signed_out";
  if (isSignedOut) {
    return <SignInPanel setError={setError} />;
  }

  const isDenied = authState.status === "denied";
  if (isDenied) {
    return (
      <Paper sx={{ p: 3 }} variant="outlined">
        <Stack spacing={2}>
          <Alert severity="error">この Google アカウントは管理画面を利用できません。</Alert>
          <Button onClick={() => void signOut(getAuth())}>別アカウントでログイン</Button>
        </Stack>
      </Paper>
    );
  }

  const hasData = data !== undefined;
  if (!hasData) {
    return <CenteredStatus label="Loading admin data" />;
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button disabled={isBusy} onClick={refresh} startIcon={<RefreshIcon />} variant="outlined">
          Refresh
        </Button>
      </Stack>
      <CreateInvitePanel
        isBusy={isBusy}
        setBusy={setBusy}
        setData={setData}
        setError={setError}
        user={authState.user}
      />
      <InstallationPolicyPanel
        installationPolicies={data.installationPolicies}
        isBusy={isBusy}
        setBusy={setBusy}
        setData={setData}
        setError={setError}
        user={authState.user}
      />
      <InviteCodeTable
        inviteCodes={data.inviteCodes}
        isBusy={isBusy}
        setBusy={setBusy}
        setData={setData}
        setError={setError}
        user={authState.user}
      />
      <UserTable
        isBusy={isBusy}
        setBusy={setBusy}
        setData={setData}
        setError={setError}
        user={authState.user}
        users={data.users}
      />
      <RedemptionTable redemptions={data.redemptions} />
    </Stack>
  );
}

function InstallationPolicyPanel({
  installationPolicies,
  isBusy,
  setBusy,
  setData,
  setError,
  user,
}: AdminMutationProps & { installationPolicies: InstallationPolicy[] }) {
  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Organization and user installations require an invite code before Scanveil scans their repositories."
        title="GitHub installations"
      />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Enabled</TableCell>
              <TableCell>Account</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Repositories</TableCell>
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
                user={user}
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
  user,
}: AdminMutationProps & { policy: InstallationPolicy }) {
  const [inviteCode, setInviteCode] = useState("");
  const hasInvite = policy.inviteCode !== undefined;
  const canScan = policy.enabled && hasInvite;

  useEffect(() => {
    setInviteCode("");
  }, [policy.installationId, policy.inviteCode]);

  const savePolicy = (enabled = policy.enabled) =>
    mutateAdmin(
      user,
      setBusy,
      setData,
      setError,
      `${adminApiBasePath}/installation-policies/${encodeURIComponent(String(policy.installationId))}`,
      {
        body: {
          enabled,
          inviteCode: inviteCode.trim(),
        },
        method: "PATCH",
      },
    );

  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={canScan}
          disabled={isBusy}
          onChange={(_, checked) => void savePolicy(checked)}
        />
      </TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <Stack spacing={0.5}>
          <Typography>{policy.accountLogin}</Typography>
          <Typography color="text.secondary" variant="caption">
            {`installation ${policy.installationId}`}
          </Typography>
          <Chip
            color={policy.accountType === "Organization" ? "primary" : "default"}
            label={policy.accountType}
            size="small"
            variant="outlined"
          />
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 280 }}>
        <Typography variant="body2">{formatInstallationScope(policy)}</Typography>
      </TableCell>
      <TableCell>
        <Stack spacing={0}>
          <Typography variant="body2">{policy.repositorySelection}</Typography>
          <Typography color="text.secondary" variant="caption">
            {`${policy.repositoryCount ?? 0} repositories`}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 260 }}>
        <Stack spacing={1}>
          <Chip
            color={hasInvite ? "success" : "warning"}
            label={hasInvite ? (policy.inviteName ?? policy.inviteCode) : "invite required"}
            size="small"
            variant="outlined"
          />
          <TextField
            disabled={isBusy}
            label="Invite code"
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="SV-..."
            size="small"
            value={inviteCode}
          />
        </Stack>
      </TableCell>
      <TableCell>
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

function formatInstallationScope(policy: InstallationPolicy): string {
  const isOrganization = policy.accountType === "Organization";
  if (isOrganization) {
    return "ORG 配下の GitHub App 許可済み repositories へ一括適用します。";
  }

  const isUser = policy.accountType === "User";
  if (isUser) {
    return "個人アカウント配下の GitHub App 許可済み repositories へ一括適用します。";
  }

  return "GitHub App が許可された repositories へ一括適用します。";
}

function SignInPanel({ setError }: { setError(error: string | undefined): void }) {
  return (
    <Paper sx={{ maxWidth: 440, mx: "auto", p: 3, width: 1 }} variant="outlined">
      <Stack spacing={2.5}>
        <Box>
          <Typography component="h2" sx={{ fontWeight: 800 }} variant="h5">
            Admin sign in
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            Google authentication is restricted to the Scanveil administrator.
          </Typography>
        </Box>
        <Button
          onClick={async () => {
            setError(undefined);
            try {
              await signInWithPopup(getAuth(), new GoogleAuthProvider());
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          size="large"
          variant="contained"
        >
          Sign in with Google
        </Button>
      </Stack>
    </Paper>
  );
}

function CreateInvitePanel({ isBusy, setBusy, setData, setError, user }: AdminMutationProps) {
  return (
    <Paper sx={{ p: 2.5 }} variant="outlined">
      <Stack
        action={`${adminApiBasePath}/invite-codes`}
        component="form"
        direction={{ xs: "column", md: "row" }}
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          void mutateAdmin(user, setBusy, setData, setError, `${adminApiBasePath}/invite-codes`, {
            body: {
              maxRedemptions: Number(form.get("maxRedemptions") ?? 0),
              name: String(form.get("name") ?? ""),
            },
            method: "POST",
          }).then(() => formElement.reset());
        }}
        spacing={2}
        sx={{ alignItems: { md: "center" } }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
            Create invite code
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Codes can be reused until their redemption limit is reached.
          </Typography>
        </Box>
        <TextField disabled={isBusy} label="Name" name="name" required size="small" />
        <TextField
          disabled={isBusy}
          label="Limit"
          name="maxRedemptions"
          required
          size="small"
          slotProps={{ htmlInput: { min: 1 } }}
          type="number"
        />
        <Button disabled={isBusy} startIcon={<AddIcon />} type="submit" variant="contained">
          Create
        </Button>
      </Stack>
    </Paper>
  );
}

function InviteCodeTable({
  inviteCodes,
  isBusy,
  setBusy,
  setData,
  setError,
  user,
}: AdminMutationProps & { inviteCodes: InviteCode[] }) {
  const [copiedCode, setCopiedCode] = useState<string | undefined>();
  const [visibleCodes, setVisibleCodes] = useState<Set<string>>(() => new Set());

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleInviteCodeVisibility = (code: string) => {
    setVisibleCodes((current) => {
      const next = new Set(current);
      const isVisible = next.has(code);
      if (isVisible) {
        next.delete(code);
      } else {
        next.add(code);
      }

      return next;
    });
  };

  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Create, pause, and inspect reusable invite codes."
        title="Invite codes"
      />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Usage</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Access</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {inviteCodes.map((inviteCode) => (
              <InviteCodeRow
                copiedCode={copiedCode}
                inviteCode={inviteCode}
                isBusy={isBusy}
                isCodeVisible={visibleCodes.has(inviteCode.code)}
                key={inviteCode.code}
                onCopy={copyInviteCode}
                onToggleVisibility={toggleInviteCodeVisibility}
                setBusy={setBusy}
                setData={setData}
                setError={setError}
                user={user}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function InviteCodeRow({
  copiedCode,
  inviteCode,
  isBusy,
  isCodeVisible,
  onCopy,
  onToggleVisibility,
  setBusy,
  setData,
  setError,
  user,
}: AdminMutationProps & {
  copiedCode: string | undefined;
  inviteCode: InviteCode;
  isCodeVisible: boolean;
  onCopy(code: string): Promise<void>;
  onToggleVisibility(code: string): void;
}) {
  return (
    <TableRow>
      <TableCell>{inviteCode.name}</TableCell>
      <TableCell>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography sx={{ fontFamily: "monospace" }}>
            {isCodeVisible ? inviteCode.code : maskInviteCode(inviteCode.code)}
          </Typography>
          <Button
            disabled={isBusy}
            onClick={() => onToggleVisibility(inviteCode.code)}
            size="small"
            startIcon={
              isCodeVisible ? (
                <VisibilityOffIcon fontSize="small" />
              ) : (
                <VisibilityIcon fontSize="small" />
              )
            }
            variant="outlined"
          >
            {isCodeVisible ? "hide" : "show"}
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => void onCopy(inviteCode.code)}
            size="small"
            startIcon={<ContentCopyIcon fontSize="small" />}
            variant="outlined"
          >
            {copiedCode === inviteCode.code ? "copied" : "copy"}
          </Button>
        </Stack>
      </TableCell>
      <TableCell>{`${inviteCode.redeemedCount} / ${inviteCode.maxRedemptions}`}</TableCell>
      <TableCell>
        <Chip
          color={inviteCode.enabled ? "success" : "default"}
          label={inviteCode.enabled ? "enabled" : "paused"}
          size="small"
          variant="outlined"
        />
      </TableCell>
      <TableCell>{formatDate(inviteCode.updatedAt)}</TableCell>
      <TableCell align="right">
        <Switch
          checked={inviteCode.enabled}
          disabled={isBusy}
          onChange={(_, checked) => {
            void mutateAdmin(
              user,
              setBusy,
              setData,
              setError,
              `${adminApiBasePath}/invite-codes/${encodeURIComponent(inviteCode.code)}`,
              {
                body: { enabled: checked },
                method: "PATCH",
              },
            );
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function maskInviteCode(code: string): string {
  const visiblePrefixLength = 7;
  const visibleSuffixLength = 4;
  const shouldMask = code.length > visiblePrefixLength + visibleSuffixLength;
  if (!shouldMask) {
    return code;
  }

  const prefix = code.slice(0, visiblePrefixLength);
  const suffix = code.slice(-visibleSuffixLength);
  return `${prefix}${"*".repeat(code.length - visiblePrefixLength - visibleSuffixLength)}${suffix}`;
}

function UserTable({
  isBusy,
  setBusy,
  setData,
  setError,
  user,
  users,
}: AdminMutationProps & { users: InviteUser[] }) {
  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Disable or re-enable accounts that redeemed invite codes."
        title="Users"
      />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>GitHub account</TableCell>
              <TableCell>Invite</TableCell>
              <TableCell>Registered</TableCell>
              <TableCell>Login</TableCell>
              <TableCell>Scans</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Access</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((inviteUser) => {
              const isDisabled = inviteUser.disabled === true;
              return (
                <TableRow key={inviteUser.id}>
                  <TableCell>
                    <Stack spacing={0}>
                      <Typography>{inviteUser.githubLogin}</Typography>
                      <Typography color="text.secondary" variant="caption">
                        {inviteUser.githubUserId}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{inviteUser.inviteName ?? "not redeemed"}</TableCell>
                  <TableCell>{formatDate(inviteUser.registeredAt)}</TableCell>
                  <TableCell>
                    <Stack spacing={0}>
                      <Typography variant="body2">{formatDate(inviteUser.lastLoginAt)}</Typography>
                      <Typography color="text.secondary" variant="caption">
                        {`${inviteUser.loginCount ?? 0} logins`}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0}>
                      <Typography variant="body2">
                        {`${inviteUser.manualScanRunCount ?? 0} runs`}
                      </Typography>
                      <Typography color="text.secondary" variant="caption">
                        {`${inviteUser.manualScanRequestCount ?? 0} requests`}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      color={isDisabled ? "error" : "success"}
                      icon={isDisabled ? <BlockIcon /> : <CheckCircleIcon />}
                      label={isDisabled ? "disabled" : "active"}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{formatDate(inviteUser.updatedAt)}</TableCell>
                  <TableCell align="right">
                    <Switch
                      checked={!isDisabled}
                      disabled={isBusy}
                      onChange={(_, checked) => {
                        void mutateAdmin(
                          user,
                          setBusy,
                          setData,
                          setError,
                          `${adminApiBasePath}/users/${encodeURIComponent(inviteUser.githubUserId)}`,
                          {
                            body: { disabled: !checked },
                            method: "PATCH",
                          },
                        );
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function RedemptionTable({ redemptions }: { redemptions: InviteRedemption[] }) {
  return (
    <Paper variant="outlined">
      <SectionHeader
        subtitle="Audit trail of which GitHub account used each code."
        title="Usage history"
      />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>GitHub account</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Code name</TableCell>
              <TableCell>Redeemed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {redemptions.map((redemption) => (
              <TableRow key={redemption.id}>
                <TableCell>{redemption.githubLogin}</TableCell>
                <TableCell>
                  <Typography sx={{ fontFamily: "monospace" }}>{redemption.code}</Typography>
                </TableCell>
                <TableCell>{redemption.codeName}</TableCell>
                <TableCell>{formatDate(redemption.redeemedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function SectionHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <>
      <Box sx={{ p: 2.5 }}>
        <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {subtitle}
        </Typography>
      </Box>
      <Divider />
    </>
  );
}

function CenteredStatus({ label }: { label: string }) {
  return (
    <Stack spacing={2} sx={{ alignItems: "center", py: 8 }}>
      <CircularProgress />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

async function initializeFirebaseAuth() {
  const configResponse = await fetch("/__/firebase/init.json");
  const isOk = configResponse.ok;
  if (!isOk) {
    throw new Error(
      `Firebase init failed: ${configResponse.status} ${await configResponse.text()}`,
    );
  }

  const config = (await configResponse.json()) as FirebaseOptions;
  initializeApp(withCurrentHostingAuthDomain(config));
  return getAuth();
}

function withCurrentHostingAuthDomain(config: FirebaseOptions): FirebaseOptions {
  const hostname = window.location.hostname;
  const isHostedAdminDomain = hostname === "admin.scanveil.kexi.dev";
  if (!isHostedAdminDomain) {
    return config;
  }

  return {
    ...config,
    authDomain: window.location.host,
  };
}

async function loadData(
  user: User,
  setData: (data: AdminBootstrapResponse) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  try {
    setError(undefined);
    const token = await user.getIdToken();
    const response = await fetch(`${adminApiBasePath}/bootstrap`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`Admin API failed: ${response.status} ${await response.text()}`);
    }

    setData((await response.json()) as AdminBootstrapResponse);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function mutateAdmin(
  user: User,
  setBusy: (value: boolean) => void,
  setData: (data: AdminBootstrapResponse) => void,
  setError: (error: string | undefined) => void,
  path: string,
  options: { body: unknown; method: "PATCH" | "POST" },
): Promise<void> {
  try {
    setBusy(true);
    setError(undefined);
    const token = await user.getIdToken();
    const response = await fetch(path, {
      body: JSON.stringify(options.body),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: options.method,
    });
    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`Admin API failed: ${response.status} ${await response.text()}`);
    }

    setData((await response.json()) as AdminBootstrapResponse);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function formatDate(value: string | undefined): string {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return "-";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type AuthState =
  | { status: "allowed"; user: User }
  | { status: "denied"; user: User }
  | { status: "loading" }
  | { status: "signed_out" };

interface AdminMutationProps {
  isBusy: boolean;
  setBusy(value: boolean): void;
  setData(data: AdminBootstrapResponse): void;
  setError(error: string | undefined): void;
  user: User;
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
