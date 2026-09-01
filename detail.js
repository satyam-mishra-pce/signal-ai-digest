const detailContent = document.querySelector('#detailContent');
const detailMeta = document.querySelector('#detailMeta');
const detailKind = document.querySelector('#detailKind');
const backLink = document.querySelector('#backLink');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const authorColors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];
const state = { item: null, query: '', visible: 30 };

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

function createHero(item) {
  const hero = document.createElement('section');
  hero.className = 'detail-hero';
  hero.dataset.accent = item.accent;
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = item.eyebrow;
  const title = document.createElement('h1');
  title.textContent = item.title;
  const summary = document.createElement('p');
  summary.textContent = item.summary;
  hero.append(eyebrow, title, summary);
  if (item.details?.length) {
    const prose = document.createElement('div');
    prose.className = 'detail-prose';
    prose.hidden = true;
    item.details.forEach(text => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      prose.append(paragraph);
    });
    const readMore = document.createElement('button');
    readMore.className = 'read-more-button detail-read-more';
    readMore.type = 'button';
    readMore.textContent = 'Read more';
    readMore.setAttribute('aria-expanded', 'false');
    readMore.addEventListener('click', () => {
      prose.hidden = !prose.hidden;
      readMore.textContent = prose.hidden ? 'Read more' : 'Show less';
      readMore.setAttribute('aria-expanded', String(!prose.hidden));
    });
    hero.append(readMore, prose);
  }

  if (item.themeBreakdown) {
    const breakdown = document.createElement('div');
    breakdown.className = 'theme-breakdown';
    item.themeBreakdown.forEach(theme => {
      const chip = document.createElement('span');
      chip.textContent = `${theme.label} · ${theme.count}`;
      breakdown.append(chip);
    });
    hero.append(breakdown);
  }

  const takeaways = document.createElement('ul');
  takeaways.className = 'takeaways';
  item.takeaways.forEach(text => {
    const listItem = document.createElement('li');
    listItem.textContent = text;
    takeaways.append(listItem);
  });
  hero.append(takeaways);
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
  sources.slice(0, state.visible).forEach(source => list.append(createSourcePost(source)));
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
    detailKind.textContent = isWeekly ? 'Weekly AI digest' : 'Digest thread';
    detailMeta.textContent = isWeekly
      ? `${displayDate(state.item.weekStart)}–${displayDate(state.item.weekEnd)} · ${state.item.sourceCount} sources`
      : `${state.item.sourceCount} related posts · ${state.item.authorCount} authors`;
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
