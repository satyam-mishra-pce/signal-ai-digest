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
    card.querySelector('.evidence-copy').textContent = theme.topAuthors.slice(0, 3).map(({ name }) => `@${name}`).join(' · ');
    const avatars = card.querySelector('.avatar-stack');
    theme.topAuthors.slice(0, 4).forEach(({ name, profilePicture }) => avatars.append(createAvatar(name, profilePicture)));
    feed.append(card);
  }
}

function hydrateSummary() {
  document.querySelector('#feedSubtitle').textContent = 'Ideas, releases, workflows, and debates';
}

async function hydrateSpotlight() {
  const response = await fetch('data/weekly.json', { cache: 'no-cache' });
  if (!response.ok) return;
  const week = (await response.json()).weeks[0];
  document.querySelector('#spotlightTitle').textContent = week.title;
  document.querySelector('#spotlightSummary').textContent = week.summary;
  document.querySelector('#spotlightLink').href = `detail.html?week=${encodeURIComponent(week.id)}`;
}

async function init() {
  try {
    const response = await fetch('data/digest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    hydrateSummary();
    renderFeed(data);
    hydrateSpotlight();
  } catch (error) {
    feed.innerHTML = `<div class="empty-state">Could not load the digest. Serve this directory with a local web server.<br><small>${error.message}</small></div>`;
  }
}

init();
