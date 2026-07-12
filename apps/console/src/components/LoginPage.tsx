import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import { productUiMetadata } from "../product-ui";
import { useConsoleTheme } from "./console-theme";

export default function LoginPage() {
  const consoleTheme = useConsoleTheme();

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
            <Stack spacing={2.5}>
              <Box>
                <Typography color="text.secondary" variant="body2">
                  {productUiMetadata.displayName}
                </Typography>
                <Typography component="h1" variant="h5">
                  {productUiMetadata.consoleDisplayName}
                </Typography>
              </Box>
              <Button fullWidth href="/login?start=github" size="large" variant="contained">
                Sign in with GitHub
              </Button>
              <Typography color="text.secondary" variant="caption">
                Scanveil uses only necessary cookies for GitHub sign-in and Console security. No
                advertising or tracking cookies are used.{" "}
                <Box
                  component="a"
                  href="https://www.scanveil.kexi.dev/privacy"
                  sx={{ color: "primary.main" }}
                >
                  Privacy
                </Box>
                {" / "}
                <Box
                  component="a"
                  href="https://www.scanveil.kexi.dev/terms"
                  sx={{ color: "primary.main" }}
                >
                  Terms
                </Box>
              </Typography>
            </Stack>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}
