const input = document.querySelector('#rawSearch');
const authorFilter = document.querySelector('#authorFilter');
const typeFilter = document.querySelector('#typeFilter');
const mediaFilter = document.querySelector('#searchMediaFilter');
const bookmarkFilter = document.querySelector('#searchBookmarkFilter');
const resultsElement = document.querySelector('#searchResults');
const resultCount = document.querySelector('#resultCount');
const queryTime = document.querySelector('#queryTime');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const state = { manifest: null, records: [], matches: [], visible: 50, timer: null, loaded: false, loading: null };

async function loadArchive() {
  if (state.loaded) return;
  if (state.loading) return state.loading;
  state.loading = (async () => {
    resultCount.textContent = 'Loading search shards…';
    const payloads = await Promise.all(state.manifest.archive.map(async shard => {
      const response = await fetch(shard.path, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Could not load ${shard.month}`);
      return response.json();
    }));
    state.records = payloads.flatMap(payload => payload.records);
    state.loaded = true;
  })();
  return state.loading;
}

function createResult(record) {
  return Signal.postCard(record, { compact: true, showThread: true });
}

function renderResults() {
  resultsElement.replaceChildren();
  if (!state.matches.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No posts match those keywords and filters.';
    resultsElement.append(empty);
    return;
  }
  state.matches.slice(0, state.visible).forEach(({ record }) => resultsElement.append(createResult(record)));
  if (state.visible < state.matches.length) {
    const button = document.createElement('button');
    button.className = 'load-more';
    button.type = 'button';
    button.textContent = `Load ${Math.min(50, state.matches.length - state.visible)} more`;
    button.addEventListener('click', () => { state.visible += 50; renderResults(); });
    resultsElement.append(button);
  }
}

async function runSearch() {
  const query = input.value.trim().toLowerCase();
  const author = authorFilter.value;
  const type = typeFilter.value;
  if (query.length < 2 && !author && !type && !mediaFilter.checked && !bookmarkFilter.checked) {
    state.matches = [];
    resultCount.textContent = 'Enter at least 2 characters';
    queryTime.textContent = '';
    resultsElement.innerHTML = `<div class="empty-state">Search across all ${state.manifest.recordCount.toLocaleString()} collected posts, not only AI digest sources.</div>`;
    return;
  }
  try {
    await loadArchive();
  } catch (error) {
    resultsElement.innerHTML = `<div class="empty-state">Could not load the archive.<br><small>${error.message}</small></div>`;
    return;
  }
  const started = performance.now();
  const terms = query.split(/\s+/).filter(Boolean);
  const bookmarks = Signal.bookmarks();
  state.visible = 50;
  state.matches = [];
  for (const record of state.records) {
    if (author && record.author !== author) continue;
    if (type && record.type !== type) continue;
    if (mediaFilter.checked && !record.media?.length) continue;
    if (bookmarkFilter.checked && !bookmarks.has(record.id)) continue;
    const haystack = `${record.author} ${record.displayName || ''} ${record.text} ${record.quotedPost?.text || ''}`.toLowerCase();
    if (terms.some(term => !haystack.includes(term))) continue;
    let score = query && haystack.includes(query) ? 20 : 0;
    score += terms.reduce((total, term) => total + haystack.split(term).length - 1, 0);
    score += Math.log1p(record.likeCount || 0) * 0.15;
    state.matches.push({ record, score });
  }
  state.matches.sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
  resultCount.textContent = `${state.matches.length.toLocaleString()} matching post${state.matches.length === 1 ? '' : 's'}`;
  queryTime.textContent = `${Math.round(performance.now() - started)} ms`;
  const params = new URLSearchParams();
  if (input.value.trim()) params.set('q', input.value.trim());
  if (author) params.set('author', author);
  if (type) params.set('type', type);
  if (mediaFilter.checked) params.set('media', '1');
  if (bookmarkFilter.checked) params.set('bookmarks', '1');
  history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  renderResults();
}

function scheduleSearch() {
  clearTimeout(state.timer);
  state.timer = setTimeout(runSearch, 150);
}

function saveSearch() {
  const params = new URLSearchParams(location.search);
  if (!params.size) return;
  const saved = JSON.parse(localStorage.getItem('signal:saved-searches') || '[]');
  const value = { label: input.value.trim() || 'Filtered posts', query: params.toString() };
  const next = [value, ...saved.filter(item => item.query !== value.query)].slice(0, 8);
  localStorage.setItem('signal:saved-searches', JSON.stringify(next));
  renderSavedSearches();
}

function renderSavedSearches() {
  const container = document.querySelector('#savedSearches');
  const saved = JSON.parse(localStorage.getItem('signal:saved-searches') || '[]');
  container.replaceChildren();
  saved.forEach(item => {
    const link = document.createElement('a');
    link.href = `search.html?${item.query}`;
    link.textContent = item.label;
    container.append(link);
  });
  if (!saved.length) container.textContent = 'No saved searches yet.';
}

async function init() {
  try {
    const response = await fetch('data/manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.manifest = await response.json();
    state.manifest.accounts.forEach(author => authorFilter.add(new Option(`@${author}`, author)));
    document.querySelector('#archiveCount').textContent = compact.format(state.manifest.recordCount);
    document.querySelector('#archiveAuthors').textContent = state.manifest.accounts.length;
    document.querySelector('#searchSubtitle').textContent = `${state.manifest.recordCount.toLocaleString()} posts in ${state.manifest.archive.length} cached monthly shards`;
    document.querySelector('.feed-header .curated-pill').textContent = `${compact.format(state.manifest.recordCount)} posts`;
    const params = new URLSearchParams(location.search);
    input.value = params.get('q') || '';
    authorFilter.value = params.get('author') || '';
    typeFilter.value = params.get('type') || '';
    mediaFilter.checked = params.get('media') === '1';
    bookmarkFilter.checked = params.get('bookmarks') === '1';
    if ([input.value, authorFilter.value, typeFilter.value].some(Boolean) || mediaFilter.checked || bookmarkFilter.checked) runSearch();
    document.querySelectorAll('.example-queries button').forEach(button => button.addEventListener('click', () => {
      input.value = button.textContent;
      runSearch();
      input.focus();
    }));
    renderSavedSearches();
  } catch (error) {
    resultsElement.innerHTML = `<div class="empty-state">Could not load the searchable archive.<br><small>${error.message}</small></div>`;
  }
}

input.addEventListener('input', scheduleSearch);
[authorFilter, typeFilter, mediaFilter, bookmarkFilter].forEach(control => control.addEventListener('change', runSearch));
document.querySelector('#saveSearch').addEventListener('click', saveSearch);
document.addEventListener('signal:bookmarks', () => { if (bookmarkFilter.checked) runSearch(); });
init();
