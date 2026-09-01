const threadContent = document.querySelector('#threadContent');

async function init() {
  const conversationId = new URLSearchParams(location.search).get('id');
  if (!conversationId) {
    threadContent.innerHTML = '<div class="empty-state">No conversation ID was provided.</div>';
    return;
  }
  try {
    const response = await fetch('data/threads.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const posts = data.threads[conversationId];
    if (!posts) throw new Error('No collected context for this conversation');
    document.title = `@${posts[0].author} thread context — Signal`;
    const list = document.createElement('section');
    list.className = 'sources-list thread-list';
    posts.forEach(post => list.append(Signal.postCard(post, { hideThread: true })));
    threadContent.replaceChildren(list);
  } catch (error) {
    threadContent.innerHTML = `<div class="empty-state">Could not load this thread.<br><small>${error.message}</small></div>`;
  }
}

init();
