const Signal = (() => {
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const colors = ['#5865f2', '#d14d72', '#3ba272', '#8f6ed5', '#d1843d', '#277da1', '#a65b7b', '#4c956c'];
  const BOOKMARK_KEY = 'signal:bookmarks';
  const READ_KEY = 'signal:read';

  function storedSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
  }

  function saveSet(key, values) {
    localStorage.setItem(key, JSON.stringify([...values].slice(-2000)));
  }

  function hash(value) {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result) + value.charCodeAt(index);
    return Math.abs(result);
  }

  function avatar(record, className = 'source-avatar') {
    if (record.profilePicture) {
      const image = document.createElement('img');
      image.className = className;
      image.src = record.profilePicture;
      image.alt = `@${record.author}`;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      return image;
    }
    const fallback = document.createElement('span');
    fallback.className = className;
    fallback.style.background = colors[hash(record.author || '') % colors.length];
    fallback.textContent = (record.author || 'X').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'X';
    return fallback;
  }

  function displayDate(value, full = false) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en', full
      ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
    ).format(new Date(value));
  }

  function mediaGrid(items, sensitive = false, linkImages = true) {
    if (!items?.length) return null;
    const grid = document.createElement('div');
    grid.className = `media-grid media-count-${Math.min(items.length, 4)}`;
    if (sensitive) grid.classList.add('sensitive-media');
    items.slice(0, 4).forEach(item => {
      if (item.playbackUrl) {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.poster = item.url;
        video.src = item.playbackUrl;
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-label', item.altText || 'Video attached to post');
        grid.append(video);
        return;
      }
      const wrapper = document.createElement(linkImages ? 'a' : 'span');
      if (linkImages) {
        wrapper.href = item.url;
        wrapper.target = '_blank';
        wrapper.rel = 'noopener noreferrer';
      }
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.altText || 'Image attached to post';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      wrapper.append(image);
      grid.append(wrapper);
    });
    return grid;
  }

  function quoteCard(quote) {
    if (!quote) return null;
    const link = document.createElement('a');
    link.className = 'quote-card';
    link.href = quote.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const head = document.createElement('div');
    head.className = 'quote-head';
    head.append(avatar(quote, 'quote-avatar'));
    const name = document.createElement('strong');
    name.textContent = quote.displayName || `@${quote.author}`;
    const handle = document.createElement('span');
    handle.textContent = `@${quote.author}`;
    head.append(name, handle);
    const text = document.createElement('p');
    text.textContent = quote.text;
    link.append(head, text);
    const media = mediaGrid(quote.media, false, false);
    if (media) link.append(media);
    return link;
  }

  function toggleBookmark(id, button) {
    const bookmarks = storedSet(BOOKMARK_KEY);
    if (bookmarks.has(id)) bookmarks.delete(id); else bookmarks.add(id);
    saveSet(BOOKMARK_KEY, bookmarks);
    button.classList.toggle('active', bookmarks.has(id));
    button.setAttribute('aria-pressed', String(bookmarks.has(id)));
    button.title = bookmarks.has(id) ? 'Remove bookmark' : 'Bookmark post';
    document.dispatchEvent(new CustomEvent('signal:bookmarks'));
  }

  function markRead(id) {
    const read = storedSet(READ_KEY);
    if (!read.has(id)) {
      read.add(id);
      saveSet(READ_KEY, read);
    }
  }

  function postCard(record, options = {}) {
    const article = document.createElement('article');
    article.className = `source-post rich-post${options.compact ? ' compact-post' : ''}`;
    article.id = `post-${record.id}`;
    article.dataset.postId = record.id;
    if (!storedSet(READ_KEY).has(record.id)) article.classList.add('unread-post');
    article.append(avatar(record));
    const body = document.createElement('div');
    body.className = 'source-body';
    const head = document.createElement('div');
    head.className = 'source-head';
    const identity = document.createElement('span');
    identity.className = 'source-identity';
    const name = document.createElement('strong');
    name.textContent = record.displayName || `@${record.author}`;
    const handle = document.createElement('span');
    handle.textContent = `@${record.author}`;
    identity.append(name, handle);
    const time = document.createElement('time');
    time.dateTime = record.createdAt;
    time.textContent = displayDate(record.createdAt, true);
    const type = document.createElement('span');
    type.className = 'source-type';
    type.textContent = record.isQuote && record.type === 'reply' ? 'reply + quote' : record.type;
    head.append(identity, time, type);
    const text = document.createElement('p');
    text.className = 'source-text';
    text.textContent = record.text;
    body.append(head);
    if (record.inReplyToUsername) {
      const reply = document.createElement('p');
      reply.className = 'reply-context';
      reply.textContent = `Replying to @${record.inReplyToUsername}`;
      body.append(reply);
    }
    body.append(text);
    const media = mediaGrid(record.media, record.possiblySensitive);
    if (media) body.append(media);
    const quote = quoteCard(record.quotedPost);
    if (quote) body.append(quote);
    if (record.externalUrl) {
      const external = document.createElement('a');
      external.className = 'external-link';
      external.href = record.externalUrl;
      external.target = '_blank';
      external.rel = 'noopener noreferrer';
      try { external.textContent = `↗ ${new URL(record.externalUrl).hostname.replace(/^www\./, '')}`; } catch { external.textContent = 'Open linked page ↗'; }
      body.append(external);
    }
    const foot = document.createElement('div');
    foot.className = 'source-foot';
    const metrics = document.createElement('span');
    metrics.className = 'source-metrics';
    metrics.innerHTML = `<span>♡ ${compact.format(record.likeCount || 0)}</span><span>↩ ${compact.format(record.replyCount || 0)}</span><span>⟳ ${compact.format(record.retweetCount || 0)}</span><span>◉ ${compact.format(record.viewCount || 0)}</span>`;
    const actions = document.createElement('span');
    actions.className = 'post-actions';
    if (!options.hideThread && record.conversationId && (record.threadSize > 1 || record.inReplyToId)) {
      const thread = document.createElement('a');
      thread.className = 'thread-link';
      thread.href = `thread.html?id=${encodeURIComponent(record.conversationId)}`;
      thread.textContent = record.threadSize > 1 ? `Thread · ${record.threadSize}` : 'Context';
      actions.append(thread);
    }
    const bookmark = document.createElement('button');
    bookmark.className = 'bookmark-button';
    bookmark.type = 'button';
    bookmark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11v15l-5.5-3.2-5.5 3.2v-15Z"></path></svg><span class="sr-only">Bookmark</span>';
    bookmark.classList.toggle('active', storedSet(BOOKMARK_KEY).has(record.id));
    bookmark.setAttribute('aria-pressed', String(storedSet(BOOKMARK_KEY).has(record.id)));
    bookmark.title = storedSet(BOOKMARK_KEY).has(record.id) ? 'Remove bookmark' : 'Bookmark post';
    bookmark.addEventListener('click', () => toggleBookmark(record.id, bookmark));
    const link = document.createElement('a');
    link.className = 'x-link';
    link.href = record.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View on X ↗';
    actions.append(bookmark, link);
    foot.append(metrics, actions);
    body.append(foot);
    article.append(body);
    requestAnimationFrame(() => markRead(record.id));
    return article;
  }

  return {
    avatar,
    displayDate,
    mediaGrid,
    postCard,
    bookmarks: () => storedSet(BOOKMARK_KEY),
    read: () => storedSet(READ_KEY),
  };
})();
