import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SecurityIcon from "@mui/icons-material/Security";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { type ReactNode } from "react";

import { productMetadata } from "../../../packages/core/src/product";

interface PageDefinition {
  description: string;
  path: string;
  title: string;
  content: ReactNode;
  wide?: boolean;
}

const githubAppInstallUrl = "https://github.com/apps/scanveil-app/installations/new";
const consoleUrl = "https://console.scanveil.kexi.dev/login";
const contactEmail = "kei.of.nakayama@gmail.com";
const documentLastUpdated = "2026-07-12 JST";

const navItems = [
  ["/", "home", "概要"],
  ["/getting-started", "rocket_launch", "Getting Started"],
  ["/configuration", "tune", "設定"],
  ["/checks", "verified", "PR Checks"],
  ["/security-model", "shield_lock", "Security Model"],
  ["/notes", "article", "Notes"],
  ["/privacy", "policy", "Privacy"],
  ["/terms", "gavel", "Terms"],
] as const;

// Why not useMediaQuery + palette.mode: 静的レンダリングはライトテーマの
// emotion スタイルを HTML に焼き込むため、ダークモードでは hydration まで
// 暗い背景に濃色文字が出て読めない。CSS variables + media selector なら
// JS なしで prefers-color-scheme に追従する。
const docsTheme = createTheme({
  colorSchemes: {
    dark: {
      palette: {
        background: {
          default: "#0f172a",
          paper: "#172033",
        },
        divider: "#334155",
        primary: {
          main: "#7dd3fc",
        },
        secondary: {
          main: "#6ee7d8",
        },
        text: {
          primary: "#f4f7fb",
          secondary: "#c1cada",
        },
      },
    },
    light: {
      palette: {
        background: {
          default: "#f7f8fb",
          paper: "#ffffff",
        },
        divider: "#dde3ee",
        primary: {
          main: "#17324d",
        },
        secondary: {
          main: "#0f766e",
        },
        text: {
          primary: "#172033",
          secondary: "#475569",
        },
      },
    },
  },
  cssVariables: {
    colorSchemeSelector: "media",
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

export const pages: PageDefinition[] = [
  {
    path: "/",
    title: "概要",
    description: `GCP 上で動く GitHub App 型セキュリティ検査 PoC ${productMetadata.displayName} の概要`,
    content: (
      <>
        <h1>{productMetadata.displayName}</h1>
        <p>
          {productMetadata.displayName} は GitHub App としてリポジトリにインストールされ、PR ごとに
          LLM と Google OSV Scanner で検査します。Management Console から repository-wide Scan
          も起動できます。結果は GitHub Checks に表示されます。
        </p>
        <section className="actions" aria-label="Primary actions">
          <a className="button primary" href={githubAppInstallUrl}>
            <MaterialIcon name="add_circle" />
            <span>GitHub App をインストール</span>
          </a>
          <a className="button" href={consoleUrl}>
            <MaterialIcon name="dashboard" />
            <span>Management Console を開く</span>
          </a>
        </section>
        <section>
          <h2>検査の対象</h2>
          <ul>
            <li>
              LLM 検査: PR scan では PR diff、repository-wide Scan では既定ブランチの source
              snapshot
            </li>
            <li>
              OSV Scanner: PR scan では変更された lockfile、repository-wide Scan では既定ブランチの
              lockfile
            </li>
            <li>重複抑制: 同じ箇所への LLM 表現違いを embedding 類似度で抑制</li>
          </ul>
        </section>
        <section>
          <h2>インストール先による違い</h2>
          <div className="comparison-table" role="region" aria-label="Installation comparison">
            <table>
              <thead>
                <tr>
                  <th>項目</th>
                  <th>Repository / User にインストール</th>
                  <th>Organization にインストール</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>対象範囲</th>
                  <td>GitHub App に許可した個人アカウント配下の selected repositories。</td>
                  <td>Organization 配下で GitHub App に許可した all / selected repositories。</td>
                </tr>
                <tr>
                  <th>PR scan</th>
                  <td>許可した repository の PR で実行できます。</td>
                  <td>許可した org repository の PR で実行できます。</td>
                </tr>
                <tr>
                  <th>Repository-wide Scan</th>
                  <td>許可した repository ごとに Management Console から起動できます。</td>
                  <td>
                    許可した org repositories を横断して Management Console から起動できます。
                  </td>
                </tr>
                <tr>
                  <th>一括適用</th>
                  <td>個人アカウントの許可済み repository に限定されます。</td>
                  <td>org の all repositories を選ぶと、新規 repository も対象にできます。</td>
                </tr>
                <tr>
                  <th>できないこと</th>
                  <td>Organization 全体の repository 管理や org メンバー管理には使えません。</td>
                  <td>GitHub App に許可していない private repository は scan できません。</td>
                </tr>
                <tr>
                  <th>Scanveil 側の有効化</th>
                  <td>installation ごとに invite code を紐づけて enabled にする必要があります。</td>
                  <td>installation ごとに invite code を紐づけて enabled にする必要があります。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>実行基盤</h2>
          <p>
            GitHub webhook は Cloud Functions の webhook handler が受け、Cloud Run job が scan
            worker として実行されます。状態と finding は Firestore に保存されます。
          </p>
        </section>
      </>
    ),
  },
  {
    path: "/getting-started",
    title: "Getting Started",
    description: "GitHub App のインストールと初回利用手順",
    content: (
      <>
        <h1>Getting Started</h1>
        <p>
          <a className="button primary" href={githubAppInstallUrl}>
            <MaterialIcon name="add_circle" />
            <span>GitHub App をインストール</span>
          </a>
        </p>
        <ol>
          <li>GitHub App を対象 organization または repository にインストールします。</li>
          <li>
            Operator Admin に連絡して installation に invite code を紐づけ、有効化してもらいます。
            有効化されるまで scan は実行されません。
          </li>
          <li>
            必要に応じて repository root に <code>{productMetadata.configFileName}</code>{" "}
            を追加します。
          </li>
          <li>Pull Request を作成または更新します。</li>
          <li>
            GitHub Checks の <strong>{productMetadata.displayName}</strong> を確認します。
          </li>
        </ol>
        <h2>必要権限</h2>
        <ul>
          <li>Contents: Read and write（scan 入力の取得と Console からの fix PR commit 作成）</li>
          <li>Pull requests: Read and write（PR diff の取得と fix draft PR 作成）</li>
          <li>Checks: Read and write（check run の発行）</li>
          <li>Issues: Read and write（Console からの finding Issue 作成）</li>
          <li>Metadata: Read</li>
        </ul>
      </>
    ),
  },
  {
    path: "/configuration",
    title: "設定",
    description: `${productMetadata.configFileName} の設定`,
    content: <ConfigurationPage />,
    wide: true,
  },
  {
    path: "/checks",
    title: "PR Checks",
    description: "GitHub Checks に表示される検査結果",
    content: (
      <>
        <h1>PR Checks</h1>
        <p>検査結果は GitHub Checks API に summary と annotations として表示されます。</p>
        <ul>
          <li>
            <code>advisory</code>: finding があっても check は success
          </li>
          <li>
            <code>fail_on_threshold</code>: 設定した severity 以上の finding で failure
          </li>
          <li>
            重複抑制された LLM finding は annotation に出さず、summary の suppressed count に集約
          </li>
        </ul>
      </>
    ),
  },
  {
    path: "/security-model",
    title: "Security Model",
    description: "LLM、OSV、RAG 類似抑制、保存データの説明",
    content: (
      <>
        <h1>Security Model</h1>
        <h2>LLM 検査</h2>
        <p>
          PR scan では PR diff の変更箇所と周辺文脈のみを渡します。repository-wide Scan
          では既定ブランチから対象 source file を限定取得し、annotation 可能な snapshot
          として渡します。 モデルは安価優先で Gemini Flash Lite 系を標準にします。
        </p>
        <h2>OSV Scanner</h2>
        <p>
          OSV Scanner は PR scan では変更された lockfile、repository-wide Scan では既定ブランチの
          lockfile を対象にします。CVE/GHSA/OSV ID と aliases は同一脆弱性として扱います。
        </p>
        <h2>RAG 類似抑制</h2>
        <p>
          LLM finding を正規化し、embedding と code span fingerprint
          により同一箇所への重複指摘を抑制します。
        </p>
        <h2>保存データ</h2>
        <p>
          Scan execution は Firestore の <code>scanRuns</code> に、finding 明細は{" "}
          <code>scanFindings</code> に保存します。Management Console の Scan history は実行履歴と
          finding 概要に加えて、LLM provider、モデル、token 数、概算 cost、Vertex AI location、
          Cloud Run runner region を表示します。
        </p>
      </>
    ),
  },
  {
    path: "/notes",
    title: "Notes",
    description: `${productMetadata.displayName} の運用ノート`,
    content: (
      <>
        <h1>Notes</h1>
        <h2>Lockfile scan</h2>
        <p>
          PR scan では OSV Scanner は変更された lockfile だけを対象に実行され、lockfile の変更がない
          PR では OSV scan は実行されません。LLM 検査は PR diff を対象に実行されます。
          repository-wide Scan では既定ブランチの lockfile と source snapshot を対象にします。
        </p>
        <h2>Duplicate suppression</h2>
        <p>
          類似度閾値を下げると抑制されやすくなります。デフォルトは <code>0.70</code> です。
        </p>
        <h2>Model support</h2>
        <p>
          Management Console から Agy-runner 起動時の LLM model を選択できます。未選択時は
          低コストの Gemini Flash Lite 系を初期選択します。
        </p>
      </>
    ),
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: `${productMetadata.displayName} の Cookie とプライバシー方針`,
    content: (
      <>
        <h1>Privacy</h1>
        <p className="document-meta">最終更新: {documentLastUpdated}</p>
        <p>
          {productMetadata.displayName} は、ログインとセキュリティに必要な Cookie
          だけを使用します。広告、行動ターゲティング、第三者マーケティング用 Cookie は使用しません。
        </p>
        <section>
          <h2>Cookie の利用</h2>
          <div className="comparison-table" role="region" aria-label="Cookie usage">
            <table>
              <thead>
                <tr>
                  <th>種類</th>
                  <th>目的</th>
                  <th>同意</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Console session</th>
                  <td>Management Console へのログイン状態を保持します。</td>
                  <td>サービス提供に必要な Cookie として扱います。</td>
                </tr>
                <tr>
                  <th>OAuth state</th>
                  <td>GitHub OAuth callback の CSRF 対策に使います。</td>
                  <td>セキュリティに必要な一時 Cookie として扱います。</td>
                </tr>
                <tr>
                  <th>Analytics / Ads</th>
                  <td>現在は使用していません。</td>
                  <td>導入する場合は事前に同意 UI を追加します。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>保存するデータ</h2>
          <p>
            GitHub OAuth で取得した GitHub user ID、login、repository access snapshot、GitHub App
            installation と repository metadata、Scan execution、finding、LLM output、LLM token
            使用量、 概算 cost を {productMetadata.displayName}{" "}
            の提供、アクセス制御、監査、費用把握、 不具合調査に必要な範囲で保存します。
          </p>
        </section>
        <section>
          <h2>保持期間</h2>
          <p>
            開発中の Beta / PoC として、保持期間は短めに設定します。運用上必要な場合、障害調査、
            不正利用調査、法令対応、バックアップ反映のために削除完了まで追加時間がかかることがあります。
          </p>
          <RetentionTable />
        </section>
        <section>
          <h2>削除・訂正・アクセス依頼</h2>
          <p>
            保存データの確認、訂正、削除、利用停止を希望する場合は、GitHub login と対象 repository
            または organization が分かる情報を添えて <ContactLink />{" "}
            まで連絡してください。本人確認と repository への正当な関係を確認したうえで対応します。
          </p>
        </section>
        <section>
          <h2>問い合わせ先</h2>
          <p>
            Privacy、Cookie、データ削除、またはセキュリティに関する問い合わせは <ContactLink />{" "}
            まで連絡してください。
          </p>
        </section>
        <section>
          <h2>今後の変更</h2>
          <p>
            Analytics、session replay、広告、マーケティング pixel、またはサービス提供に必須ではない
            browser storage を導入する場合は、同意取得と拒否後の動作を実装してから有効化します。
          </p>
        </section>
      </>
    ),
  },
  {
    path: "/terms",
    title: "Terms",
    description: `${productMetadata.displayName} の Beta / PoC 利用規約`,
    content: (
      <>
        <h1>Terms</h1>
        <p className="document-meta">最終更新: {documentLastUpdated}</p>
        <p>
          {productMetadata.displayName} は GitHub App として repository のソースコードや依存関係を
          scan する Beta / PoC サービスです。利用者は、自分が管理権限または正当な利用権限を持つ
          repository、organization、GitHub App installation に対してのみ本サービスを利用できます。
        </p>
        <section>
          <h2>Scan 対象コードの扱い</h2>
          <p>
            PR scan では pull request diff と変更された lockfile、repository-wide Scan
            では既定ブランチの source snapshot と lockfile
            を取得します。取得したコード片、依存関係情報、検出結果は、 scan の実行、GitHub Checks /
            Console への表示、重複抑制、SVE 詳細表示、障害調査、
            セキュリティ改善のために利用します。
          </p>
        </section>
        <section>
          <h2>LLM / Vertex AI に送るデータ</h2>
          <p>
            LLM scan を有効にした場合、対象コード片、diff、周辺文脈、設定ファイル、scan
            方針、検出結果生成に必要なプロンプトを Google Cloud Vertex AI の Gemini
            モデルまたは設定された runner に送信します。画像、音声、TTS、preview 用モデルは
            セキュリティ scan の主要処理では使用しません。
          </p>
        </section>
        <section>
          <h2>検出結果の性質</h2>
          <p>
            本サービスの finding は開発者の確認を補助する情報です。誤検知、見逃し、severity
            の誤判定、修正提案の不完全性があり得ます。利用者は、本サービスの出力だけに依存せず、
            自身のレビュー、テスト、監査、運用判断と組み合わせて利用してください。
          </p>
        </section>
        <section>
          <h2>利用停止・削除</h2>
          <p>
            利用者は GitHub App の uninstall、repository access の変更、Console からの scan
            停止、または <ContactLink /> への連絡により、利用停止や保存データの削除を依頼できます。
            不正利用、権限のない repository scan、過度な負荷、セキュリティ上の懸念がある場合、
            Scanveil 側で scan の拒否、アカウントの無効化、installation policy の停止、
            保存データの削除を行うことがあります。
          </p>
        </section>
        <section>
          <h2>Beta / PoC</h2>
          <p>
            本サービスは Beta / PoC として提供され、機能、UI、保存データ、保持期間、対応モデル、
            scan 方針、価格表示は変更されることがあります。商用利用や重要な意思決定に使う場合は、
            事前にサービスの状態、設定、保存データの扱いを確認してください。
          </p>
        </section>
        <section>
          <h2>問い合わせ先</h2>
          <p>
            Terms、Privacy、データ削除、または利用停止に関する問い合わせは <ContactLink />{" "}
            まで連絡してください。
          </p>
        </section>
      </>
    ),
  },
];

function ContactLink(): ReactNode {
  return <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
}

function RetentionTable(): ReactNode {
  const rows = [
    [
      "scanStreamChunks",
      "30日",
      "実行中・直後の Console streaming 表示に使う短い LLM 出力 chunk。",
    ],
    ["LLM output object", "30日", "Scan Detail から確認する full LLM output。"],
    [
      "scanRuns",
      "利用停止または削除依頼まで",
      "scan 実行履歴、status、repository、token 使用量、概算 cost。自動削除は未導入です。",
    ],
    [
      "scanFindings",
      "利用停止または削除依頼まで",
      "LLM / OSV finding、SVE、重複抑制、annotation 用 metadata。自動削除は未導入です。",
    ],
    [
      "repository access snapshot",
      "1時間で再取得",
      "Console access control 用の GitHub repository visibility。",
    ],
    [
      "inviteUsers",
      "利用停止または削除依頼まで",
      "invite redemption、disabled status、login counters、利用制御。",
    ],
  ] as const;

  return (
    <div className="comparison-table" role="region" aria-label="Data retention">
      <table>
        <thead>
          <tr>
            <th>データ</th>
            <th>保持期間</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, retention, description]) => (
            <tr key={name}>
              <th>{name}</th>
              <td>{retention}</td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App(): ReactNode {
  const page = resolvePage(globalThis.location?.pathname ?? "/");
  return <DocsPage page={page} />;
}

export function DocsPage({ page }: { page: PageDefinition }): ReactNode {
  return (
    <ThemeProvider theme={docsTheme}>
      <header className="topbar">
        <a className="brand" href="/">
          <img alt="" className="brand-icon" height="28" src="/icon.svg" width="28" />
          <span>{productMetadata.displayName}</span>
        </a>
        <span>{productMetadata.tagline}</span>
        <nav className="topbar-actions" aria-label="Primary actions">
          <a href={githubAppInstallUrl}>
            <MaterialIcon name="add_circle" />
            <span>Install GitHub App</span>
          </a>
          <a href={consoleUrl}>
            <MaterialIcon name="dashboard" />
            <span>Management Console</span>
          </a>
        </nav>
      </header>
      <div className="shell">
        <aside className="sidebar" aria-label="Docs navigation">
          {navItems.map(([href, icon, label]) => (
            <a href={href} key={href}>
              <MaterialIcon name={icon} />
              <span>{label}</span>
            </a>
          ))}
        </aside>
        <main className={page.wide === true ? "content content-wide" : "content"}>
          {page.content}
        </main>
      </div>
    </ThemeProvider>
  );
}

export function resolvePage(pathname: string): PageDefinition {
  const normalizedPath = normalizePath(pathname);
  const page = pages.find((item) => item.path === normalizedPath);
  const fallbackPage = pages[0];
  const hasFallbackPage = fallbackPage !== undefined;
  if (!hasFallbackPage) {
    throw new Error("Docs pages must include at least one page.");
  }

  return page ?? fallbackPage;
}

export function getPageTitle(page: PageDefinition): string {
  return `${page.title} | ${productMetadata.displayName}`;
}

function MaterialIcon({ name }: { name: string }): ReactNode {
  return (
    <span className="material-symbols-rounded" aria-hidden="true">
      {name}
    </span>
  );
}

function normalizePath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  const isRoot = withoutTrailingSlash.length === 0;
  if (isRoot) {
    return "/";
  }

  return withoutTrailingSlash;
}

function getConfigurationQuickDecisions(): Array<{
  defaultLabel: string;
  description: string;
  icon: ReactNode;
  title: string;
}> {
  return [
    {
      defaultLabel: "Default: advisory",
      description: "導入直後は findings を可視化するだけにして、既存開発フローを止めません。",
      icon: <CheckCircleIcon color="success" />,
      title: "PR を止めるか",
    },
    {
      defaultLabel: "Default: LLM + OSV",
      description:
        "PR diff と lockfile を組み合わせ、コード由来と依存関係由来のリスクを分けて見ます。",
      icon: <SecurityIcon color="primary" />,
      title: "何を検査するか",
    },
    {
      defaultLabel: "Default: similarity 0.70",
      description:
        "同じ箇所への表現違いを抑制し、Scan history と GitHub Checks を読みやすく保ちます。",
      icon: <ScheduleIcon color="secondary" />,
      title: "重複をどう扱うか",
    },
  ];
}

function getConfigurationSections(): Array<{
  description: string;
  icon: ReactNode;
  items: Array<{ label: string; value: ReactNode }>;
  title: string;
}> {
  return [
    {
      description:
        "GitHub Checks の結論を制御します。advisory は finding があっても success です。",
      icon: <ShieldOutlinedIcon color="primary" />,
      items: [
        { label: "Recommended start", value: <code>advisory</code> },
        { label: "Blocking mode", value: <code>fail_on_threshold</code> },
        { label: "Initial threshold", value: <code>critical</code> },
      ],
      title: "Check policy",
    },
    {
      description: "LLM review は source diff/snapshot、OSV は lockfile を対象にします。",
      icon: <SecurityIcon color="primary" />,
      items: [
        { label: "PR scan", value: "PR diff + changed lockfiles" },
        { label: "Repository scan", value: "default branch snapshot + lockfiles" },
        { label: "Common excludes", value: <code>dist/**, vendor/**</code> },
      ],
      title: "Scan scope",
    },
    {
      description: "LLM finding を正規化し、repository 内の過去 finding と比較します。",
      icon: <SettingsSuggestIcon color="primary" />,
      items: [
        { label: "Similarity", value: <code>0.70</code> },
        { label: "Neighbors", value: <code>10</code> },
        { label: "Storage", value: "Firestore scanFindings" },
      ],
      title: "Suppression",
    },
  ];
}

function ConfigurationPage(): ReactNode {
  const quickDecisions = getConfigurationQuickDecisions();
  const sections = getConfigurationSections();
  return (
    <Stack spacing={4}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip color="primary" icon={<TuneIcon />} label="Repository policy" />
          <Chip icon={<ShieldOutlinedIcon />} label="Advisory by default" variant="outlined" />
          <Chip icon={<ContentCopyIcon />} label="Schema published" variant="outlined" />
        </Stack>
        <Box>
          <Typography component="h1" sx={{ fontWeight: 850 }} variant="h3">
            {productMetadata.configFileName}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 760, mt: 1 }} variant="body1">
            リポジトリごとの検査ポリシーを 1 ファイルで調整します。未配置なら advisory mode
            で動作し、PR をブロックしません。YAML language server 用の JSON Schema は{" "}
            <code>/schema/scanveil.config.schema.json</code> で公開しています。
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            href="/schema/scanveil.config.schema.json"
            startIcon={<SettingsSuggestIcon />}
            variant="contained"
          >
            JSON Schema for YAML
          </Button>
          <Button href="#fields" startIcon={<InfoOutlinedIcon />} variant="outlined">
            Field reference
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {quickDecisions.map((item) => (
          <Grid key={item.title} size={{ xs: 12, md: 4 }}>
            <Paper sx={{ height: 1, p: 2.25 }} variant="outlined">
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {item.icon}
                  <Typography component="h2" sx={{ fontWeight: 800 }} variant="subtitle1">
                    {item.title}
                  </Typography>
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  {item.description}
                </Typography>
                <Chip label={item.defaultLabel} size="small" sx={{ alignSelf: "flex-start" }} />
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Alert icon={<InfoOutlinedIcon />} severity="info">
        PR scan は pull request diff を対象に LLM review と OSV scan を実行します。 repository-wide
        Scan は default branch の source snapshot と lockfile を対象にします。
      </Alert>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper sx={{ p: 2.5 }} variant="outlined">
            <Stack spacing={2}>
              <Box>
                <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
                  Recommended baseline
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  最初は advisory で導入し、false positive を見てから threshold failure
                  に切り替えるのが安全です。
                </Typography>
              </Box>
              <Box className="code-panel">
                <pre>
                  <code>{getScanveilConfigExample()}</code>
                </pre>
              </Box>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Stack spacing={2}>
            {sections.map((section) => (
              <Paper key={section.title} sx={{ p: 2.5 }} variant="outlined">
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    {section.icon}
                    <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
                      {section.title}
                    </Typography>
                  </Stack>
                  <Typography color="text.secondary" variant="body2">
                    {section.description}
                  </Typography>
                  <Divider />
                  <Stack spacing={1}>
                    {section.items.map((item) => (
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        key={item.label}
                        spacing={1}
                        sx={{ justifyContent: "space-between" }}
                      >
                        <Typography sx={{ fontWeight: 700 }} variant="body2">
                          {item.label}
                        </Typography>
                        <Typography color="text.secondary" variant="body2">
                          {item.value}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Grid>
      </Grid>

      <Paper id="fields" sx={{ overflow: "hidden" }} variant="outlined">
        <Box sx={{ p: 2.5 }}>
          <Typography component="h2" sx={{ fontWeight: 800 }} variant="h6">
            Field reference
          </Typography>
          <Typography color="text.secondary" variant="body2">
            既定値、型の意図、運用上の影響をまとめています。
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>Default</TableCell>
                <TableCell>Meaning</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {getConfigurationFields().map((field) => (
                <TableRow key={field.name}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <code>{field.name}</code>
                  </TableCell>
                  <TableCell>{field.defaultValue}</TableCell>
                  <TableCell>{field.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Alert icon={<ReportProblemOutlinedIcon />} severity="warning">
        <strong>注意:</strong> <code>fail_on_threshold</code> は PR を failure
        にできます。最初から有効にする場合は <code>critical</code> など高い severity
        から始めてください。
      </Alert>
    </Stack>
  );
}

function getScanveilConfigExample(): string {
  return `# yaml-language-server: $schema=https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json
version: 1
checks:
  conclusionMode: advisory
  failThreshold:
    osv: critical
    llm: critical
scan:
  llm:
    enabled: true
    scope: pr_diff
    excludePaths:
      - "dist/**"
      - "vendor/**"
    agent:
      timeoutSeconds: 900
      skills:
        enabled: true
      plugins:
        enabled: false
      mcp:
        enabled: false
  osv:
    enabled: true
    scope: changed_lockfiles
    lockfileGlobs:
      - "**/pnpm-lock.yaml"
      - "**/package-lock.json"
      - "**/yarn.lock"
      - "**/bun.lock"
      - "**/bun.lockb"
      - "**/Cargo.lock"
      - "**/go.sum"
      - "**/requirements*.txt"
      - "**/poetry.lock"
      - "**/Pipfile.lock"
      - "**/uv.lock"
      - "**/composer.lock"
      - "**/Gemfile.lock"
suppression:
  enabled: true
  similarityThreshold: 0.70
  maxNearestNeighbors: 10
schedule:
  enabled: true`;
}

function getConfigurationFields(): Array<{
  defaultValue: ReactNode;
  meaning: ReactNode;
  name: string;
}> {
  return [
    {
      name: "version",
      defaultValue: <code>1</code>,
      meaning: (
        <>
          設定ファイル形式のバージョンです。現在は <code>1</code> のみ対応します。
        </>
      ),
    },
    {
      name: "checks.conclusionMode",
      defaultValue: <code>advisory</code>,
      meaning: (
        <>
          <code>advisory</code> は PR をブロックしません。<code>fail_on_threshold</code> は
          threshold 以上の finding で Check を failure にします。
        </>
      ),
    },
    {
      name: "checks.failThreshold.osv",
      defaultValue: <code>critical</code>,
      meaning: "OSV finding が Check を failure にする最小 severity です。",
    },
    {
      name: "checks.failThreshold.llm",
      defaultValue: <code>critical</code>,
      meaning: "LLM finding が Check を failure にする最小 severity です。",
    },
    {
      name: "scan.llm.enabled",
      defaultValue: <code>true</code>,
      meaning:
        "PR scan の diff review と repository-wide Scan の source snapshot review を有効化します。",
    },
    {
      name: "scan.llm.excludePaths",
      defaultValue: (
        <>
          <code>dist/**</code>, <code>vendor/**</code>
        </>
      ),
      meaning: "LLM review から除外する path glob です。",
    },
    {
      name: "scan.llm.agent.timeoutSeconds",
      defaultValue: <code>900</code>,
      meaning: (
        <>
          LLM agent のアプリケーションレベル timeout です。最大 <code>1800</code> 秒です。
        </>
      ),
    },
    {
      name: "scan.llm.agent.skills/plugins/mcp",
      defaultValue: <code>skills: true, plugins: false, mcp: false</code>,
      meaning:
        "Agy runner が監査用の .scanveil/skills、.scanveil/plugins、.scanveil/mcp を読むかを制御します。",
    },
    {
      name: "scan.osv.enabled",
      defaultValue: <code>true</code>,
      meaning: "依存関係 lockfile を使った OSV scan を有効化します。",
    },
    {
      name: "scan.osv.lockfileGlobs",
      defaultValue: "主要 package manager の lockfile",
      meaning: "OSV scan 対象として扱う lockfile path の glob です。",
    },
    {
      name: "suppression.enabled",
      defaultValue: <code>true</code>,
      meaning: "過去 finding との類似度に基づく重複抑制を有効化します。",
    },
    {
      name: "suppression.similarityThreshold",
      defaultValue: <code>0.70</code>,
      meaning: (
        <>
          重複扱いにする最小 similarity です。<code>0</code> から <code>1</code> の範囲です。
        </>
      ),
    },
    {
      name: "suppression.maxNearestNeighbors",
      defaultValue: <code>10</code>,
      meaning: "類似 finding 探索で参照する近傍件数です。",
    },
    {
      name: "schedule.enabled",
      defaultValue: <code>true</code>,
      meaning:
        "定期実行される scheduled Scan の対象にするかを制御します。false にするとこの repository の scheduled Scan をスキップします。PR scan と manual scan には影響しません。",
    },
  ];
}
