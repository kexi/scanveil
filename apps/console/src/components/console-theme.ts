import useMediaQuery from "@mui/material/useMediaQuery";
import { createTheme } from "@mui/material/styles";
import { useMemo } from "react";

type ConsoleColorMode = "dark" | "light";

export function useConsoleTheme() {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const colorMode = prefersDarkMode ? "dark" : "light";
  return useMemo(() => createConsoleTheme(colorMode), [colorMode]);
}

function createConsoleTheme(mode: ConsoleColorMode) {
  const isDarkMode = mode === "dark";

  return createTheme({
    palette: {
      mode,
      background: {
        default: isDarkMode ? "#0f172a" : "#f6f8fb",
        paper: isDarkMode ? "#172033" : "#ffffff",
      },
      divider: isDarkMode ? "#334155" : "#dde3ee",
      primary: {
        main: isDarkMode ? "#6ee7d8" : "#134e5e",
        contrastText: isDarkMode ? "#0f172a" : "#ffffff",
      },
      secondary: {
        main: isDarkMode ? "#a78bfa" : "#7c3aed",
      },
      text: {
        primary: isDarkMode ? "#e7edf7" : "#172033",
        secondary: isDarkMode ? "#a8b3c7" : "#5b677a",
      },
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily: [
        "Inter",
        "ui-sans-serif",
        "system-ui",
        "-apple-system",
        "BlinkMacSystemFont",
        '"Segoe UI"',
        "sans-serif",
      ].join(","),
    },
    components: {
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 700,
            letterSpacing: 0,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
    },
  });
}
