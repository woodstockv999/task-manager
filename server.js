const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3006;
const TASKS_FILE = path.join(__dirname, 'tasks.json');

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

app.get('/api/tasks', (req, res) => res.json(read()));

app.post('/api/tasks', (req, res) => {
  const { sectionId, text } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  const data = read();
  const section = data.sections.find(s => s.id === sectionId);
  if (!section) return res.status(404).json({ error: 'section not found' });
  const task = { id: uid(), text: text.trim(), done: false, createdAt: new Date().toISOString() };
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, '127.0.0.1', () => console.log(`task-manager :${PORT}`));
