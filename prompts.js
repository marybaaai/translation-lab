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
      (poem ? "原文は俳句です。行の区切りは改行（\\n）で表してください。\n" : "") +
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
      (poem ? "- 原文は俳句で、複数の解釈ができます。ひとつの解釈を正解として扱わず、解釈の余地を残して書く。cの行の区切りは改行（\\n）で表す。\n" : "") +
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
