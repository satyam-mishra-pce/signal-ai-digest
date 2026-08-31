const input = document.querySelector('#rawSearch');
const authorFilter = document.querySelector('#authorFilter');
const typeFilter = document.querySelector('#typeFilter');
const resultsElement = document.querySelector('#searchResults');
const resultCount = document.querySelector('#resultCount');
const queryTime = document.querySelector('#queryTime');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const authorColors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];
const state = { records: [], matches: [], visible: 50, timer: null };

function hashValue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index);
  return Math.abs(hash);
}

function createAvatar(record) {
  if (record.profilePicture) {
    const image = document.createElement('img');
    image.className = 'source-avatar';
    image.src = record.profilePicture;
    image.alt = `@${record.author}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    return image;
  }
  const fallback = document.createElement('span');
  fallback.className = 'source-avatar';
  fallback.style.background = authorColors[hashValue(record.author) % authorColors.length];
  fallback.textContent = record.author.slice(0, 2).toUpperCase();
  return fallback;
}

function displayDate(value) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function createResult(record) {
  const article = document.createElement('article');
  article.className = 'source-post search-result';
  article.append(createAvatar(record));
  const body = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'source-head';
  const author = document.createElement('strong');
  author.textContent = `@${record.author}`;
  const separator = document.createElement('span');
  separator.textContent = '·';
  const time = document.createElement('time');
  time.dateTime = record.createdAt;
  time.textContent = displayDate(record.createdAt);
  const type = document.createElement('span');
  type.className = 'source-type';
  type.textContent = record.isQuote && record.type === 'reply' ? 'reply + quote' : record.type;
  head.append(author, separator, time, type);
  const text = document.createElement('p');
  text.className = 'source-text';
  text.textContent = record.text;
  const foot = document.createElement('div');
  foot.className = 'source-foot';
  const metrics = document.createElement('span');
  metrics.className = 'source-metrics';
  metrics.innerHTML = `<span>♡ ${compact.format(record.likeCount || 0)}</span><span>↩ ${compact.format(record.replyCount || 0)}</span><span>◉ ${compact.format(record.viewCount || 0)}</span>`;
  const link = document.createElement('a');
  link.className = 'x-link';
  link.href = record.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'View on X ↗';
  foot.append(metrics, link);
  body.append(head, text, foot);
  article.append(body);
  return article;
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

function runSearch() {
  const started = performance.now();
  const query = input.value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const author = authorFilter.value;
  const type = typeFilter.value;
  state.visible = 50;
  if (query.length < 2 && !author && !type) {
    state.matches = [];
    resultCount.textContent = 'Enter at least 2 characters';
    queryTime.textContent = '';
    resultsElement.innerHTML = '<div class="empty-state">Search across all 17,595 collected posts—not only the AI digest sources.</div>';
    return;
  }
  state.matches = [];
  for (const record of state.records) {
    if (author && record.author !== author) continue;
    if (type && record.type !== type) continue;
    const haystack = `${record.author} ${record.text}`.toLowerCase();
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
  history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  renderResults();
}

function scheduleSearch() {
  clearTimeout(state.timer);
  state.timer = setTimeout(runSearch, 100);
}

async function init() {
  try {
    const response = await fetch('data/search.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.records = data.records;
    const authors = [...new Set(state.records.map(record => record.author))].sort((a, b) => a.localeCompare(b));
    authors.forEach(author => {
      const option = document.createElement('option');
      option.value = author;
      option.textContent = `@${author}`;
      authorFilter.append(option);
    });
    document.querySelector('#archiveCount').textContent = compact.format(state.records.length);
    document.querySelector('#archiveAuthors').textContent = authors.length;
    document.querySelector('#searchSubtitle').textContent = `${state.records.length.toLocaleString()} posts from ${authors.length} accounts`;
    const params = new URLSearchParams(location.search);
    input.value = params.get('q') || '';
    authorFilter.value = params.get('author') || '';
    typeFilter.value = params.get('type') || '';
    if (input.value || authorFilter.value || typeFilter.value) runSearch();
    document.querySelectorAll('.example-queries button').forEach(button => button.addEventListener('click', () => {
      input.value = button.textContent;
      runSearch();
      input.focus();
    }));
  } catch (error) {
    resultsElement.innerHTML = `<div class="empty-state">Could not load the searchable archive.<br><small>${error.message}</small></div>`;
  }
}

input.addEventListener('input', scheduleSearch);
authorFilter.addEventListener('change', runSearch);
typeFilter.addEventListener('change', runSearch);
init();
