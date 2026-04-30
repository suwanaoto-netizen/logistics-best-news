// fetch-news.js
// GitHub Actions から毎朝実行されるスクリプト
import fetch from 'node-fetch';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const dateStr = jst.toISOString().slice(0, 10);
const dateJP = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;

console.log(`[LogisticsBestNews] 取得開始: ${dateJP}`);

async function fetchNews() {
  const prompt = `あなたは物流・運送業界のニュースキュレーターです。
web_searchツールを使って以下のキーワードで検索し、${dateJP}時点で24時間以内の日本の物流・運送・荷主に関する最新ニュースを5件ピックアップしてください。
24時間以内のニュースが5件に満たない場合は、直近の最新ニュースで補完して必ず5件返してください。

検索キーワード（複数回検索してください）:
- 「物流 プレスリリース ${dateJP}」
- 「物流 AI ソフトウェア 最新」
- 「運送 物流 ニュース ${dateJP}」

【優先順位】
1. 最優先：物流AIサービスや物流ソフトウェアのプレスリリース
2. 次点：物流テクノロジー・DX全般
3. 次点：規制・法改正
4. その他：ドライバー・人材、M&A・企業動向、物流全般

【絶対ルール】
返答はJSON配列のみ。説明文・前置き・コメントは一切不要。
[ で始まり ] で終わる配列のみを返すこと。

[{"headline":"見出し30文字以内","summary":"2〜3文の要約。具体的数字・企業名を含む","category":"dx|reg|driver|ma|general","source":"メディア名","hours_ago":"N時間前 または 本日","url":"記事の元URL"}]`;

  // web_search_20250305はAnthropicサーバーが自動で検索を実行する。
  // tool_useが返ってきてもこちらからtool_resultを返す必要はない。
  // betas ヘッダーで interleaved-thinking を使いつつ、
  // max_loops でClaudeが複数回検索できるようにする。

  const MAX_TURNS = 10;
  const messages = [{ role: 'user', content: prompt }];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    console.log(`[LogisticsBestNews] ターン #${turn}`);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        thinking: { type: 'enabled', budget_tokens: 2000 },
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages
      })
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    console.log(`[LogisticsBestNews] stop_reason: ${data.stop_reason}`);

    // ログ：どんなブロックが返ってきたか確認
    const blockTypes = data.content.map(b => b.type).join(', ');
    console.log(`[LogisticsBestNews] content blocks: ${blockTypes}`);

    if (data.stop_reason === 'end_turn') {
      // テキストブロックからJSONを抽出
      return extractJSON(data.content);
    }

    // tool_useの場合はassistantの返答を履歴に追加して次のターンへ
    // web_search_20250305の場合、Anthropicが検索を実行して
    // 次のターンでは検索結果が含まれた状態でClaudeが回答する
    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });

      // tool_useブロックのIDを取得してtool_resultを返す
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = toolUseBlocks.map(b => {
        console.log(`[LogisticsBestNews] tool呼び出し: ${b.name} / query: ${JSON.stringify(b.input)}`);
        // web_search_20250305の場合、空のtool_resultを返すとAnthropicが検索結果を注入する
        return {
          type: 'tool_result',
          tool_use_id: b.id,
          content: ''
        };
      });

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    throw new Error(`Unexpected stop_reason: ${data.stop_reason}`);
  }

  throw new Error('MAX_TURNS exceeded');
}

function extractJSON(contentBlocks) {
  const allText = contentBlocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  console.log(`[LogisticsBestNews] テキスト応答:\n${allText.slice(0, 500)}`);

  const clean = allText.replace(/```json|```/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array found. Response: ${allText.slice(0, 300)}`);

  return JSON.parse(match[0]);
}

async function saveToSupabase(rows) {
  await fetch(`${SUPABASE_URL}/rest/v1/news?fetched_date=eq.${dateStr}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/news`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
}

(async () => {
  try {
    const news = await fetchNews();
    console.log(`[LogisticsBestNews] ${news.length}件取得`);

    const rows = news.map(n => ({
      headline: n.headline,
      summary: n.summary,
      category: n.category,
      source: n.source,
      hours_ago: n.hours_ago,
      url: n.url || null,
      fetched_date: dateStr
    }));

    if (rows.length === 0) {
      console.warn('[LogisticsBestNews] 取得件数が0件のためDB更新をスキップします');
      process.exit(0);
    }

    await saveToSupabase(rows);
    console.log(`[LogisticsBestNews] Supabaseに保存完了 (${dateStr})`);
  } catch (e) {
    console.error('[LogisticsBestNews] エラー:', e.message);
    process.exit(1);
  }
})();
