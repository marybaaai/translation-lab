# Translation Lab（翻訳選択実験）独立版

作品「それ、本当にあなたが訳したんですか？」の体験サイトを、claude.ai の画面を使わずに公開するためのファイル一式です。
AI の生成は、Vercel 上の小さなサーバー（`api/generate.js`）が Anthropic の API に問い合わせて行います。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 体験サイト本体。claude.ai 版と同じファイルです |
| `prompts.js` | AI への指示文。ページとサーバーの両方が使います |
| `api/generate.js` | AI 接続用のサーバー。API キーはここだけが持ちます |
| `vercel.json` | Vercel の設定（AI の待ち時間を最大60秒にする） |

API キーはどのファイルにも書きません。Vercel の「環境変数」にだけ登録します。

---

## 公開の手順

### 1. Anthropic の API キーを用意する

1. https://console.anthropic.com にアカウントを作り、支払い方法を登録します。
2. 「API Keys」で新しいキーを作成し、表示された文字列を控えます（あとから再表示できません）。
3. **利用額の上限を設定します。** Console の利用上限（Limits）の画面で、月の上限額を低めに決めておくと、万一たくさん呼ばれても費用が上限で止まります。

> 来場者1人あたり、AI への問い合わせは2回です（訳A・B の生成、コメントと訳C の生成）。

### 2. GitHub にファイルを置く

1. GitHub で新しいリポジトリを作ります（例：`translation-lab`。非公開で構いません）。
2. このフォルダの中身（`index.html`、`prompts.js`、`api` フォルダ、`vercel.json`、`package.json`、`README.md`、`.gitignore`）をアップロードします。
   - GitHub を Claude に接続している場合は、Claude がアップロードできます。

### 3. Vercel で公開する

1. https://vercel.com に GitHub アカウントでログインします。
2. 「Add New… → Project」から、手順2のリポジトリを選びます。
3. Framework Preset は **Other** のままにします。ビルドの設定は不要です。
4. 「Environment Variables」に次を登録します。

   | 名前 | 値 |
   |---|---|
   | `ANTHROPIC_API_KEY` | 手順1で作った API キー |

5. 「Deploy」を押します。1分ほどで `https://（プロジェクト名）.vercel.app` のような URL ができます。

### 4. 動作を確認する

- サイトを開き、右上の表示が **「AI接続：あり」** になっていれば完了です。
- **「試用モード」** と表示される場合は、`https://（あなたのURL）/api/generate` を開いてください。
  - `{"ok":true,"configured":false}` → API キーが登録されていません。環境変数を登録し、Vercel で **Redeploy** してください。
  - ページが見つからない → `api` フォルダごとアップロードされているか確かめてください。

---

## 内容を変更したとき

GitHub のファイルが更新されると、Vercel が自動で公開し直します（1分ほど）。URL は変わりません。
すでに開いているページは、再読み込みすると新しい内容になります。

- 原文・文言・一致の判定基準：`index.html` の冒頭にある `CONFIG`
- AI への指示文：`prompts.js`
- 会場での設定（一致の最小文字数・語数、試用モードへの固定）：画面で **Ctrl + Alt + S**

## 任意の環境変数

| 名前 | 既定値 | 内容 |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | 使う AI モデル。速さを優先するなら `claude-haiku-5-5` |
| `RATE_LIMIT_PER_10MIN` | `40` | 同じ接続元から10分間に受け付ける回数の目安 |
| `ALLOWED_ORIGIN` | なし | 別のドメインに置いたページから使う場合だけ、そのURL |

変更後は Vercel で Redeploy すると反映されます。

## 安全のためのしくみ

- API キーはサーバーだけが持ち、ページには一切含まれません。
- AI への指示文はサーバーで組み立てます。ページから受け取るのは原文と訳文だけで、長さにも上限があります。
- 同じサイトのページ以外からの呼び出しは受け付けません。
- 回数制限は目安です。費用の確実な上限は、Anthropic Console の利用上限で設定してください。

## その他

- 印刷：独立版では「レポートを印刷する」を押すと、A6（105 × 148 mm）のカードの印刷画面がその場で開きます。プリンターの用紙設定を A6 にしてください。
- AI に接続できないときは、自動で「試用モード」（用意した例文）になります。
- claude.ai 版（https://claude.ai/artifact/KNihStQFpqJ8RwNi7oMcfp）も、同じ `index.html` と `prompts.js` で動いています。
