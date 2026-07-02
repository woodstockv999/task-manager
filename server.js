const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3006;
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const SUGGEST_MODEL = 'claude-haiku-4-5-20251001';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function read() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); }
  catch { return { sections: [] }; }
}

function write(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// claude CLI が ~/.claude/.credentials.json に保存した OAuth トークンを使う。
// 見つからない場合は ANTHROPIC_API_KEY にフォールバックする。
function createAnthropicClient() {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const token = creds?.claudeAiOauth?.accessToken;
    const expiresAt = creds?.claudeAiOauth?.expiresAt;
    if (token) {
      const expiresAtMs = expiresAt != null ? (expiresAt < 1e11 ? expiresAt * 1000 : expiresAt) : null;
      const isExpired = expiresAtMs != null && Date.now() >= expiresAtMs;
      if (!isExpired) return new Anthropic({ authToken: token, maxRetries: 3 });
    }
  } catch {
    // ファイルなし・パースエラーは次の方法にフォールバック
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return new Anthropic({ apiKey, maxRetries: 3 });
  throw new Error('認証情報が見つかりません。claude CLI でログイン済みか、ANTHROPIC_API_KEY を確認してください。');
}

function toUserMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return '認証に失敗しました。claude login を再実行してください。';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'APIが一時的に混雑しています。しばらく待ってから再度お試しください。';
  }
  if (err instanceof Anthropic.APIError) {
    return 'AIの呼び出しに失敗しました。しばらく待って再度お試しください。';
  }
  return '予期しないエラーが発生しました。';
}

app.get('/api/tasks', (req, res) => res.json(read()));

app.post('/api/tasks', (req, res) => {
  const { sectionId, text, detail } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  if (detail !== undefined && typeof detail !== 'string') return res.status(400).json({ error: 'detail must be string' });
  const data = read();
  const section = data.sections.find(s => s.id === sectionId);
  if (!section) return res.status(404).json({ error: 'section not found' });
  const task = { id: uid(), text: text.trim(), detail: (detail || '').trim(), done: false, createdAt: new Date().toISOString() };
  section.tasks.push(task);
  write(data);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const data = read();
  for (const s of data.sections) {
    const t = s.tasks.find(t => t.id === req.params.id);
    if (t) {
      if (req.body.done !== undefined) t.done = req.body.done;
      if (req.body.text !== undefined) {
        if (typeof req.body.text !== 'string' || !req.body.text.trim()) return res.status(400).json({ error: 'text required' });
        t.text = req.body.text.trim();
      }
      if (req.body.detail !== undefined) {
        if (typeof req.body.detail !== 'string') return res.status(400).json({ error: 'detail must be string' });
        t.detail = req.body.detail;
      }
      write(data);
      return res.json(t);
    }
  }
  res.status(404).json({ error: 'not found' });
});

app.delete('/api/tasks/:id', (req, res) => {
  const data = read();
  for (const s of data.sections) {
    const i = s.tasks.findIndex(t => t.id === req.params.id);
    if (i !== -1) {
      s.tasks.splice(i, 1);
      write(data);
      return res.json({ ok: true });
    }
  }
  res.status(404).json({ error: 'not found' });
});

app.post('/api/sections', (req, res) => {
  const { title } = req.body;
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title required' });
  const data = read();
  const section = { id: uid(), title: title.trim(), tasks: [] };
  data.sections.push(section);
  write(data);
  res.json(section);
});

app.put('/api/sections/:id', (req, res) => {
  const data = read();
  const s = data.sections.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (req.body.title !== undefined) {
    if (typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: 'title required' });
    s.title = req.body.title.trim();
  }
  write(data);
  res.json(s);
});

app.delete('/api/sections/:id', (req, res) => {
  const data = read();
  const i = data.sections.findIndex(s => s.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'not found' });
  data.sections.splice(i, 1);
  write(data);
  res.json({ ok: true });
});

app.post('/api/suggest', async (req, res) => {
  const data = read();
  const open = [];
  for (const s of data.sections) {
    for (const t of s.tasks) {
      if (!t.done) open.push({ id: t.id, sectionTitle: s.title, text: t.text, detail: t.detail || '' });
    }
  }
  if (open.length === 0) return res.json({ suggestions: [] });

  const listText = open
    .map((t, i) => `[${i}] (${t.sectionTitle}) ${t.text}${t.detail ? ' — ' + t.detail : ''}`)
    .join('\n');
  const prompt = `以下は未完了タスクの一覧です。\n${listText}\n\nこの中から今日着手すべき優先度の高いものを最大3つ選んでください。出力は次のJSON配列のみを返してください（説明文やコードブロックは不要）:\n[{"index": 番号, "reason": "20〜40文字程度の日本語の理由"}]`;

  let client;
  try {
    client = createAnthropicClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  try {
    const response = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: 'AIの応答を解析できませんでした。' });
    let picks;
    try {
      picks = JSON.parse(match[0]);
    } catch {
      return res.status(502).json({ error: 'AIの応答を解析できませんでした。' });
    }
    const suggestions = picks
      .filter(p => Number.isInteger(p.index) && open[p.index])
      .slice(0, 3)
      .map(p => ({ ...open[p.index], reason: typeof p.reason === 'string' ? p.reason : '' }));
    res.json({ suggestions });
  } catch (err) {
    const status = err instanceof Anthropic.APIError && typeof err.status === 'number' ? err.status : 500;
    res.status(status).json({ error: toUserMessage(err) });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, '127.0.0.1', () => console.log(`task-manager :${PORT}`));
