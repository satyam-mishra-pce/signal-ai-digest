const feed = document.querySelector('#feed');
const template = document.querySelector('#weeklyCardTemplate');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const authorColors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];

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

function dateLabel(start, end) {
  const formatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  return `${formatter.format(new Date(`${start}T12:00:00`))}–${formatter.format(new Date(`${end}T12:00:00`))}`;
}

function render(data) {
  feed.replaceChildren();
  for (const week of data.weeks) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.href = `detail.html?week=${encodeURIComponent(week.id)}`;
    card.dataset.accent = week.accent;
    card.querySelector('.weekly-avatar span').textContent = new Date(`${week.weekStart}T12:00:00`).getDate();
    card.querySelector('time').textContent = dateLabel(week.weekStart, week.weekEnd);
    card.querySelector('time').dateTime = week.weekStart;
    card.querySelector('h2').textContent = week.title;
    card.querySelector('.card-summary').textContent = week.summary;
    card.querySelector('.source-total').textContent = compact.format(week.sourceCount);
    card.querySelector('.evidence-copy').textContent = week.topAuthors.slice(0, 3).map(({ name }) => `@${name}`).join(' · ');
    const breakdown = card.querySelector('.theme-breakdown');
    week.themeBreakdown.forEach(theme => {
      const chip = document.createElement('span');
      chip.textContent = theme.label;
      breakdown.append(chip);
    });
    const avatars = card.querySelector('.avatar-stack');
    week.topAuthors.slice(0, 4).forEach(({ name, profilePicture }) => avatars.append(createAvatar(name, profilePicture)));
    feed.append(card);
  }
  document.querySelector('#feedSubtitle').textContent = 'What shipped, broke, and changed each week';
  const topicMap = new Map();
  data.weeks.forEach(week => week.themeBreakdown.forEach(topic => topicMap.set(topic.id, topic.label)));
  const topics = document.querySelector('#weeklyTopics');
  [...topicMap].slice(0, 9).forEach(([id, label]) => {
    const link = document.createElement('a');
    link.href = `detail.html?theme=${encodeURIComponent(id)}`;
    link.textContent = label;
    topics.append(link);
  });
}

async function init() {
  try {
    const response = await fetch('data/weekly.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    feed.innerHTML = `<div class="empty-state">Could not load the weekly archive.<br><small>${error.message}</small></div>`;
  }
}

init();
