/**
 * The "notes" example plugin (VS-334): the smallest thing that exercises every extension point a
 * third-party plugin (starting with captain's own Services plugin) needs — an agent tool, storage,
 * an HTTP route, and a page — at toy scale. It is the proof those points are buildable, not a
 * product in its own right. See ../README.md and docs/PLUGINS.md for the full contract.
 *
 * Plain JavaScript, no build step, same as echo-channel.
 */
import { definePlugin, WEAVE_PLUGIN_CLIENT_JS } from '@weave-ai/plugin-sdk';

const NOTE_PREFIX = 'note:';
const newNoteId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function pageHtml(host) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${host.kitCss()}</style>
<style>body { padding: 16px; } #notes { margin-top: 12px; } .note { padding: 8px 0; border-bottom: 1px solid var(--border, #333); }</style>
</head>
<body>
<h1>Notes</h1>
<form id="add-form">
  <input id="add-text" type="text" placeholder="a note" />
  <button type="submit">Add</button>
</form>
<div id="notes"></div>
<script>${WEAVE_PLUGIN_CLIENT_JS}</script>
<script>
  var client = window.weavePluginClient();
  var list = document.getElementById('notes');
  function render(notes) {
    list.innerHTML = '';
    notes.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'note';
      row.textContent = n.text;
      list.appendChild(row);
    });
  }
  client.request('GET', '/notes').then(function (res) { render(res.data.notes); });
  client.onEvent('note.created', function () {
    client.request('GET', '/notes').then(function (res) { render(res.data.notes); });
  });
  document.getElementById('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('add-text');
    var text = input.value.trim();
    if (!text) return;
    client.request('POST', '/notes', { text: text }).then(function () { input.value = ''; });
  });
</script>
</body>
</html>`;
}

export default definePlugin({
  id: 'notes',
  version: '0.1.0',
  apiVersion: 1,
  register(host) {
    const create = (text) => {
      const id = newNoteId();
      const note = { id, text, createdAt: new Date().toISOString() };
      host.store.put(`${NOTE_PREFIX}${id}`, note);
      host.emit('note.created', id, note);
      return note;
    };
    const list = async () => (await host.store.list(NOTE_PREFIX)).map((row) => row.value);

    host.registerAgentTool({
      name: 'notes_create',
      description: 'Add a note the notes page will show.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      scope: 'all',
      handler: async (input) => create(String(input.text)),
    });
    host.registerAgentTool({
      name: 'notes_list',
      description: 'List every note.',
      inputSchema: { type: 'object', properties: {} },
      scope: 'all',
      handler: async () => ({ notes: await list() }),
    });

    host.registerHttpRoute('GET', '/notes', async () => Response.json({ notes: await list() }));
    host.registerHttpRoute('POST', '/notes', async (req) => {
      const body = await req.json();
      if (!body || typeof body !== 'object' || typeof body.text !== 'string' || !body.text.trim()) {
        return Response.json({ error: 'text is required' }, { status: 400 });
      }
      return Response.json(create(body.text.trim()));
    });
    host.registerHttpRoute('GET', '/page', () => new Response(pageHtml(host), { headers: { 'content-type': 'text/html' } }));

    host.logger.info('notes plugin registered');
  },
});
