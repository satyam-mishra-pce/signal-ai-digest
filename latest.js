const latestFeed = document.querySelector('#latestFeed');
const topicFilter = document.querySelector('#topicFilter');
const authorFilter = document.querySelector('#authorFilter');
const kindFilter = document.querySelector('#kindFilter');
const mediaFilter = document.querySelector('#mediaFilter');
const bookmarkFilter = document.querySelector('#bookmarkFilter');
const state = { posts: [], visible: 40 };

function labelTopic(value) {
  return value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function filteredPosts() {
  const bookmarks = Signal.bookmarks();
  return state.posts.filter(post => {
    if (topicFilter.value && post.topic !== topicFilter.value) return false;
    if (authorFilter.value && post.author !== authorFilter.value) return false;
    if (kindFilter.value && post.type !== kindFilter.value) return false;
    if (mediaFilter.checked && !post.media?.length) return false;
    if (bookmarkFilter.checked && !bookmarks.has(post.id)) return false;
    return true;
  });
}

function render() {
  const posts = filteredPosts();
  latestFeed.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = bookmarkFilter.checked ? 'No bookmarked posts match these filters.' : 'No recent posts match these filters.';
    latestFeed.append(empty);
    return;
  }
  posts.slice(0, state.visible).forEach(post => latestFeed.append(Signal.postCard(post, { showThread: true })));
  if (state.visible < posts.length) {
    const button = document.createElement('button');
    button.className = 'load-more';
    button.type = 'button';
    button.textContent = `Load ${Math.min(40, posts.length - state.visible)} more`;
    button.addEventListener('click', () => { state.visible += 40; render(); });
    latestFeed.append(button);
  }
  document.querySelector('#feedSubtitle').textContent = posts.length === state.posts.length
    ? 'What builders are discussing now'
    : `${posts.length} posts match your filters`;
}

function resetAndRender() {
  state.visible = 40;
  render();
}

async function init() {
  try {
    const response = await fetch('data/latest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.posts = data.posts;
    const topics = [...new Set(state.posts.map(post => post.topic).filter(Boolean))].sort();
    const authors = [...new Set(state.posts.map(post => post.author))].sort((a, b) => a.localeCompare(b));
    topics.forEach(topic => topicFilter.add(new Option(labelTopic(topic), topic)));
    authors.forEach(author => authorFilter.add(new Option(`@${author}`, author)));
    document.querySelector('#updatedAt').textContent = `Updated ${Signal.displayDate(data.generatedAt)}`;
    const weeklyResponse = await fetch('data/weekly.json', { cache: 'no-cache' });
    if (weeklyResponse.ok) {
      const latestWeek = (await weeklyResponse.json()).weeks[0];
      document.querySelector('#spotlightTitle').textContent = latestWeek.title;
      document.querySelector('#spotlightSummary').textContent = latestWeek.summary;
      document.querySelector('#spotlightLink').href = `detail.html?week=${encodeURIComponent(latestWeek.id)}`;
    }
    render();
  } catch (error) {
    latestFeed.innerHTML = `<div class="empty-state">Could not load the latest feed.<br><small>${error.message}</small></div>`;
  }
}

[topicFilter, authorFilter, kindFilter, mediaFilter, bookmarkFilter].forEach(control => control.addEventListener('change', resetAndRender));
document.querySelector('#showBookmarks').addEventListener('click', () => { bookmarkFilter.checked = true; resetAndRender(); });
document.addEventListener('signal:bookmarks', () => { if (bookmarkFilter.checked) render(); });
init();
