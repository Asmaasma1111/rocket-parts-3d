// DOM side of the explorer: loading screen, info card, view toggle,
// buttons, parts list and colour legend. The 3D side lives in main.js and
// talks to this module through the handlers passed to createUI().

import { PARTS, SYSTEMS } from './parts.js';

const WHERE = {
  external: ['جزء خارجي', 'External'],
  internal: ['جزء داخلي', 'Internal'],
  both: ['خارجي وداخلي', 'External and internal'],
};

const SEPARATE_LABEL = ['فصل المراحل', 'Separate stages'];
const REASSEMBLE_LABEL = ['إعادة التجميع', 'Reassemble'];

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// "Arabic · English" with the English part marked as left to right.
function bilingual(ar, en, cls = 'lbl') {
  return el('span', { class: cls }, [
    el('span', { class: 'ar', text: ar }),
    el('span', { class: 'sep', 'aria-hidden': 'true', text: ' · ' }),
    el('span', { class: 'en', lang: 'en', dir: 'ltr', text: en }),
  ]);
}

export function createUI(handlers) {
  const loader = $('#loader');
  const bar = $('.progress-bar', loader);
  const topbar = $('.topbar');
  const bottom = $('.bottom');
  const controls = $('.controls');
  const card = $('#card');
  const hint = $('#hint');
  const legend = $('#legend');
  const partsButton = $('#parts-button');
  const partsPanel = $('#parts-panel');
  const separateButton = $('#separate');
  const autoButton = $('#autorotate');
  const resetButton = $('#reset');
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const narrowQuery = matchMedia('(max-width: 640px)');
  const touchQuery = matchMedia('(hover: none)');

  // ----- hint ----------------------------------------------------------
  if (touchQuery.matches) {
    $('.hint-ar', hint).textContent = 'المس أي جزء لتعرف اسمه ووظيفته';
    $('.hint-en', hint).textContent = 'Tap any part';
  }
  let hintVisible = true;
  function hideHint() {
    if (!hintVisible) return;
    hintVisible = false;
    hint.classList.add('is-gone');
  }

  // ----- view toggle (radio group with arrow keys) -----------------------
  function setView(view) {
    for (const b of viewButtons) {
      const on = b.dataset.view === view;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    legend.hidden = view !== 'inside';
    if (legend.hidden) handlers.onSystemPreview(null);
  }
  for (const b of viewButtons) {
    b.addEventListener('click', () => handlers.onViewChange(b.dataset.view));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const i = viewButtons.indexOf(b);
      const next = viewButtons[(i + 1) % viewButtons.length];
      next.focus();
      handlers.onViewChange(next.dataset.view);
    });
  }

  // ----- buttons ---------------------------------------------------------
  separateButton.addEventListener('click', () => handlers.onSeparateToggle());
  autoButton.addEventListener('click', () => handlers.onAutoRotateToggle());
  resetButton.addEventListener('click', () => handlers.onResetView());

  function setSeparated(separated) {
    const [ar, en] = separated ? REASSEMBLE_LABEL : SEPARATE_LABEL;
    $('.ar', separateButton).textContent = ar;
    $('.en', separateButton).textContent = en;
    separateButton.setAttribute('aria-pressed', String(separated));
  }

  function setAutoRotate(on) {
    autoButton.setAttribute('aria-pressed', String(on));
  }

  // ----- parts list --------------------------------------------------------
  const list = $('.parts-list', partsPanel);
  for (const [sysId, sys] of Object.entries(SYSTEMS)) {
    const items = PARTS.filter((p) => p.system === sysId);
    const ul = el('ul', { role: 'list' });
    for (const p of items) {
      const btn = el('button', { type: 'button', class: 'part-item', 'data-part': p.id }, [
        el('span', { class: 'item-ar', text: p.ar }),
        el('span', { class: 'item-en', lang: 'en', dir: 'ltr', text: p.en }),
      ]);
      btn.addEventListener('mouseenter', () => handlers.onPartPreview(p.id));
      btn.addEventListener('mouseleave', () => handlers.onPartPreview(null));
      btn.addEventListener('focus', () => handlers.onPartPreview(p.id));
      btn.addEventListener('blur', () => handlers.onPartPreview(null));
      btn.addEventListener('click', () => {
        handlers.onPartSelect(p.id);
        if (narrowQuery.matches) closeParts(false);
      });
      ul.append(el('li', {}, [btn]));
    }
    const heading = el('h3', { class: 'group-title', style: `--c:${sys.color}` }, [
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      bilingual(sys.ar, sys.en),
    ]);
    list.append(el('section', { class: 'group' }, [heading, ul]));
  }

  // The list hangs below the title and stops above the bottom controls.
  function positionParts() {
    const top = Math.ceil($('.brand').getBoundingClientRect().bottom) + 8;
    partsPanel.style.top = `${top}px`;
    partsPanel.style.maxHeight = `${Math.max(160, controls.getBoundingClientRect().top - top - 12)}px`;
  }
  addEventListener('resize', () => {
    if (!partsPanel.hidden) positionParts();
  });

  function openParts() {
    partsPanel.hidden = false;
    positionParts();
    partsButton.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => partsPanel.classList.add('is-open'));
  }
  function closeParts(returnFocus = true) {
    partsPanel.classList.remove('is-open');
    partsPanel.hidden = true;
    partsButton.setAttribute('aria-expanded', 'false');
    handlers.onPartPreview(null);
    if (returnFocus) partsButton.focus();
  }
  partsButton.addEventListener('click', () => (partsPanel.hidden ? openParts() : closeParts(false)));
  partsPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeParts(true);
    }
    // Up and down arrows move between items as a convenience.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...partsPanel.querySelectorAll('.part-item')];
      const i = items.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      const j = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items[j].focus();
    }
  });

  // ----- legend --------------------------------------------------------
  for (const [sysId, sys] of Object.entries(SYSTEMS)) {
    const chip = el('button', { type: 'button', class: 'legend-chip', style: `--c:${sys.color}` }, [
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', { class: 'legend-text' }, [
        el('span', { class: 'ar', text: sys.ar }),
        el('span', { class: 'en', lang: 'en', dir: 'ltr', text: sys.en }),
      ]),
    ]);
    chip.addEventListener('mouseenter', () => handlers.onSystemPreview(sysId));
    chip.addEventListener('mouseleave', () => handlers.onSystemPreview(null));
    chip.addEventListener('focus', () => handlers.onSystemPreview(sysId));
    chip.addEventListener('blur', () => handlers.onSystemPreview(null));
    // A tap on a touch screen focuses the chip, which keeps the highlight
    // until the student taps somewhere else.
    chip.addEventListener('click', () => chip.focus());
    legend.append(chip);
  }

  // ----- info card -----------------------------------------------------
  const cardClose = $('.card-close', card);
  cardClose.addEventListener('click', () => handlers.onCardClose());
  let cardPart = null;

  function fillCard(part) {
    const sys = SYSTEMS[part.system];
    card.style.setProperty('--c', sys.color);
    $('.chip-ar', card).textContent = sys.ar;
    $('.chip-en', card).textContent = sys.en;
    $('.card-ar', card).textContent = part.ar;
    $('.card-en', card).textContent = part.en;
    $('.card-role', card).textContent = part.role;
    const [ar, en] = WHERE[part.where];
    $('.tag-ar', card).textContent = ar;
    $('.tag-en', card).textContent = en;
  }

  // Obstacles the floating card must avoid, as left and right limits.
  function horizontalLimits() {
    let left = 12;
    let right = innerWidth - 12;
    if (!legend.hidden) left = Math.max(left, legend.getBoundingClientRect().right + 12);
    if (!partsPanel.hidden) right = Math.min(right, partsPanel.getBoundingClientRect().left - 12);
    return { left, right };
  }

  function placeCard(anchor) {
    const { top, bottom: bottomInset } = insets();
    if (narrowQuery.matches) {
      // Bottom sheet just above the controls. main.js slides the picture up
      // so the selected part stays visible above it.
      card.classList.add('is-sheet');
      card.style.left = '';
      card.style.right = '';
      card.style.top = 'auto';
      card.style.bottom = `${Math.ceil(innerHeight - controls.getBoundingClientRect().top) + 8}px`;
      return;
    }
    card.classList.remove('is-sheet');
    card.style.bottom = 'auto';
    card.style.right = 'auto';
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const { left: minX, right: maxX } = horizontalLimits();
    const r = anchor?.rect;
    const p = anchor?.pointer;
    const gap = 24;
    let x;
    if (r) {
      const spaceRight = maxX - r.right;
      const spaceLeft = r.left - minX;
      if (spaceRight >= cw + gap && spaceRight >= spaceLeft) x = r.right + gap;
      else if (spaceLeft >= cw + gap) x = r.left - gap - cw;
      else if (spaceRight >= cw + gap) x = r.right + gap;
      else x = (p ? p.x : innerWidth / 2) > innerWidth / 2 ? (p ? p.x : r.left) - gap - cw : (p ? p.x : r.right) + gap;
    } else if (p) {
      x = p.x + gap;
    } else {
      x = (innerWidth - cw) / 2;
    }
    const cy = p ? p.y : r ? (r.top + r.bottom) / 2 : innerHeight / 2;
    let y = cy - ch / 2;
    x = Math.min(Math.max(x, minX), maxX - cw);
    y = Math.min(Math.max(y, top), innerHeight - bottomInset - ch);
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(Math.max(top, y))}px`;
  }

  function showCard(partId, anchor, pinned) {
    const part = PARTS.find((p) => p.id === partId);
    if (!part) return;
    // On a phone the open list fills the screen; previews only light the part.
    if (narrowQuery.matches && !partsPanel.hidden && !pinned) {
      hideCard();
      return;
    }
    if (cardPart !== partId) {
      fillCard(part);
      cardPart = partId;
    }
    card.classList.toggle('is-pinned', !!pinned);
    cardClose.hidden = !pinned;
    card.hidden = false;
    placeCard(anchor);
    card.classList.add('is-visible');
  }

  // Screen rectangle of the card when it is shown as a bottom sheet.
  function sheetRect() {
    if (card.hidden || !card.classList.contains('is-sheet')) return null;
    return card.getBoundingClientRect();
  }

  function moveCard(anchor) {
    if (!card.hidden) placeCard(anchor);
  }

  function hideCard() {
    cardPart = null;
    card.classList.remove('is-visible', 'is-pinned');
    card.hidden = true;
  }

  // ----- layout --------------------------------------------------------
  // Screen space taken by the header and by the bottom controls, so the
  // camera can frame the rocket in the space between them.
  function insets() {
    const top = Math.ceil(topbar.getBoundingClientRect().bottom) + 8;
    const bottomTop = bottom.getBoundingClientRect().top;
    const bottomInset = Math.ceil(innerHeight - bottomTop) + 10;
    return { top, bottom: bottomInset };
  }

  // Keep a CSS variable with the bottom bar height for the bottom sheet.
  const ro = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--bottom-h', `${Math.ceil(bottom.offsetHeight)}px`);
  });
  ro.observe(bottom);

  // ----- keyboard --------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') handlers.onEscape();
  });

  // ----- loading ---------------------------------------------------------
  let progress = 0;
  function setProgress(p) {
    progress = Math.max(progress, Math.min(1, p));
    bar.style.transform = `scaleX(${progress})`;
  }

  function finishLoading(reducedMotion) {
    setProgress(1);
    document.getElementById('app').inert = false;
    document.body.classList.add('is-ready');
    if (reducedMotion) {
      loader.hidden = true;
      return;
    }
    loader.classList.add('is-done');
    setTimeout(() => (loader.hidden = true), 650);
  }

  function showError() {
    loader.classList.add('has-error');
    $('.loader-error', loader).hidden = false;
  }

  return {
    setProgress,
    finishLoading,
    showError,
    setView,
    setSeparated,
    setAutoRotate,
    showCard,
    moveCard,
    hideCard,
    sheetRect,
    hideHint,
    insets,
    get partsOpen() {
      return !partsPanel.hidden;
    },
    closeParts,
  };
}
