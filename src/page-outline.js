/**
 * Page outline ("On this page") — built from the page's own H2s and H3s, so
 * it never goes out of date. Used by the Privacy page.
 *
 * - Every H2/H3 gets a stable, readable id (its own, if it has one;
 *   otherwise a slug of its text, made unique).
 * - The outline lists each H2, with its H3s nested beneath, linking to the
 *   anchors.
 * - The section in view is marked with aria-current="location", updating
 *   as the page scrolls.
 * - Desktop shows the list as a sticky column; on narrow screens the same
 *   list sits in a collapsible <details> above the text (see privacy.css).
 * Smooth scrolling and the header offset are CSS (scroll-behavior,
 * scroll-margin-top), so reduced motion is respected there.
 */

/** Readable slug: "What Mezzo does not do" -> "what-mezzo-does-not-do". */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/** Gives every heading an id, keeping existing ones and avoiding duplicates. */
export function assignHeadingIds(headings, doc = headings[0]?.ownerDocument) {
  const taken = new Set();
  for (const h of headings) {
    let id = h.id || slugify(h.textContent);
    if (taken.has(id) || (!h.id && doc?.getElementById(id) && doc.getElementById(id) !== h)) {
      let n = 2;
      while (taken.has(`${id}-${n}`) || doc?.getElementById(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    h.id = id;
    taken.add(id);
  }
  return headings;
}

/** The outline as <ol>: each H2 an item, its H3s in a nested <ol>. */
export function buildOutlineList(doc, headings) {
  const list = doc.createElement('ol');
  list.className = 'outline-list';
  let currentSub = null;
  for (const h of headings) {
    const li = doc.createElement('li');
    const a = doc.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent.trim();
    a.className = 'outline-link';
    li.appendChild(a);
    if (h.tagName === 'H3' && list.lastElementChild) {
      if (!currentSub) {
        currentSub = doc.createElement('ol');
        currentSub.className = 'outline-sublist';
        list.lastElementChild.appendChild(currentSub);
      }
      li.className = 'outline-item outline-item-sub';
      currentSub.appendChild(li);
    } else {
      li.className = 'outline-item';
      list.appendChild(li);
      currentSub = null;
    }
  }
  return list;
}

/**
 * Which heading is "in view": the last one whose top has scrolled to within
 * `offset` of the top of the viewport; the first before any has; the last
 * once the page is scrolled to the bottom.
 * @param {number[]} tops - each heading's top, relative to the viewport
 */
export function activeIndex(tops, offset, atBottom) {
  if (!tops.length) return -1;
  if (atBottom) return tops.length - 1;
  let active = 0;
  tops.forEach((top, i) => { if (top <= offset) active = i; });
  return active;
}

/**
 * Wires the outline into the page.
 * @param {{ content: Element, nav: Element, details: HTMLDetailsElement, wideQuery?: string, offset?: number }} opts
 */
export function initPageOutline({ content, nav, details, wideQuery = '(min-width: 900px)', offset = 120 }) {
  const doc = content.ownerDocument;
  const win = doc.defaultView;
  const headings = assignHeadingIds([...content.querySelectorAll('h2, h3')]);
  if (!headings.length) {
    nav.hidden = true;
    return;
  }
  const list = buildOutlineList(doc, headings);
  details.appendChild(list);
  const links = [...list.querySelectorAll('a')];

  // Desktop: always open (its summary is hidden). Narrow: collapsed until opened.
  const wide = win.matchMedia?.(wideQuery);
  const syncOpen = () => { details.open = !!wide?.matches; };
  syncOpen();
  wide?.addEventListener?.('change', syncOpen);

  let current = -1;
  const mark = (index) => {
    if (index === current) return;
    current = index;
    links.forEach((a, i) => {
      if (i === index) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };
  // A clicked item stays marked through its own jump: near the end of the
  // page, a short last section can't scroll to the top, and the scroll rule
  // alone would mark the one below it. The next scroll of the person's own
  // releases it.
  let pinned = null;
  let settling = false;
  let settleTimer = null;
  const settle = () => { settling = false; win.clearTimeout(settleTimer); };
  const update = () => {
    if (pinned !== null) {
      if (settling) return mark(pinned);
      pinned = null;
    }
    const tops = headings.map((h) => h.getBoundingClientRect().top);
    const atBottom = win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 2;
    mark(activeIndex(tops, offset, atBottom));
  };
  win.addEventListener('scrollend', settle);
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(() => { queued = false; update(); });
  };
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll);
  update();

  list.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    pinned = links.indexOf(link);
    settling = true;
    win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(settle, 1200); // if no scroll was needed, or no scrollend
    mark(pinned);
    // On a narrow screen, close the list once a section is chosen.
    if (!wide?.matches) details.open = false;
  });
}
