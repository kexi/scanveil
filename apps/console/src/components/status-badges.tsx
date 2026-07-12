import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import type {
  FixPrRunRecord,
  FixPrRunStatus,
  ScanFindingRecord,
  ScanRunStatus,
} from "@scanveil/core";

import type { SveResolutionStatus } from "../sve-status";

type BadgeTone = "accent" | "caution" | "danger" | "info" | "neutral" | "success" | "warning";
type BadgeEmphasis = "outline" | "soft" | "solid";

interface ToneColors {
  bg: string;
  border: string;
  fg: string;
}

interface ToneDefinition {
  dark: ToneColors;
  light: ToneColors;
  solid: ToneColors;
}

interface AppBadgeProps {
  emphasis?: BadgeEmphasis;
  label: string;
  tone?: BadgeTone;
}

const toneDefinitions: Record<BadgeTone, ToneDefinition> = {
  accent: {
    dark: { bg: "rgba(45, 212, 191, 0.14)", border: "rgba(94, 234, 212, 0.34)", fg: "#99f6e4" },
    light: { bg: "#e6fffb", border: "#99f6e4", fg: "#0f766e" },
    solid: { bg: "#0f766e", border: "#0f766e", fg: "#ffffff" },
  },
  caution: {
    dark: { bg: "rgba(250, 204, 21, 0.14)", border: "rgba(253, 224, 71, 0.36)", fg: "#fde68a" },
    light: { bg: "#fef9c3", border: "#fde68a", fg: "#854d0e" },
    solid: { bg: "#b45309", border: "#b45309", fg: "#ffffff" },
  },
  danger: {
    dark: { bg: "rgba(248, 113, 113, 0.15)", border: "rgba(252, 165, 165, 0.36)", fg: "#fecaca" },
    light: { bg: "#fee2e2", border: "#fecaca", fg: "#b91c1c" },
    solid: { bg: "#b91c1c", border: "#b91c1c", fg: "#ffffff" },
  },
  info: {
    dark: { bg: "rgba(96, 165, 250, 0.14)", border: "rgba(147, 197, 253, 0.34)", fg: "#bfdbfe" },
    light: { bg: "#dbeafe", border: "#bfdbfe", fg: "#1d4ed8" },
    solid: { bg: "#1d4ed8", border: "#1d4ed8", fg: "#ffffff" },
  },
  neutral: {
    dark: { bg: "rgba(148, 163, 184, 0.12)", border: "rgba(148, 163, 184, 0.3)", fg: "#cbd5e1" },
    light: { bg: "#f1f5f9", border: "#cbd5e1", fg: "#475569" },
    solid: { bg: "#475569", border: "#475569", fg: "#ffffff" },
  },
  success: {
    dark: { bg: "rgba(52, 211, 153, 0.14)", border: "rgba(110, 231, 183, 0.34)", fg: "#bbf7d0" },
    light: { bg: "#dcfce7", border: "#bbf7d0", fg: "#15803d" },
    solid: { bg: "#15803d", border: "#15803d", fg: "#ffffff" },
  },
  warning: {
    dark: { bg: "rgba(251, 146, 60, 0.15)", border: "rgba(253, 186, 116, 0.36)", fg: "#fed7aa" },
    light: { bg: "#ffedd5", border: "#fed7aa", fg: "#c2410c" },
    solid: { bg: "#c2410c", border: "#c2410c", fg: "#ffffff" },
  },
};

const severityTones: Record<ScanFindingRecord["severity"], BadgeTone> = {
  critical: "danger",
  high: "warning",
  info: "neutral",
  low: "success",
  medium: "caution",
};

const sveStatusTones: Record<SveResolutionStatus, BadgeTone> = {
  active: "danger",
  resolved: "success",
  unverified: "caution",
};

const scanStatusTones: Record<ScanRunStatus, BadgeTone> = {
  cancelled: "neutral",
  failed: "danger",
  queued: "info",
  running: "accent",
  succeeded: "success",
};

const fixPrStatusTones: Record<FixPrRunStatus, BadgeTone> = {
  failed: "danger",
  queued: "info",
  running: "accent",
  succeeded: "success",
};

const sourceTones: Record<ScanFindingRecord["source"], BadgeTone> = {
  llm: "accent",
  osv: "info",
};

const configSourceTones: Record<"default" | "legacy" | "repository", BadgeTone> = {
  default: "neutral",
  legacy: "caution",
  repository: "accent",
};

export function AppBadge({ emphasis = "soft", label, tone = "neutral" }: AppBadgeProps) {
  return <Chip label={label} size="small" sx={badgeSx(tone, emphasis)} />;
}

export function SeverityBadge({ severity }: { severity: ScanFindingRecord["severity"] }) {
  return <AppBadge label={severity} tone={severityTones[severity]} />;
}

export function SveStatusBadge({ status }: { status: SveResolutionStatus }) {
  const emphasis = status === "resolved" ? "solid" : "soft";
  return <AppBadge emphasis={emphasis} label={status} tone={sveStatusTones[status]} />;
}

export function ScanStatusBadge({ status }: { status: ScanRunStatus | "unknown" }) {
  const isKnownStatus = status !== "unknown";
  const tone = isKnownStatus ? scanStatusTones[status] : "neutral";
  const emphasis = status === "succeeded" ? "solid" : "soft";
  return <AppBadge emphasis={emphasis} label={status} tone={tone} />;
}

export function FixPrStatusBadge({ status }: { status: FixPrRunRecord["status"] }) {
  const emphasis = status === "succeeded" ? "solid" : "soft";
  return <AppBadge emphasis={emphasis} label={status} tone={fixPrStatusTones[status]} />;
}

export function FindingSourceBadge({ source }: { source: ScanFindingRecord["source"] }) {
  return <AppBadge label={source.toUpperCase()} tone={sourceTones[source]} />;
}

export function ConfigSourceBadge({ status }: { status: "default" | "legacy" | "repository" }) {
  return <AppBadge label={configStatusLabels[status]} tone={configSourceTones[status]} />;
}

export function NewFindingBadge() {
  return <AppBadge emphasis="solid" label="new" tone="success" />;
}

export const configStatusLabels: Record<"default" | "legacy" | "repository", string> = {
  default: "Default config",
  legacy: "Legacy .scanveil.yml",
  repository: "Repository config",
};

function badgeSx(tone: BadgeTone, emphasis: BadgeEmphasis): SxProps<Theme> {
  return (theme) => {
    const colors = readToneColors(theme, tone, emphasis);
    return {
      bgcolor: colors.bg,
      border: "1px solid",
      borderColor: colors.border,
      borderRadius: "999px",
      color: colors.fg,
      fontSize: 12,
      fontWeight: 700,
      height: 24,
      letterSpacing: 0,
      lineHeight: 1,
      maxWidth: 220,
      minWidth: 0,
      textTransform: "none",
      "& .MuiChip-label": {
        overflow: "hidden",
        px: 1,
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
    };
  };
}

function readToneColors(theme: Theme, tone: BadgeTone, emphasis: BadgeEmphasis): ToneColors {
  const definition = toneDefinitions[tone];
  const isSolid = emphasis === "solid";
  if (isSolid) {
    return definition.solid;
  }

  const isLightMode = theme.palette.mode === "light";
  const colors = isLightMode ? definition.light : definition.dark;
  const isOutline = emphasis === "outline";
  if (!isOutline) {
    return colors;
  }

  return {
    bg: "transparent",
    border: colors.border,
    fg: colors.fg,
  };
}
