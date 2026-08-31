const feed = document.querySelector('#feed');
const template = document.querySelector('#digestCardTemplate');
const authorColors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function hashValue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index);
  return Math.abs(hash);
}

function createAvatar(author, profilePicture) {
  if (profilePicture) {
    const image = document.createElement('img');
    image.className = 'mini-avatar';
    image.src = profilePicture;
    image.alt = `@${author}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    return image;
  }
  const element = document.createElement('span');
  element.className = 'mini-avatar';
  element.style.background = authorColors[hashValue(author) % authorColors.length];
  element.textContent = author.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'X';
  element.title = `@${author}`;
  return element;
}

function displayDate(value) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function renderFeed(data) {
  feed.replaceChildren();
  for (const theme of data.themes) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.href = `detail.html?theme=${encodeURIComponent(theme.id)}`;
    card.dataset.accent = theme.accent;
    card.querySelector('.eyebrow').textContent = theme.eyebrow;
    card.querySelector('h2').textContent = theme.title;
    card.querySelector('.card-summary').textContent = theme.summary;
    card.querySelector('time').textContent = displayDate(theme.latestAt);
    card.querySelector('time').dateTime = theme.latestAt;
    card.querySelector('.source-total').textContent = compact.format(theme.sourceCount);
    card.querySelector('.evidence-copy').textContent = `${theme.sourceCount} related posts from ${theme.authorCount} voices`;
    const avatars = card.querySelector('.avatar-stack');
    theme.topAuthors.slice(0, 4).forEach(({ name, profilePicture }) => avatars.append(createAvatar(name, profilePicture)));
    feed.append(card);
  }
}

function hydrateSummary(data) {
  document.querySelector('#themeCount').textContent = data.themes.length;
  document.querySelector('#sourceCount').textContent = compact.format(data.aiSourceRecords);
  document.querySelector('#feedSubtitle').textContent = `${data.themes.length} syntheses from ${compact.format(data.corpusRecords)} collected posts`;
  const authors = new Set();
  data.themes.forEach(theme => theme.sources.forEach(source => authors.add(source.author)));
  const cloud = document.querySelector('#accountCloud');
  [...authors].sort((a, b) => a.localeCompare(b)).forEach(author => {
    const item = document.createElement('span');
    item.textContent = `@${author}`;
    cloud.append(item);
  });
}

async function init() {
  try {
    const response = await fetch('data/digest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    hydrateSummary(data);
    renderFeed(data);
  } catch (error) {
    feed.innerHTML = `<div class="empty-state">Could not load the digest. Serve this directory with a local web server.<br><small>${error.message}</small></div>`;
  }
}

init();
