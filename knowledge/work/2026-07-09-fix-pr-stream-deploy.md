# 2026-07-09 Fix PR 可視化から Dockerfile SVE 解決までの一日

発端: `https://console.scanveil.kexi.dev/fix-prs/fix-39034922-…` が "Fix proposal did not change the source file" で失敗し、原因が全く追えなかった。可視化 → 根本原因修正 → パイプライン改善 → 実際の SVE 2件を fix PR で解決、まで一日で一巡した記録。

## マージした PR(すべて squash、時系列)

| PR  | 内容                                                                                         | 根本原因/学び                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #50 | fix PR エージェント出力のリアルタイムストリーミング+提案(title/body)の永続化・エラーへの反映 | Python 側は既に `agy_stream_chunk` を吐いており、worker が `onStreamChunk` を渡していないだけだった。スキャン用の Firestore→SSE→`LlmStreamPanel` パイプラインをミラー(`fixPrStreamChunks` コレクション、`/api/fix-prs/{id}/stream`・`/llm-output`)                                                                                                                                                                                                                                        |
| #51 | console e2e 修正                                                                             | #50 が CI 完了前に auto-merge され main が赤に(required check 未設定)。SVE ページの fix PR モデル選択ダイアログ追加で e2e フローが変わっていた+e2e fixture に `listFixPrStreamChunks` スタブが必要                                                                                                                                                                                                                                                                                        |
| #52 | リポジトリスキャンのスナップショット切断を行境界+明示マーカーに                              | **本丸**。`SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES`(20,000)でファイルをトークン途中で切断し完全なファイルとして LLM に渡していたため、切断点を「構文エラー」として finding 化(SVE-202607-CE8854E5-745FC7CF、runner.py 23,619 bytes が `if has_conten` で切断)。fix agent は完全なファイルを受け取るので直すものがなく unchanged で正しく拒否されていた。`\ scanveil: file truncated for review` マーカー+両スキャナのプロンプト指示で解決。デプロイ後の manual scan で再報告なしを確認 |
| #53 | stream chunks の 30日 TTL                                                                    | `expireAt = timestamp + 30d` を worker が書き、Terraform `google_firestore_field` の `ttl_config` を両コレクションに設定(TTL はフィールド値が過去になった時点で削除するので、書き込み時刻そのものには張れない)。既存 37 docs は REST でバックフィル。完成済み出力は GCS にあるので損失なし                                                                                                                                                                                                |
| #54 | 「修正不要」fix proposal の受理                                                              | fix agent が truncation artifact の stale finding を正しく false positive と判断し `files: []` を返したが、スキーマが 1 file 必須で opaque な schema error に。空 files を許可し、`Fix agent determined no code change is required. Agent proposal "…": …` として理由付きで失敗させる。プロンプトにも false positive 時は空 files で返すよう明示                                                                                                                                          |
| #56 | Dockerfile: ベースイメージの digest ピン(SVE-…-31F8BD5F)                                     | **エージェント提案の digest はハルシネーション**(Docker Hub に存在しない)。実物 `nixos/nix:2.34.5@sha256:4e211f67…` に差し替え、Cloud Build で実ビルド検証してからマージ                                                                                                                                                                                                                                                                                                                  |
| #55 | Dockerfile: スモークテスト強化(SVE-…-B54298D5)                                               | **エージェントの `exit 0` 強制は検証ビルドで実際に失敗**(`localharness --help` は Go flag 仕様で非ゼロ終了)。126/127 拒否維持+usage バナー `grep` に修正(run.py スモークの marker パターンと同型)して再検証後マージ                                                                                                                                                                                                                                                                       |

## インフラ変更(Terraform、ローカル state、CLI vars — OAuth client ID は state / GitHub App 設定を参照)

- `scanveilRunOperationsReader` カスタムロール(`run.operations.get` のみ)をプロジェクトレベルで `web_runtime` にバインド。job スコープの `scanveilWorkerJobOverrideRunner` は location スコープの Operation に効かず、`fix_pr_run_reconciliation_failed` 403 が 3.5 秒毎に出ていた。フルロールのプロジェクト付与は `run.jobs.runWithOverrides` が広すぎるため最小ロールを新設
- Firestore composite index `fixPrStreamChunks (fixId ASC, sequence ASC)`(`firebase deploy --only firestore:indexes`)
- Firestore TTL: `scanStreamChunks.expireAt` / `fixPrStreamChunks.expireAt`(作成に ~6分)
- GitHub ruleset `main`(id 17981951)に required status check `test` を追加。**admin (`gh pr merge --admin`) でもバイパス不可**(bypass_actors 空)を #53 で実地確認

## 最終デプロイ状態(Cloud Run、digest ピン)

- web: `scanveil-web@sha256:d78986a7…`(revision `scanveil-web-00056-qpj`)
- worker: `scanveil-worker@sha256:aa9dded2…`(TTL 書き込み+no-change proposal 対応込み)
- agy-runner: `scanveil-agy-runner@sha256:604d38da…`(プロンプト修正+Dockerfile 修正済みベースで実ビルド)
- api: 変更なし(`sha256:1474e9a2…`)

## 検証(manual scan は Cloud Run job override `SCAN_REQUEST_JSON` で直接投入)

1. `manual-91102694`: #52 デプロイ後 — truncation false positive 再報告なし
2. `manual-1343ccd2`: TTL 検証 — chunk に `expireAt`(+30日ちょうど)付与を確認。Dockerfile finding 2件が新規報告 → fix PR 対象に
3. fix PR 実行 2件(`FIX_PR_REQUEST_JSON` override、queued レコードを console と同手順で先行作成)→ PR #55/#56 生成
4. `manual-36aa8764`: 修正後 main — **SVE 2件とも再報告なし = resolved**。残る 1 finding は suppression が旧 finding 類似として自動抑止(`suppressedById` 付き)

## 学び / 運用メモ

- **fix PR エージェントの提案は「もっともらしいが検証必須」**: 2件中2件に欠陥(存在しない digest、ビルドを壊す厳格化)。draft PR 設計は正しい。マージ前に Cloud Build での実ビルド検証が有効
- gitleaks pre-commit は `--all` refs を走査するので、リークを含むコミットは remote ブランチからも消さないと以後のコミットが全部落ちる。deploy note に OAuth client ID を書かない
- `git reset --hard` の前に `git status` — 未 add のファイル(fix-prs.test.ts)を一度飛ばした
- zsh では monitor スクリプトの変数名 `status` が read-only で死ぬ
- manual scan / fix PR は console を経由せず Cloud Run job override + Firestore 直書きで投入できる(このファイルの検証手順参照)

## 残タスク

- 特になし(TTL 宿題まで完了)。次の定期スキャンで SVE 一覧の resolved 表示を目視確認する程度
