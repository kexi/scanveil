import LoginIcon from "@mui/icons-material/Login";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";

import { productUiMetadata } from "../product-ui";
import { useConsoleTheme } from "./console-theme";

export default function InvitePage() {
  const consoleTheme = useConsoleTheme();
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  return (
    <ThemeProvider theme={consoleTheme}>
      <CssBaseline />
      <Box
        sx={{
          alignItems: "center",
          bgcolor: "background.default",
          display: "flex",
          minHeight: "100vh",
        }}
      >
        <Container maxWidth="xs">
          <Paper sx={{ p: 3 }} variant="outlined">
            <Stack component="form" action="/invite/redeem" method="post" spacing={2.5}>
              <Box>
                <Typography color="text.secondary" variant="body2">
                  {productUiMetadata.displayName}
                </Typography>
                <Typography component="h1" variant="h5">
                  Invite code
                </Typography>
              </Box>
              {error && <Alert severity="error">{formatInviteError(error)}</Alert>}
              <TextField
                autoComplete="one-time-code"
                autoFocus
                fullWidth
                label="Invite code"
                name="code"
                required
                slotProps={{ htmlInput: { style: { textTransform: "uppercase" } } }}
              />
              <Button fullWidth startIcon={<LoginIcon />} type="submit" variant="contained">
                Continue
              </Button>
              <Button color="inherit" href="/logout">
                Logout
              </Button>
            </Stack>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

function formatInviteError(error: string): string {
  const isFull = error === "invite_full";
  if (isFull) {
    return "この招待コードは利用上限に達しています。";
  }

  const isDisabled = error === "invite_disabled";
  if (isDisabled) {
    return "この招待コードは現在利用できません。";
  }

  const isUserDisabled = error === "user_disabled";
  if (isUserDisabled) {
    return "このアカウントは利用停止中です。";
  }

  return "招待コードを確認してください。";
}
