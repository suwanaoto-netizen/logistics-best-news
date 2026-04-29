# LogisticsBestNews

物流・運送業界の最新ニュースを毎朝8時半に自動取得してDBに蓄積するWebアプリです。

## 技術スタック

- **フロントエンド**: Next.js 14 (App Router) + TypeScript
- **スタイル**: CSS Modules（Stripe風 グリーン/白/グレー）
- **DB**: Supabase (PostgreSQL)
- **ホスティング**: Vercel
- **自動取得**: Vercel Cron Jobs（毎朝8:30 JST）
- **ニュース取得**: Anthropic API + Web Search

---

## デプロイ手順

### Step 1 — Supabase プロジェクトを作成

1. https://supabase.com にアクセスし、無料アカウントを作成
2. 「New project」でプロジェクトを作成
3. 「SQL Editor」を開き、`supabase_schema.sql` の内容を全部貼り付けて「Run」
4. 「Project Settings > API」から以下の値をコピーしておく：
   - `Project URL`（例: https://abcdef.supabase.co）
   - `anon public` キー
   - `service_role` キー（シークレット）

### Step 2 — Anthropic API キーを取得

1. https://console.anthropic.com にアクセス
2. 「API Keys」から新しいキーを発行

### Step 3 — GitHubにプッシュ

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create logistics-best-news --public --push
```

### Step 4 — Vercel にデプロイ

1. https://vercel.com にアクセスし、GitHubアカウントでログイン
2. 「New Project」→ 上記リポジトリを選択
3. 「Environment Variables」に以下を設定：

| 変数名 | 値 |
|--------|-----|
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー |
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのProject URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseのanon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice_role key |
| `CRON_SECRET` | 任意のランダム文字列（例: openssl rand -hex 32 で生成） |

4. 「Deploy」をクリック

### Step 5 — Vercel Cron の確認

デプロイ完了後、Vercelダッシュボードの「Settings > Cron Jobs」に
`/api/cron/fetch-news`（毎日 23:30 UTC = 8:30 JST）が表示されていればOK。

### Step 6 — スマホのホーム画面に追加

- **iPhone**: Safariで開いて「共有 > ホーム画面に追加」
- **Android**: Chromeで開いて「メニュー > ホーム画面に追加」

---

## ローカル開発

```bash
# 依存パッケージのインストール
npm install

# 環境変数を設定
cp .env.local.example .env.local
# .env.local に各値を記入

# 開発サーバー起動
npm run dev
# → http://localhost:3000
```

## ファイル構成

```
logistics-best-news/
├── app/
│   ├── api/
│   │   ├── cron/fetch-news/route.ts  # Vercel Cron (毎朝自動実行)
│   │   ├── fetch-news/route.ts       # 手動取得ボタン用
│   │   ├── news/route.ts             # 一覧・検索API
│   │   └── stats/route.ts            # 統計情報API
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── NewsApp.tsx                   # メインUIコンポーネント
│   └── NewsApp.module.css
├── lib/
│   ├── fetchNews.ts                  # Anthropic API呼び出し
│   └── supabase.ts                   # Supabaseクライアント
├── public/
│   └── manifest.json                 # PWA設定
├── supabase_schema.sql               # DBスキーマ（Supabaseで実行）
├── vercel.json                       # Cron設定
└── .env.local.example
```
