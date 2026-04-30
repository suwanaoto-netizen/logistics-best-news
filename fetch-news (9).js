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
web_searchツールを使って、日本の物流・運送・荷主に関する最新ニュースを検索し、5件ピックアップしてください。
できる限り${dateJP}から遡って24時間以内に公開されたニュースを優先してください。24時間以内のニュースが5件に満たない場合は、直近の最新ニュースで補完して必ず5件返してください。

【検索キーワード例】
・「物流 AI プレスリリース ${dateJP}」
・「物流 DX ニュース 最新」
・「運送 法改正 ${dateJP}」

【優先順位】
1. 最優先：物流AIサービスや物流ソフトウェアのプレスリリース（新製品発表・機能追加・導入事例・資金調達など）
2. 次点：物流テクノロジー・DX全般
3. 次点：規制・法改正
4. その他：ドライバー・人材、M&A・企業動向、物流全般

【絶対ルール】
- 返答はJSON配列のみ。説明文・前置き・コメントは一切不要。
- 検索結果が少なくても、直近の物流ニュースで補完して必ず5件のJSON配列を返すこと。
- バッククォート3つやjsonタグは不要。[ で始まり ] で終わる配列のみを返すこと。
- 「確認できませんでした」などの説明文を返すことは禁止。必ずJSON配列を返すこと。

[{"headline":"見出し30文字以内","summary":"2〜3文の要約。具体的数字・企業名を含む","category":"dx|reg|driver|ma|general","source":"メディア名","hours_ago":"N時間前 または 本日","url":"記事の元URL"}]`;

  const messages = [{ role: 'user', content: prompt }];

  // ===== ループ: tool_useが続く限り検索結果を渡し続ける =====
  const MAX_LOOPS = 5; // 無限ループ防止
  for (let loopCount = 1; loopCount <= MAX_LOOPS; loopCount++) {
    console.log(`[LogisticsBestNews] API呼び出し #${loopCount}`);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages
      })
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    console.log(`[LogisticsBestNews] stop_reason: ${data.stop_reason}`);

    // assistantの返答をmessages履歴に追加
    messages.push({ role: 'assistant', content: data.content });

    // end_turn: 最終回答
    if (data.stop_reason === 'end_turn') {
      return extractJSON(data.content);
    }

    // tool_use: web_searchリクエストが来たので結果を返す
    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');

      const toolResults = toolUseBlocks.map(b => {
        console.log(`[LogisticsBestNews] web_search実行: "${b.input?.query || ''}"`);

        // web_search_20250305はAnthropicサーバー側で実行される。
        // contentブロック内のweb_search_resultブロックに結果が含まれる。
        const searchResultBlock = data.content.find(
          block => block.type === 'web_search_result'
        );

        let resultText;
        if (searchResultBlock && Array.isArray(searchResultBlock.content)) {
          resultText = searchResultBlock.content
            .map(r => [
              `■ ${r.title || ''}`,
              `URL: ${r.url || ''}`,
              r.page_age ? `公開日時: ${r.page_age}` : '',
              r.encrypted_content ? '' : (r.content || '')
            ].filter(Boolean).join('\n'))
            .join('\n\n');
          console.log(`[LogisticsBestNews] 検索結果取得: ${searchResultBlock.content.length}件`);
        } else {
          resultText = '検索を実行しました。得られた情報をもとに最新の物流ニュースをまとめてください。';
          console.log(`[LogisticsBestNews] 検索結果ブロックなし、フォールバック使用`);
        }

        return {
          type: 'tool_result',
          tool_use_id: b.id,
          content: resultText
        };
      });

      // tool_resultを履歴に追加して次のループへ
      messages.push({ role: 'user', content: toolResults });

      // ===== 最終ターン強制指示 =====
      // tool_result返却後にClaudeが説明文を返さないよう追加指示
      messages.push({
        role: 'user',
        content: '以上の検索結果をもとに、今すぐJSON配列のみを返してください。説明文は不要です。[ で始まる配列のみを返してください。'
      });

      continue;
    }

    throw new Error(`Unexpected stop_reason: ${data.stop_reason}`);
  }

  throw new Error('MAX_LOOPS exceeded');
}

function extractJSON(contentBlocks) {
  const allText = contentBlocks
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  console.log(`[LogisticsBestNews] レスポンス全文:\n${allText}`);

  const clean = allText.replace(/```json|```/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array found. Response was: ${allText.slice(0, 500)}`);

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
