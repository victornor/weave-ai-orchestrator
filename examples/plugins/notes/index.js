/**
 * The "notes" example plugin (VS-334): the smallest thing that exercises every extension point a
 * third-party plugin (starting with captain's own Services plugin) needs — an agent tool, storage,
 * an HTTP route, and a page — at toy scale. It is the proof those points are buildable, not a
 * product in its own right. See ../README.md and docs/PLUGINS.md for the full contract.
 *
 * Plain JavaScript, no build step, same as echo-channel.
 */
import { definePlugin, WEAVE_PLUGIN_CLIENT_JS, WEAVE_PLUGIN_CLASS } from '@weave-ai/plugin-sdk';

const NOTE_PREFIX = 'note:';
const newNoteId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Plain markup using only the vocabulary's classes (VS-385) — no CSS rule of this plugin's own,
 * anywhere (no `style` attribute, no authored `<style>` block beyond the sanctioned first-paint
 * inline below): the "Notes" heading is left to the host's own page title bar, and the add-note
 * control and the list are each a bare `.v2-card` of `.v2-form-row`/`.v2-table` rows, which already
 * carry their own padding and gap in the vocabulary's real recipe — the same shape as
 * `GeneralSection`'s two label rows in `packages/ui/src/v2/settings/sections/Workspace.tsx`. The
 * inline `host.themeCss()` is optional, purely to avoid a flash of unstyled content before the
 * bridge's own `stylesheet` push arrives (`weavePluginClient()` applies that push automatically,
 * with no extra code here).
 */
function pageHtml(host) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${host.themeCss()}</style>
</head>
<body>
<form id="add-form">
  <div class="${WEAVE_PLUGIN_CLASS.section}">
    <label class="${WEAVE_PLUGIN_CLASS.formRow}">
      <span>Add a note</span>
      <input id="add-text" class="${WEAVE_PLUGIN_CLASS.input}" type="text" placeholder="a note" />
    </label>
    <div class="${WEAVE_PLUGIN_CLASS.formRow}">
      <button type="submit" class="${WEAVE_PLUGIN_CLASS.button}" data-variant="primary">Add</button>
    </div>
  </div>
</form>
<div id="notes" class="${WEAVE_PLUGIN_CLASS.table}"></div>
<script>${WEAVE_PLUGIN_CLIENT_JS}</script>
<script>
  var client = window.weavePluginClient();
  var list = document.getElementById('notes');
  function render(notes) {
    list.innerHTML = '';
    notes.forEach(function (n) {
      var row = document.createElement('div');
      row.setAttribute('data-row', '');
      var cell = document.createElement('span');
      cell.setAttribute('data-cell', 'primary');
      cell.textContent = n.text;
      row.appendChild(cell);
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
  name: 'Notes',
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
