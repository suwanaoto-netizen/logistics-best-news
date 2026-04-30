// fetch-news.js
// GitHub Actions から毎朝実行されるスクリプト
import fetch from 'node-fetch';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const now = new Date();
// JST変換 (UTC+9)
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const dateStr = jst.toISOString().slice(0, 10);
const dateJP = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;

console.log(`[LogisticsBestNews] 取得開始: ${dateJP}`);

async function fetchNews() {
  const prompt = `あなたは物流・運送業界のニュースキュレーターです。
日本の物流・運送・荷主に関する最新ニュースを5件ピックアップしてください。
できる限り${dateJP}から遡って24時間以内に公開されたニュースを優先してください。24時間以内のニュースが5件に満たない場合は、直近の最新ニュースで補完して必ず5件返してください。

【優先順位】
1. 最優先：物流AIサービスや物流ソフトウェアのプレスリリース（新製品発表・機能追加・導入事例・資金調達など）
2. 次点：物流テクノロジー・DX全般
3. 次点：規制・法改正
4. その他：ドライバー・人材、M&A・企業動向、物流全般

必ずJSONのみで返答。前置き不要、\`\`\`も不要。
[{"headline":"見出し30文字以内","summary":"2〜3文の要約。具体的数字・企業名を含む","category":"dx|reg|driver|ma|general","source":"メディア名","hours_ago":"N時間前 または 本日"}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  console.log(`[LogisticsBestNews] stop_reason: ${data.stop_reason}`);

  // web_search使用時はtool_useが返るので、その後のend_turnまで待つ
  if (data.stop_reason === 'tool_use') {
    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    const toolResults = toolUseBlocks.map(b => ({
      type: 'tool_result',
      tool_use_id: b.id,
      content: '検索完了'
    }));

    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: data.content },
          { role: 'user', content: toolResults }
        ]
      })
    });

    if (!res2.ok) throw new Error(`Claude API error (2nd): ${res2.status} ${await res2.text()}`);
    const data2 = await res2.json();
    return extractJSON(data2.content);
  }

  return extractJSON(data.content);
}

function extractJSON(contentBlocks) {
  const allText = contentBlocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  console.log(`[LogisticsBestNews] レスポンス先頭200文字: ${allText.slice(0, 200)}`);

  const clean = allText.replace(/```json|```/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found');

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
