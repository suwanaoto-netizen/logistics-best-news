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
${dateJP}の日本の物流・運送・荷主に関する最新ニュースを5件ピックアップしてください。
特に「物流テクノロジー・DX」「規制・法改正」を優先してください。

JSONのみで返答。前置き不要、\`\`\`も不要。

[{"headline":"見出し30文字以内","summary":"2〜3文の要約。具体的数字・企業名を含む","category":"dx|reg|driver|ma|general","source":"メディア名","hours_ago":"N時間前 または 本日"}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const tb = data.content.find(b => b.type === 'text');
  if (!tb) throw new Error('No text block in response');

  const raw = tb.text.replace(/```json|```/g, '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found');

  return JSON.parse(match[0]);
}

async function saveToSupabase(rows) {
  // 当日分を削除してから再INSERT（冪等性）
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

    await saveToSupabase(rows);
    console.log(`[LogisticsBestNews] Supabaseに保存完了 (${dateStr})`);
  } catch (e) {
    console.error('[LogisticsBestNews] エラー:', e.message);
    process.exit(1);
  }
})();
