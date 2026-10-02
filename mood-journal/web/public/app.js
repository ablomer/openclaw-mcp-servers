const SOCIAL = [
  ['', '—'],
  ['alone', 'Alone'],
  ['one_on_one', 'One on one'],
  ['group', 'Group'],
];

const CONTEXTS = [
  ['', '—'],
  ['home', 'Home'],
  ['work', 'Work'],
  ['travel', 'Travel'],
  ['outdoors', 'Outdoors'],
  ['other', 'Other'],
];

const app = document.querySelector('#app');
let nextBefore = null;
let filters = { q: '', from: '', to: '' };

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function readError(res) {
  try {
    const body = await res.json();
    return body.error || 'request failed';
  } catch {
    return 'request failed';
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body != null) headers.set('content-type', 'application/json');
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') {
    renderLogin('Sign in again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(await readError(res));
  if (res.status === 204) return null;
  return res.json();
}

function renderLogin(message) {
  app.replaceChildren(
    h('section', { class: 'panel login stack' },
      h('h1', {}, 'Mood journal'),
      h('p', { class: 'lede' }, 'A private record of how the days went.'),
      message ? h('p', { class: 'error', role: 'alert' }, message) : null,
      h('form', { class: 'stack', onsubmit: submitLogin },
        h('label', {}, 'Password',
          h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: '' })),
        h('button', { class: 'primary', type: 'submit' }, 'Enter'),
      ),
    ),
  );
  app.querySelector('input')?.focus();
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: new FormData(form).get('password') }),
  });
  if (res.ok) {
    try {
      await openJournal();
    } catch (err) {
      if (err.message !== 'unauthorized') renderLogin(err.message);
    }
    return;
  }
  button.disabled = false;
  const code = await readError(res);
  const text = res.status === 429
    ? 'Too many attempts. Wait a few minutes.'
    : 'That password is not right.';
  renderLogin(code === 'unauthorized' || res.status === 401 || res.status === 429 ? text : code);
}

async function openJournal() {
  const [page, tagBody] = await Promise.all([
    api('/api/entries'),
    api('/api/tags'),
  ]);
  filters = { q: '', from: '', to: '' };
  renderShell(tagBody.tags);
  showEntries(page, false);
}

function renderShell(tags) {
  const search = h('form', { class: 'panel filters', onsubmit: applyFilters },
    h('label', {}, 'Search notes',
      h('input', { name: 'q', type: 'search', placeholder: 'A word or phrase' })),
    h('div', { class: 'dates' },
      h('label', {}, 'From', h('input', { name: 'from', type: 'date' })),
      h('label', {}, 'To', h('input', { name: 'to', type: 'date' })),
    ),
    h('div', { class: 'row' },
      h('button', { class: 'primary', type: 'submit' }, 'Apply'),
      h('button', { class: 'ghost', type: 'button', onclick: clearFilters }, 'Clear'),
    ),
  );

  app.replaceChildren(
    h('header', { class: 'header' },
      h('div', {},
        h('h1', {}, 'Mood journal'),
        h('p', { class: 'lede' }, 'Newest first. Times are New York.'),
      ),
      h('button', { class: 'ghost', type: 'button', onclick: logout }, 'Log out'),
    ),
    search,
    h('div', { class: 'row actions' },
      h('button', { class: 'primary', type: 'button', onclick: () => openEditor(null) }, 'New entry'),
    ),
    h('p', { id: 'list-error', class: 'error', role: 'alert' }),
    h('div', { id: 'entries', class: 'list' }),
    h('div', { class: 'row more' },
      h('button', { id: 'more', class: 'ghost', type: 'button', onclick: loadMore }, 'Load more'),
    ),
    editorDialog(tags),
  );
}

function editorDialog(tags) {
  const datalist = h('datalist', { id: 'tag-list' },
    ...tags.map((name) => h('option', { value: name })),
  );
  const moodPicker = h('div', { class: 'mood-picker' },
    ...Array.from({ length: 10 }, (_, i) => {
      const n = String(i + 1);
      return h('label', {},
        h('input', { type: 'radio', name: 'mood', value: n, required: i === 0 ? '' : null }),
        h('span', {}, n),
      );
    }),
  );
  return h('dialog', { id: 'editor' },
    h('form', { class: 'editor', onsubmit: saveEntry },
      h('h2', { id: 'editor-title' }, 'New entry'),
      h('p', { id: 'editor-error', class: 'error', role: 'alert' }),
      h('div', {},
        h('span', { class: 'hint' }, 'Mood'),
        moodPicker,
      ),
      h('label', { class: 'span-2' }, 'Note',
        h('textarea', { name: 'note', required: '', maxlength: '8000' })),
      h('label', {}, 'When (New York)',
        h('input', { name: 'when', type: 'datetime-local', step: '60' })),
      h('p', { class: 'hint' }, 'Leave the time blank on a new entry to use now.'),
      h('div', { class: 'grid' },
        h('label', {}, 'Energy', h('input', { name: 'energy', type: 'number', min: '1', max: '10', step: '1' })),
        h('label', {}, 'Anxiety', h('input', { name: 'anxiety', type: 'number', min: '1', max: '10', step: '1' })),
        h('label', {}, 'Sleep hours', h('input', { name: 'sleep_hours', type: 'number', min: '0', max: '24', step: '0.1' })),
        h('label', {}, 'Sleep quality', h('input', { name: 'sleep_quality', type: 'number', min: '1', max: '10', step: '1' })),
        h('label', {}, 'Social', select('social', SOCIAL)),
        h('label', {}, 'Context', select('context', CONTEXTS)),
      ),
      h('label', {}, 'Tags',
        h('input', { name: 'tags', list: 'tag-list', placeholder: 'walk, work' })),
      datalist,
      h('div', { class: 'editor-actions' },
        h('button', { class: 'ghost', type: 'button', onclick: closeEditor }, 'Cancel'),
        h('button', { class: 'primary', type: 'submit' }, 'Save'),
      ),
      h('div', { id: 'delete-row', class: 'editor-actions' },
        h('button', { class: 'danger', type: 'button', onclick: askDelete }, 'Delete'),
      ),
      h('div', { id: 'confirm-row', class: 'confirm', hidden: '' },
        h('span', {}, 'Delete this entry?'),
        h('span', { class: 'row' },
          h('button', { class: 'ghost', type: 'button', onclick: cancelDelete }, 'Keep'),
          h('button', { class: 'danger', type: 'button', onclick: confirmDelete }, 'Delete'),
        ),
      ),
    ),
  );
}

function select(name, options) {
  return h('select', { name },
    ...options.map(([value, label]) => h('option', { value }, label)),
  );
}

function showEntries(page, append) {
  const list = document.querySelector('#entries');
  const cards = page.entries.map(entryCard);
  if (append) list.append(...cards);
  else if (cards.length) list.replaceChildren(...cards);
  else list.replaceChildren(h('p', { class: 'empty hint' }, 'No entries in this view.'));
  nextBefore = page.next_before;
  const more = document.querySelector('#more');
  more.hidden = !nextBefore;
}

function entryCard(entry) {
  return h('button', { class: 'card', type: 'button', onclick: () => openEditor(entry) },
    h('div', { class: 'card-top' },
      h('span', { class: 'mood', 'data-mood': String(entry.mood) }, String(entry.mood)),
      h('span', { class: 'meta' }, entry.display_recorded_at),
    ),
    h('div', { class: 'note' }, entry.note),
    entry.tags.length
      ? h('div', { class: 'tag-row' }, ...entry.tags.map((tag) => h('span', { class: 'tag' }, tag)))
      : null,
  );
}

async function applyFilters(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  filters = {
    q: String(data.get('q') || '').trim(),
    from: String(data.get('from') || ''),
    to: String(data.get('to') || ''),
  };
  await reload();
}

async function clearFilters() {
  filters = { q: '', from: '', to: '' };
  const form = document.querySelector('.filters');
  form.reset();
  await reload();
}

function queryString() {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function reload() {
  const error = document.querySelector('#list-error');
  if (!error) return;
  error.textContent = '';
  try {
    const page = await api(`/api/entries${queryString()}`);
    showEntries(page, false);
  } catch (err) {
    if (err.message !== 'unauthorized') error.textContent = err.message;
  }
}

async function loadMore() {
  if (!nextBefore) return;
  const params = new URLSearchParams(queryString().slice(1));
  params.set('before', nextBefore);
  const error = document.querySelector('#list-error');
  if (!error) return;
  error.textContent = '';
  try {
    const page = await api(`/api/entries?${params.toString()}`);
    showEntries(page, true);
  } catch (err) {
    if (err.message !== 'unauthorized') error.textContent = err.message;
  }
}

function formEl() {
  return document.querySelector('#editor form');
}

function openEditor(entry) {
  const dialog = document.querySelector('#editor');
  const form = formEl();
  form.dataset.id = entry?.id || '';
  document.querySelector('#editor-title').textContent = entry ? 'Edit entry' : 'New entry';
  document.querySelector('#editor-error').textContent = '';
  document.querySelector('#delete-row').hidden = !entry;
  document.querySelector('#confirm-row').hidden = true;
  for (const input of form.querySelectorAll('input[name="mood"]')) {
    input.checked = entry ? String(entry.mood) === input.value : false;
  }
  form.note.value = entry?.note || '';
  form.when.value = entry?.when || '';
  form.energy.value = entry?.energy ?? '';
  form.anxiety.value = entry?.anxiety ?? '';
  form.sleep_hours.value = entry?.sleep_hours ?? '';
  form.sleep_quality.value = entry?.sleep_quality ?? '';
  form.social.value = entry?.social || '';
  form.context.value = entry?.context || '';
  form.tags.value = entry?.tags?.join(', ') || '';
  dialog.showModal();
}

function closeEditor() {
  document.querySelector('#editor').close();
}

function numOrNull(value) {
  if (value === '' || value == null) return null;
  return Number(value);
}

function entryBody(form) {
  const mood = form.querySelector('input[name="mood"]:checked');
  const body = {
    mood: mood ? Number(mood.value) : undefined,
    note: form.note.value,
    energy: numOrNull(form.energy.value),
    anxiety: numOrNull(form.anxiety.value),
    sleep_hours: numOrNull(form.sleep_hours.value),
    sleep_quality: numOrNull(form.sleep_quality.value),
    social: form.social.value || null,
    context: form.context.value || null,
    tags: form.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
  };
  if (form.when.value) body.when = form.when.value.slice(0, 16);
  return body;
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('#editor-error');
  error.textContent = '';
  const id = form.dataset.id;
  try {
    if (id) await api(`/api/entries/${id}`, { method: 'PATCH', body: entryBody(form) });
    else await api('/api/entries', { method: 'POST', body: entryBody(form) });
    closeEditor();
    await refreshTags();
    await reload();
  } catch (err) {
    if (err.message !== 'unauthorized') error.textContent = err.message;
  }
}

function askDelete() {
  document.querySelector('#confirm-row').hidden = false;
}

function cancelDelete() {
  document.querySelector('#confirm-row').hidden = true;
}

async function confirmDelete() {
  const id = formEl().dataset.id;
  const error = document.querySelector('#editor-error');
  error.textContent = '';
  try {
    await api(`/api/entries/${id}`, { method: 'DELETE' });
    closeEditor();
    await refreshTags();
    await reload();
  } catch (err) {
    if (err.message !== 'unauthorized') error.textContent = err.message;
  }
}

async function refreshTags() {
  try {
    const body = await api('/api/tags');
    const list = document.querySelector('#tag-list');
    list.replaceChildren(...body.tags.map((name) => h('option', { value: name })));
  } catch {
    // The entry list still reloads if tags fail.
  }
}

async function logout() {
  await fetch('/logout', { method: 'POST' });
  renderLogin();
}

const probe = await fetch('/api/entries');
if (probe.status === 401) renderLogin();
else if (!probe.ok) renderLogin(await readError(probe));
else {
  const page = await probe.json();
  const tags = await api('/api/tags').catch(() => ({ tags: [] }));
  renderShell(tags.tags || []);
  showEntries(page, false);
}
