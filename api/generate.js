/* Translation Lab — AI接続用のサーバー（Vercel の Serverless Function）
   ・APIキーはこのサーバーだけが持ちます（Vercel の環境変数 ANTHROPIC_API_KEY）。ブラウザには送りません。
   ・AIへの指示文はサーバー側で prompts.js から組み立てます。ブラウザからは原文・訳文などの材料だけを受け取ります。

   環境変数
     ANTHROPIC_API_KEY      必須。Anthropic のAPIキー
     ANTHROPIC_MODEL        任意。使うモデル（既定：claude-sonnet-5-5）
     RATE_LIMIT_PER_10MIN   任意。同じ接続元から10分間に受け付ける回数（既定：40）
     ALLOWED_ORIGIN         任意。別のドメインから使う場合のみ、そのURL（例：https://example.com）
*/
const P = require("../prompts.js");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const LIMIT = parseInt(process.env.RATE_LIMIT_PER_10MIN || "40", 10);
const MAX = { source: 600, translation: 1500 };

// 簡易的な回数制限（サーバーの1台ごとに数える目安。確実な上限は Anthropic Console の利用上限で設定する）
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function text(v, max) { return typeof v === "string" && v.trim() && v.length <= max ? v : null; }

function parseJSON(t) {
  try { return JSON.parse(t); } catch (e) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
  return null;
}

function fail(res, status, code) { res.status(status).json({ error: { code } }); }

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.ANTHROPIC_API_KEY;

  // 接続確認（ページが最初に呼ぶ）
  if (req.method === "GET") return res.status(200).json({ ok: true, configured: !!key });
  if (req.method !== "POST") return fail(res, 405, "method_not_allowed");
  if (!key) return fail(res, 503, "not_configured");
  if (!sameOrigin(req)) return fail(res, 403, "forbidden");

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return fail(res, 429, "rate_limited");

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || (b.task !== "ab" && b.task !== "feedback")) return fail(res, 400, "bad_request");

  const data = {
    from: P.LANGS.includes(b.from) ? b.from : null,
    to: P.LANGS.includes(b.to) ? b.to : null,
    kind: P.KINDS.includes(b.kind) ? b.kind : null,
    source: text(b.source, MAX.source)
  };
  if (b.task === "feedback") {
    data.a = text(b.a, MAX.translation);
    data.b = text(b.b, MAX.translation);
    data.mine = text(b.mine, MAX.translation);
  }
  if (Object.values(data).some(v => !v) || data.from === data.to) return fail(res, 400, "bad_request");

  const prompt = b.task === "ab" ? P.ab(data) : P.feedback(data);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Anthropic API error", r.status, detail.slice(0, 500));
      if (r.status === 429 || r.status === 529) return fail(res, 429, "rate_limited");
      if (r.status === 401 || r.status === 403) return fail(res, 503, "not_configured");
      return fail(res, 502, "upstream_error");
    }
    const j = await r.json();
    const out = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const result = P.check(b.task, parseJSON(out));
    if (!result) return fail(res, 502, "invalid_json");
    return res.status(200).json({ result });
  } catch (e) {
    console.error("generate failed", e && e.name, e && e.message);
    return fail(res, 502, "upstream_error");
  } finally {
    clearTimeout(timer);
  }
};
