const detailContent = document.querySelector('#detailContent');
const detailMeta = document.querySelector('#detailMeta');
const backLink = document.querySelector('#backLink');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const authorColors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];
const state = { item: null, query: '', visible: 30, focusedSourceId: null };

function hashValue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index);
  return Math.abs(hash);
}

function createAvatar(author, profilePicture, className = 'source-avatar') {
  if (profilePicture) {
    const image = document.createElement('img');
    image.className = className;
    image.src = profilePicture;
    image.alt = `@${author}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    return image;
  }
  const element = document.createElement('span');
  element.className = className;
  element.style.background = authorColors[hashValue(author) % authorColors.length];
  element.textContent = author.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'X';
  return element;
}

function displayDate(value, full = false) {
  return new Intl.DateTimeFormat('en', full
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  ).format(new Date(value));
}

function detailParagraphs(item) {
  const fallbackIds = item.sourcePostIds?.length
    ? item.sourcePostIds
    : item.sources.slice(0, Math.max(item.details.length, 1) * 2).map(source => source.id);
  return item.details.map((detail, index) => {
    if (typeof detail !== 'string') return detail;
    const start = (index * 2) % Math.max(fallbackIds.length, 1);
    return { text: detail, sourcePostIds: fallbackIds.slice(start, start + 2) };
  });
}

function scrollToSource(postId) {
  const source = state.item.sources.find(item => item.id === postId);
  if (!source) return;
  state.query = '';
  state.focusedSourceId = postId;
  renderSources();
  const search = detailContent.querySelector('.source-search');
  if (search) search.value = '';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const post = detailContent.querySelector(`[data-post-id="${postId}"]`);
    if (!post) return;
    post.scrollIntoView({ behavior: 'smooth', block: 'center' });
    post.classList.add('source-post-highlight');
    window.setTimeout(() => post.classList.remove('source-post-highlight'), 1800);
  }));
}

function createCitation(source) {
  const link = document.createElement('a');
  link.className = 'summary-citation';
  link.href = `#post-${source.id}`;
  link.title = `Source: @${source.author}`;
  link.setAttribute('aria-label', `Scroll to source post by @${source.author}`);
  link.append(createAvatar(source.author, source.profilePicture, 'summary-citation-avatar'));
  link.addEventListener('click', event => {
    event.preventDefault();
    scrollToSource(source.id);
  });
  return link;
}

function appendDetailParagraph(container, detail, item) {
  const paragraph = document.createElement('p');
  paragraph.append(document.createTextNode(detail.text));
  const citations = document.createElement('span');
  citations.className = 'summary-citations';
  detail.sourcePostIds
    .map(id => item.sources.find(source => source.id === id))
    .filter(Boolean)
    .forEach(source => citations.append(createCitation(source)));
  if (citations.childElementCount) paragraph.append(' ', citations);
  container.append(paragraph);
}

function createHero(item) {
  const hero = document.createElement('section');
  hero.className = 'detail-hero';
  hero.dataset.accent = item.accent;
  const title = document.createElement('h1');
  title.textContent = item.title;
  hero.append(title);

  const summaryToggle = document.createElement('button');
  summaryToggle.className = 'summary-toggle';
  summaryToggle.type = 'button';
  summaryToggle.textContent = 'Summarize the Summary';
  summaryToggle.setAttribute('aria-expanded', 'false');
  const summary = document.createElement('p');
  summary.className = 'short-summary';
  summary.textContent = item.summary;
  summary.hidden = true;
  summaryToggle.addEventListener('click', () => {
    summary.hidden = !summary.hidden;
    summaryToggle.textContent = summary.hidden ? 'Summarize the Summary' : 'Hide Summary';
    summaryToggle.setAttribute('aria-expanded', String(!summary.hidden));
  });
  hero.append(summaryToggle, summary);

  if (item.details?.length) {
    const details = detailParagraphs(item);
    const prose = document.createElement('div');
    prose.className = 'detail-prose';
    const first = details[0];
    const preview = document.createElement('p');
    preview.className = 'detail-preview';
    const previewLimit = 360;
    const shouldTruncate = first.text.length > previewLimit || details.length > 1;
    const previewText = first.text.length > previewLimit
      ? `${first.text.slice(0, previewLimit).replace(/\s+\S*$/, '')}…`
      : first.text;
    preview.append(document.createTextNode(previewText));
    if (shouldTruncate) {
      const readMore = document.createElement('button');
      readMore.className = 'inline-read-more';
      readMore.type = 'button';
      readMore.textContent = 'Read More';
      readMore.setAttribute('aria-expanded', 'false');
      readMore.addEventListener('click', () => {
        prose.replaceChildren();
        details.forEach(detail => appendDetailParagraph(prose, detail, item));
      });
      preview.append(' ', readMore);
    }
    const citations = document.createElement('span');
    citations.className = 'summary-citations';
    first.sourcePostIds
      .map(id => item.sources.find(source => source.id === id))
      .filter(Boolean)
      .forEach(source => citations.append(createCitation(source)));
    if (citations.childElementCount) preview.append(' ', citations);
    prose.append(preview);
    hero.append(prose);
  }
  return hero;
}

function createToolbar() {
  const toolbar = document.createElement('div');
  toolbar.className = 'source-toolbar';
  const wrap = document.createElement('div');
  wrap.className = 'search-wrap';
  wrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
  const input = document.createElement('input');
  input.className = 'source-search';
  input.type = 'search';
  input.placeholder = 'Search related posts';
  input.setAttribute('aria-label', 'Search related source posts');
  input.addEventListener('input', event => {
    state.query = event.target.value.trim().toLowerCase();
    state.visible = 30;
    state.focusedSourceId = null;
    renderSources();
  });
  wrap.append(input);
  const count = document.createElement('span');
  count.id = 'filteredSourceCount';
  count.className = 'source-count';
  toolbar.append(wrap, count);
  return toolbar;
}

function createSourcePost(source) {
  return Signal.postCard(source, { compact: true, showThread: true });
}

function filteredSources() {
  if (!state.query) return state.item.sources;
  return state.item.sources.filter(source => `${source.author} ${source.text}`.toLowerCase().includes(state.query));
}

function renderSources() {
  const list = detailContent.querySelector('#sourcesList');
  const sources = filteredSources();
  detailContent.querySelector('#filteredSourceCount').textContent = `${sources.length} source${sources.length === 1 ? '' : 's'}`;
  list.replaceChildren();
  if (!sources.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No related posts match that search.';
    list.append(empty);
    return;
  }
  const focusedSource = state.focusedSourceId
    ? sources.find(source => source.id === state.focusedSourceId)
    : null;
  if (focusedSource) {
    const focusedPost = createSourcePost(focusedSource);
    focusedPost.classList.add('focused-summary-source');
    list.append(focusedPost);
  }
  sources
    .slice(0, state.visible)
    .filter(source => source.id !== state.focusedSourceId)
    .forEach(source => list.append(createSourcePost(source)));
  if (state.visible < sources.length) {
    const button = document.createElement('button');
    button.className = 'load-more';
    button.type = 'button';
    button.textContent = `Load ${Math.min(50, sources.length - state.visible)} more`;
    button.addEventListener('click', () => { state.visible += 50; renderSources(); });
    list.append(button);
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const themeId = params.get('theme');
  const weekId = params.get('week');
  const isWeekly = Boolean(weekId);
  const dataUrl = isWeekly ? 'data/weekly.json' : 'data/digest.json';
  try {
    const response = await fetch(dataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.item = isWeekly
      ? data.weeks.find(item => item.id === weekId)
      : data.themes.find(item => item.id === themeId);
    if (!state.item) throw new Error('Digest not found');
    document.title = `${state.item.title} — Signal`;
    detailMeta.textContent = isWeekly
      ? `${displayDate(state.item.weekStart)}–${displayDate(state.item.weekEnd)}`
      : 'Topic digest';
    backLink.href = isWeekly ? 'weekly.html' : 'topics.html';
    detailContent.replaceChildren(createHero(state.item), createToolbar());
    const list = document.createElement('section');
    list.id = 'sourcesList';
    list.className = 'sources-list';
    list.setAttribute('aria-label', 'Related source posts');
    detailContent.append(list);
    renderSources();
  } catch (error) {
    detailContent.innerHTML = `<div class="empty-state">Could not load this digest.<br><small>${error.message}</small></div>`;
  }
}

init();
