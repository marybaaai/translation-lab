/* =====================================================================
   Translation Lab（翻訳選択実験）— Google Apps Script
   作品「それ、本当にあなたが訳したんですか？」の
   ・AI生成（訳A・B、コメントと訳C）
   ・体験記録の保存（記録に同意した来場者のみ）と集計
   を受け持ちます。このファイルの内容をすべて Apps Script のエディタに貼り付けてください。

   スクリプト プロパティ（プロジェクトの設定 → スクリプト プロパティ）
     ANTHROPIC_API_KEY      必須（AIを使う場合）。Anthropic の API キー
     ANTHROPIC_MODEL        任意。既定は claude-sonnet-5-5（安くするなら claude-haiku-5-5）
     RATE_LIMIT_PER_10MIN   任意。10分間に受け付けるAI生成の回数（全体で。既定 120）
   ===================================================================== */

const SHEET_ID = "1Ygpg2D938iKNx5SWtpOemg6rJGfACA048sdbc6fBu90";
const APP_KEY = "tlab-bO-iF2S5pN_FhNGBhThrTz8W";            // 体験ページ（HTML）と同じ値。変えるときは両方変える
const RECORD_SHEET = "記録";
const SUMMARY_SHEET = "集計";
const VERSION = "2026-11-26";

// 記録シートの列（左から順に）。[記録のキー, 見出し]
const COLUMNS = [
  ["id", "体験ID（匿名）"],
  ["receivedAt", "受信日時"],
  ["startedAt", "開始時刻"],
  ["finishedAt", "完了時刻"],
  ["durationSec", "所要時間（秒）"],
  ["direction", "翻訳の方向"],
  ["level", "難易度"],
  ["source", "原文"],
  ["comprehension", "AIの訳を見る前の理解度"],
  ["methodFirst", "最初に選んだ方法"],
  ["methodChanges", "方法の切り替え"],
  ["firstSubmission", "最初に提出した翻訳"],
  ["afterFeedback", "コメントと訳Cを見た後"],
  ["final", "最終的な翻訳"],
  ["selfScore", "自己評価（%）"],
  ["commonPct", "AI案と共通する表現（%）"],
  ["otherPct", "共通しない表現（%）"],
  ["pctA", "訳Aと共通（%）"],
  ["pctB", "訳Bと共通（%）"],
  ["pctC", "訳Cと共通（%）"],
  ["combined", "あなたの判断・参考値（%）"],
  ["matchRule", "一致の判定基準"],
  ["transA", "訳A"],
  ["transB", "訳B"],
  ["transC", "訳C"],
  ["fbGood", "コメント：良いところ"],
  ["fbGap", "コメント：原文とのずれ"],
  ["fbNatural", "コメント：自然さ"],
  ["aiMode", "訳案の生成"]
];

/* ---------- 入口 ---------- */
function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  return json_({ ok: true, configured: !!key, version: VERSION });
}

function doPost(e) {
  let b = null;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: { code: "bad_request" } }); }
  if (!b || b.key !== APP_KEY) return json_({ error: { code: "forbidden" } });
  try {
    if (b.action === "record") return json_(saveRecord_(b.record));
    if (b.action === "ai") return json_(generate_(b));
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ error: { code: "upstream_error" } });
  }
  return json_({ error: { code: "bad_request" } });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- AI 生成 ---------- */
const MAX_LEN = { source: 600, translation: 1500 };

function text_(v, max) { return typeof v === "string" && v.trim() && v.length <= max ? v : null; }

function generate_(b) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return { error: { code: "not_configured" } };
  if (b.task !== "ab" && b.task !== "feedback") return { error: { code: "bad_request" } };

  const P = TLAB_PROMPTS;
  const data = {
    from: P.LANGS.indexOf(b.from) >= 0 ? b.from : null,
    to: P.LANGS.indexOf(b.to) >= 0 ? b.to : null,
    kind: P.KINDS.indexOf(b.kind) >= 0 ? b.kind : null,
    source: text_(b.source, MAX_LEN.source)
  };
  if (b.task === "feedback") {
    data.a = text_(b.a, MAX_LEN.translation);
    data.b = text_(b.b, MAX_LEN.translation);
    data.mine = text_(b.mine, MAX_LEN.translation);
  }
  if (Object.keys(data).some(function (k) { return !data[k]; }) || data.from === data.to) return { error: { code: "bad_request" } };

  // 10分ごとの回数制限（全体で数える）
  const limit = parseInt(props.getProperty("RATE_LIMIT_PER_10MIN") || "120", 10);
  const cache = CacheService.getScriptCache();
  const slot = "ai-" + Math.floor(Date.now() / 600000);
  const used = parseInt(cache.get(slot) || "0", 10);
  if (used >= limit) return { error: { code: "rate_limited" } };
  cache.put(slot, String(used + 1), 700);

  const prompt = b.task === "ab" ? P.ab(data) : P.feedback(data);
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({
      model: props.getProperty("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }]
    }),
    muteHttpExceptions: true
  });
  const status = res.getResponseCode();
  if (status !== 200) {
    console.error("Anthropic API error " + status + ": " + res.getContentText().slice(0, 500));
    if (status === 429 || status === 529) return { error: { code: "rate_limited" } };
    if (status === 401 || status === 403) return { error: { code: "not_configured" } };
    return { error: { code: "upstream_error" } };
  }
  const j = JSON.parse(res.getContentText());
  const out = (j.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("");
  const result = P.check(b.task, parseJSON_(out));
  return result ? { result: result } : { error: { code: "invalid_json" } };
}

function parseJSON_(t) {
  try { return JSON.parse(t); } catch (e) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
  return null;
}

/* ---------- 体験記録 ---------- */
// 表計算の数式として解釈されないようにする（来場者の入力をそのまま文字として残す）
function cell_(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return isFinite(v) ? v : "";
  let s = String(v).slice(0, 5000);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function recordSheet_(ss) {
  let sh = ss.getSheetByName(RECORD_SHEET);
  if (!sh) {
    const first = ss.getSheets()[0];
    // 最初のシートが空なら、それを記録シートとして使う
    if (first && first.getLastRow() === 0 && first.getLastColumn() <= 1 && ss.getSheets().length === 1) { sh = first; sh.setName(RECORD_SHEET); }
    else sh = ss.insertSheet(RECORD_SHEET, 0);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return c[1]; })]).setFontWeight("bold").setBackground("#fbe683");
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveRecord_(r) {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(r.id)) return { error: { code: "bad_request" } };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = recordSheet_(ss);
    const rec = Object.assign({}, r, { receivedAt: Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss") });
    const row = COLUMNS.map(function (c) { return cell_(rec[c[0]]); });
    // 同じ体験IDがすでにあれば上書き（送り直しや、レポートからもどって評価し直した場合）
    let target = 0;
    if (sh.getLastRow() > 1) {
      const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(r.id).matchEntireCell(true).findNext();
      if (found) target = found.getRow();
    }
    if (target) sh.getRange(target, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    ensureSummary_(ss);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 集計シート（初回に自動で作成。数式なので、記録が増えると自動で更新されます） ---------- */
function col_(key) {
  const i = COLUMNS.map(function (c) { return c[0]; }).indexOf(key);
  let n = i + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return "'" + RECORD_SHEET + "'!" + s + "2:" + s;
}

function ensureSummary_(ss) {
  if (ss.getSheetByName(SUMMARY_SHEET)) return;
  const sh = ss.insertSheet(SUMMARY_SHEET);
  const ID = col_("id");
  const rows = [
    ["集計（記録に同意した来場者のみ）", "人数", "割合"],
    ["体験した人数", "=COUNTA(" + ID + ")", ""],
    ["", "", ""],
    ["翻訳の方向", "", ""],
    ["日本語 → 英語", "=COUNTIF(" + col_("direction") + ",A5)", "=IFERROR(B5/$B$2,0)"],
    ["英語 → 日本語", "=COUNTIF(" + col_("direction") + ",A6)", "=IFERROR(B6/$B$2,0)"],
    ["", "", ""],
    ["難易度", "", ""],
    ["Level 1", "=COUNTIF(" + col_("level") + ",A9&\"*\")", "=IFERROR(B9/$B$2,0)"],
    ["Level 2", "=COUNTIF(" + col_("level") + ",A10&\"*\")", "=IFERROR(B10/$B$2,0)"],
    ["Level 3", "=COUNTIF(" + col_("level") + ",A11&\"*\")", "=IFERROR(B11/$B$2,0)"],
    ["", "", ""],
    ["AIの訳を見る前の理解度", "", ""],
    ["自分で訳せそう", "=COUNTIF(" + col_("comprehension") + ",A14)", "=IFERROR(B14/$B$2,0)"],
    ["少し迷う", "=COUNTIF(" + col_("comprehension") + ",A15)", "=IFERROR(B15/$B$2,0)"],
    ["まったく分からない", "=COUNTIF(" + col_("comprehension") + ",A16)", "=IFERROR(B16/$B$2,0)"],
    ["", "", ""],
    ["最初に選んだ方法", "", ""],
    ["訳Aを修正する", "=COUNTIF(" + col_("methodFirst") + ",A19)", "=IFERROR(B19/$B$2,0)"],
    ["訳Bを修正する", "=COUNTIF(" + col_("methodFirst") + ",A20)", "=IFERROR(B20/$B$2,0)"],
    ["どちらも使わず、自分で翻訳を書く", "=COUNTIF(" + col_("methodFirst") + ",A21)", "=IFERROR(B21/$B$2,0)"],
    ["", "", ""],
    ["コメントと訳Cを見た後", "", ""],
    ["修正した", "=COUNTIF(" + col_("afterFeedback") + ",A24)", "=IFERROR(B24/$B$2,0)"],
    ["修正せずに完成した", "=COUNTIF(" + col_("afterFeedback") + ",A25)", "=IFERROR(B25/$B$2,0)"],
    ["修正画面を開いたが、変更せずに完成した", "=COUNTIF(" + col_("afterFeedback") + ",A26)", "=IFERROR(B26/$B$2,0)"],
    ["", "", ""],
    ["平均値", "平均（%）", ""],
    ["自己評価", "=IFERROR(AVERAGE(" + col_("selfScore") + "),\"—\")", ""],
    ["AI案と共通しない表現", "=IFERROR(AVERAGE(" + col_("otherPct") + "),\"—\")", ""],
    ["あなたの判断・参考値", "=IFERROR(AVERAGE(" + col_("combined") + "),\"—\")", ""],
    ["所要時間（秒）", "=IFERROR(AVERAGE(" + col_("durationSec") + "),\"—\")", ""]
  ];
  rows.forEach(function (r, i) {
    r.forEach(function (v, k) {
      const cell = sh.getRange(i + 1, k + 1);
      if (typeof v === "string" && v.charAt(0) === "=") cell.setFormula(v); else cell.setValue(v);
    });
  });
  sh.getRange("C2:C32").setNumberFormat("0.0%");
  sh.getRange("B29:B32").setNumberFormat("0.0");
  [1, 4, 8, 13, 18, 23, 28].forEach(function (r) { sh.getRange(r, 1, 1, 3).setFontWeight("bold").setBackground("#d9e6f7"); });
  sh.setColumnWidth(1, 300);
}

/* 初期設定用：エディタでこの関数を一度実行すると、記録シートと集計シートを作り、権限の確認を済ませられます */
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  recordSheet_(ss);
  ensureSummary_(ss);
  UrlFetchApp.fetch("https://api.anthropic.com", { muteHttpExceptions: true });
}

/* ---------- AIへの指示文（体験ページの prompts.js と同じ内容） ---------- */
/* Translation Lab — AIへの指示文（プロンプト）
   ブラウザ（claude.ai 版・独立版）とサーバー（api/generate.js）の両方がこのファイルを使います。
   指示文を変えるときは、ここだけを書き換えてください。 */
(function (root) {
  "use strict";
  var LANGS = ["日本語", "英語"];
  var KINDS = ["sentence", "poem"];

  function ab(p) {
    var poem = p.kind === "poem";
    return "あなたは" + p.from + "から" + p.to + "への翻訳者です。次の" + p.from + "の原文を" + p.to + "に訳し、2つの訳案を作ってください。\n" +
      "- a：原文の語順や語の選び方に比較的忠実な訳。\n" +
      "- b：" + p.to + "として自然に読めることを重視した訳。\n" +
      "2つは同じくらいの完成度にし、どちらかが明らかに優れて見える差をつけないこと。説明や注釈は書かないこと。\n" +
      (poem ? "原文は短い詩（俳句など）です。行の区切りは改行（\\n）で表してください。\n" : "") +
      "出力は次の形のJSONだけにしてください。前後に説明やコードブロックを付けないこと：{\"a\": \"訳A\", \"b\": \"訳B\"}\n\n" +
      "原文：\n\"\"\"\n" + p.source + "\n\"\"\"";
  }

  function feedback(p) {
    var poem = p.kind === "poem";
    return "あなたは翻訳ワークショップの進行役です。展示会場の来場者が、" + p.from + "の原文を" + p.to + "に訳しました。来場者は、AIの訳案Aと訳案Bを参考にできる状態で訳しています。\n" +
      "来場者の訳に対する短いフィードバックを日本語で、新しい訳案Cを" + p.to + "で作ってください。\n\n" +
      "ルール：\n" +
      "- 点数・正誤判定・優劣の断定をしない。来場者の判断を否定しない。「〜という読み方もできます」「〜にすると、〜かもしれません」のような、提案の形で書く。\n" +
      "- good：この表現の良いところ（1〜2文、70字以内）\n" +
      "- gap：原文と少しずれているかもしれないところ（1〜2文、70字以内）。目立ったずれがなければ、そう伝えてよい。\n" +
      "- natural：もう少し自然にできるかもしれないところ（1〜2文、70字以内）\n" +
      "- c：原文から新しく" + p.to + "に訳した訳案C。訳A・訳B・来場者の訳のどれとも異なる言い回しを選ぶ。来場者の訳を書き直したものにはしない。説明は書かない。\n" +
      (poem ? "- 原文は短い詩（俳句など）で、複数の解釈ができます。ひとつの解釈を正解として扱わず、解釈の余地を残して書く。cの行の区切りは改行（\\n）で表す。\n" : "") +
      "出力は次の形のJSONだけにしてください。前後に説明やコードブロックを付けないこと：{\"good\": \"\", \"gap\": \"\", \"natural\": \"\", \"c\": \"\"}\n\n" +
      "原文：\n\"\"\"\n" + p.source + "\n\"\"\"\n" +
      "訳A：\n\"\"\"\n" + p.a + "\n\"\"\"\n" +
      "訳B：\n\"\"\"\n" + p.b + "\n\"\"\"\n" +
      "来場者の訳：\n\"\"\"\n" + p.mine + "\n\"\"\"";
  }

  function s(v) { return typeof v === "string" && v.trim() ? v.trim() : null; }
  /* 返ってきたJSONが必要な項目をそろえているか確かめる */
  function check(task, r) {
    if (task === "ab") {
      var a = s(r && r.a), b = s(r && r.b);
      return a && b ? { a: a, b: b } : null;
    }
    var o = { good: s(r && r.good), gap: s(r && r.gap), natural: s(r && r.natural), c: s(r && r.c) };
    return o.good && o.gap && o.natural && o.c ? o : null;
  }

  var api = { ab: ab, feedback: feedback, check: check, LANGS: LANGS, KINDS: KINDS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TLAB_PROMPTS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

