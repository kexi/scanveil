import DashboardIcon from "@mui/icons-material/Dashboard";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BugReportIcon from "@mui/icons-material/BugReport";
import HistoryIcon from "@mui/icons-material/History";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import SourceIcon from "@mui/icons-material/Source";
import SettingsIcon from "@mui/icons-material/Settings";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";

import { productUiMetadata } from "../product-ui";
import { useConsoleTheme } from "./console-theme";

const drawerWidth = 264;

interface ConsoleShellProps {
  active?: "dashboard" | "fixPrs" | "history" | "repositories" | "settings" | "sve";
  actions?: ReactNode;
  children: ReactNode;
  subtitle?: ReactNode;
  title: string;
}

export default function ConsoleShell({
  active = "dashboard",
  actions,
  children,
  subtitle,
  title,
}: ConsoleShellProps) {
  const consoleTheme = useConsoleTheme();
  const isDashboardActive = active === "dashboard";
  const isFixPrsActive = active === "fixPrs";
  const isHistoryActive = active === "history";
  const isRepositoriesActive = active === "repositories";
  const isSettingsActive = active === "settings";
  const isSveActive = active === "sve";

  return (
    <ThemeProvider theme={consoleTheme}>
      <CssBaseline />
      <Box sx={{ bgcolor: "background.default", display: "flex", minHeight: "100vh" }}>
        <Drawer
          slotProps={{
            paper: {
              sx: {
                borderRight: "1px solid",
                borderRightColor: "divider",
                boxSizing: "border-box",
                width: drawerWidth,
              },
            },
          }}
          sx={{
            display: { xs: "none", md: "block" },
            flexShrink: 0,
            width: drawerWidth,
          }}
          variant="permanent"
        >
          <Toolbar sx={{ minHeight: 72, px: 2 }}>
            <Box
              component="a"
              href="/"
              sx={{
                alignItems: "center",
                color: "text.primary",
                display: "inline-flex",
                gap: 1,
                minWidth: 0,
                textDecoration: "none",
              }}
            >
              <Box
                alt=""
                component="img"
                height={30}
                src="/icon.svg"
                sx={{ display: "block", flexShrink: 0 }}
                width={30}
              />
              <Typography component="span" sx={{ fontWeight: 800 }} variant="subtitle1">
                {productUiMetadata.consoleDisplayName}
              </Typography>
            </Box>
          </Toolbar>
          <Divider />
          <List sx={{ px: 1, py: 1.5 }}>
            <ListItemButton href="/" selected={isDashboardActive} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <DashboardIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography component="span" sx={{ fontWeight: 700 }} variant="body2">
                    Dashboard
                  </Typography>
                }
              />
            </ListItemButton>
            <ListItemButton
              href="/repositories"
              selected={isRepositoriesActive}
              sx={{ borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <SourceIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Repositories" />
            </ListItemButton>
            <ListItemButton href="/sve" selected={isSveActive} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <BugReportIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="SVE" />
            </ListItemButton>
            <ListItemButton href="/scans" selected={isHistoryActive} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <HistoryIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Scan history" />
            </ListItemButton>
            <ListItemButton href="/fix-prs" selected={isFixPrsActive} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AutoFixHighIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Fix PRs" />
            </ListItemButton>
            <ListItemButton href="/settings" selected={isSettingsActive} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </List>
        </Drawer>

        <Box sx={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
          <Toolbar
            component="header"
            sx={{
              bgcolor: "background.paper",
              borderBottom: "1px solid",
              borderColor: "divider",
              minHeight: 72,
              px: { xs: 2, sm: 3 },
            }}
          >
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0, width: 1 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Box
                  component="a"
                  href="/"
                  sx={{
                    alignItems: "center",
                    color: "text.primary",
                    display: { xs: "inline-flex", md: "none" },
                    gap: 1,
                    mb: 0.25,
                    textDecoration: "none",
                  }}
                >
                  <Box alt="" component="img" height={24} src="/icon.svg" width={24} />
                  <Typography sx={{ fontWeight: 800 }} variant="subtitle2">
                    {productUiMetadata.consoleDisplayName}
                  </Typography>
                </Box>
                <Typography component="h1" noWrap sx={{ fontWeight: 800 }} variant="h5">
                  {title}
                </Typography>
                {subtitle && (
                  <Typography color="text.secondary" noWrap variant="body2">
                    {subtitle}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
                {actions}
                <Button
                  color="inherit"
                  href={productUiMetadata.docsUrl}
                  rel="noreferrer"
                  startIcon={<MenuBookIcon />}
                  target="_blank"
                >
                  Docs
                </Button>
                <Button color="inherit" href="/logout" startIcon={<LogoutIcon />}>
                  Logout
                </Button>
              </Stack>
            </Stack>
          </Toolbar>

          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              px: { xs: 2, sm: 3, lg: 4 },
              py: 3,
            }}
          >
            <Box sx={{ maxWidth: 1680, mx: "auto", width: 1 }}>{children}</Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
