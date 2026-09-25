// ─── State ───────────────────────────────────────────────────────────────────

let isEnabled = true;
let popupOpacity = 100;
let lastTicketTitle = '';
let savedDescription = null;
let savedFeedEntries = [];
let popupShown = false;

chrome.storage.sync.get({ enabled: true, opacity: 100 }, ({ enabled, opacity }) => {
  isEnabled = enabled;
  popupOpacity = opacity;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SET_ENABLED') {
    isEnabled = msg.enabled;
    if (!isEnabled) document.getElementById('tdx-desc-popup')?.remove();
  }
  if (msg.type === 'SET_OPACITY') {
    popupOpacity = msg.opacity;
    const popup = document.getElementById('tdx-desc-popup');
    if (popup) popup.style.opacity = popupOpacity / 100;
  }
});

// ─── Popup ────────────────────────────────────────────────────────────────────

function showPopup(descriptionHTML, feedEntries = []) {
  document.getElementById('tdx-desc-popup')?.remove();

  const commentsHTML = feedEntries.map((e, i) => `
    <div class="tdx-comment ${i > 0 ? 'tdx-comment-border' : ''} ${e.isReply ? 'tdx-comment-reply' : ''}">
      <div class="tdx-comment-meta">
        <div>
          <span class="tdx-comment-author">${e.author}</span>
          ${e.isPrivate ? '<span class="tdx-comment-private">private</span>' : ''}
        </div>
        <span class="tdx-comment-time">${e.time}</span>
      </div>
      <div class="tdx-comment-body">${e.html}</div>
    </div>
  `).join('');

  const popup = document.createElement('div');
  popup.id = 'tdx-desc-popup';
  popup.style.opacity = popupOpacity / 100;
  popup.innerHTML = `
    <div id="tdx-popup-header">
      <h3>Description</h3>
      <button id="tdx-popup-close">✕</button>
    </div>
    <div id="tdx-popup-body">
      <div class="tdx-desc-content">${descriptionHTML || '(No Description)'}</div>
      ${feedEntries.length > 0 ? `
        <div id="tdx-comments-section">
          <button id="tdx-comments-toggle">
            <span id="tdx-comments-arrow">▶</span>
            Comments (${feedEntries.length})
          </button>
          <div id="tdx-comments-list" style="display:none;">
            ${commentsHTML}
          </div>
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(popup);

  // comments toggle
  document.getElementById('tdx-comments-toggle')?.addEventListener('click', () => {
    const list  = document.getElementById('tdx-comments-list');
    const arrow = document.getElementById('tdx-comments-arrow');
    const isOpen = list.style.display !== 'none';
    list.style.display = isOpen ? 'none' : 'block';
    arrow.textContent = isOpen ? '▶' : '▼';
  });

  document.getElementById('tdx-popup-close').addEventListener('click', () => popup.remove());

  // ── Drag ──
  const header = document.getElementById('tdx-popup-header');
  let isDragging = false, startX, startY, startLeft, startTop;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    popup.classList.add('dragging');

    const rect = popup.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = rect.top + 'px';
    popup.style.transform = 'none';

    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    popup.style.left = (startLeft + e.clientX - startX) + 'px';
    popup.style.top  = (startTop  + e.clientY - startY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    popup.classList.remove('dragging');
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDescriptionHTML(iframeDoc) {
  const wrapText = iframeDoc.querySelector('#divDescription .wrap-text');
  if (!wrapText) return null;

  // enter new line after block
  const clone = wrapText.cloneNode(true);

  clone.querySelectorAll('img').forEach(img => {
    const full = img.getAttribute('data-image-url');
    if (full) img.src = full;
    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:8px 0;';
  });

  clone.querySelectorAll('p, div, br, li').forEach(el => {
    el.insertAdjacentText('afterend', '\n');
  });

  return clone.innerHTML;
}


function waitForTicketContent(iframe, ticketId) {
  return new Promise((resolve, reject) => {
    const POLL_INTERVAL = 100;
    const TIMEOUT = 8000;
    let elapsed = 0;

    const poll = () => {
      const url = iframe.contentDocument?.location?.href || '';
      const doc = iframe.contentDocument;

      if (url.includes(ticketId)) {
        const descEl = doc?.querySelector('#divDescription .wrap-text');
        const feedEl = doc?.querySelector('.feed-entry');
        if (descEl && feedEl) {
		      console.log(descEl);
          resolve(doc);
          return;
        }
        if (descEl && elapsed >= 2000) {
          resolve(doc);
          return;
        }
      }

      elapsed += POLL_INTERVAL;
      if (elapsed >= TIMEOUT) {
        reject(new Error(`timeout waiting for ticket ${ticketId}`));
        return;
      }
      setTimeout(poll, POLL_INTERVAL);
    };

    poll();
  });
}

function getFeedEntries(iframeDoc) {
  const results = [];

  iframeDoc.querySelectorAll('.feed-entry').forEach(entry => {
    const label = entry.getAttribute('aria-label') || '';
    if (label.includes('Comment by System')) return;

    const match = label.match(/^Comment by (.+?) on (.+)$/);
    const isPrivate = !!entry.querySelector('.feed-private');
    const item = extractFeedItem(
      entry.querySelector('.feed-item-text'),
      match?.[1] || 'Unknown',
      match?.[2] || '',
      false,
      isPrivate
    );
    if (item) results.push(item);

    entry.querySelectorAll('.feed-reply.feed-child-box').forEach(reply => {
      const author = reply.querySelector('.feed-participant-name')?.innerText?.trim() || 'Unknown';
      const time   = reply.querySelector('.feed-timestamp span')?.innerText?.trim() || '';
      const isPrivate = !!reply.querySelector('.feed-private');
      const item = extractFeedItem(reply.querySelector('.feed-item-text'), author, time, true, isPrivate);
      if (item) results.push(item);
    });
  });

  return results;
}

function extractFeedItem(el, author, time, isReply = false, isPrivate = false) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('img').forEach(img => {
    const full = img.getAttribute('data-image-url');
    if (full) img.src = full;
    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:8px 0;';
  });
  return { author, time, isReply, isPrivate, html: clone.innerHTML };
}

// ─── Title Observer ───────────────────────────────────────────────────────────

const titleObserver = new MutationObserver(() => {
  const title = document.title;
  // console.log('title', title);
  if (!isEnabled) return;

  if (title.includes('Ticket Detail')) {
    // if (title === lastTicketTitle) return;
    // console.log('[Extension] returned - same title');
    lastTicketTitle = title;
    popupShown = false;

    const match = title.match(/Ticket Detail - (\d+):/);
    const ticketId = match?.[1];
    if (!ticketId) {
      console.error('[Extension] failed to retrieve ticket id');
      return;
    } 

    // const iframe = document.getElementById('tdx-right-side-pannel');
    const iframes = document.getElementsByTagName('iframe');

    const filteredIframes = Array.from(iframes).filter(iframe => iframe.classList.contains('tdx-right-side-panel__iframe'))

    if (filteredIframes.length !== 1) {
      console.error('[Extension] failed to retrieve iframe');
      return;
    }

    iframe = filteredIframes[0];

    console.log(`[TDX] ticket detected: ${ticketId}`);

    waitForTicketContent(iframe, ticketId)
      .then((iframeDoc) => {
        if (!isEnabled) return;
        savedDescription = getDescriptionHTML(iframeDoc);
        // console.log(savedDescription);
        savedFeedEntries = getFeedEntries(iframeDoc);
        console.log('[TDX] description loaded');

        iframeDoc.getElementById('divUpdateFromActions')
          ?.addEventListener('click', () => {
            // update 클릭 시 최신 description 재읽기 (failsafe)
            savedDescription = getDescriptionHTML(iframeDoc) ?? savedDescription;
          }, { once: true });
      })
      .catch((err) => console.error('[TDX]', err));

  } else if (title.includes('Update')) {
    if (popupShown) return;
    popupShown = true;
    console.log('[TDX] showing popup');
    showPopup(savedDescription, savedFeedEntries);

  } else if (title.includes('Main')) {
    lastTicketTitle = '';
    savedDescription = null;
    savedFeedEntries = [];
    popupShown = false;
    document.getElementById('tdx-desc-popup')?.remove();
  }
});

titleObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});