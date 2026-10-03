// Keep selected entries in their relative order when moving them as a group.
export function moveSelection(items, selected, target, after = false) {
  if (selected.has(target)) return [...items];
  const moving = items.filter(item => selected.has(item));
  const remaining = items.filter(item => !selected.has(item));
  if (!moving.length) return [...items];
  const index = target === null ? remaining.length : remaining.indexOf(target);
  if (index < 0) return [...items];
  remaining.splice(index + (target !== null && after ? 1 : 0), 0, ...moving);
  return remaining;
}

export function initOrderDialog({ button, getEntries, saveOrder }) {
  const dialog = document.querySelector('#reorder-dialog');
  const grid = document.querySelector('#reorder-grid');
  const status = document.querySelector('#reorder-status');
  const save = document.querySelector('#reorder-save');
  const cancel = document.querySelector('#reorder-cancel');
  const sort = document.querySelector('#reorder-sort');
  let items = [];
  let articles = new Map();
  let selected = new Set();
  let anchor = null;
  let drag = null;
  let drop = null;
  let ghost = null;
  let frame = null;
  let suppressClick = false;
  let saving = false;

  function announce() {
    status.classList.remove('error');
    status.textContent = selected.size ? `${selected.size} selected` : '';
  }
  function updateSelection() {
    for (const card of grid.children) card.setAttribute('aria-pressed', String(selected.has(card.dataset.id)));
    announce();
  }
  function render(focusId) {
    grid.replaceChildren(...items.map((id, index) => {
      const article = articles.get(id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'reorder-card';
      card.dataset.id = id;
      card.setAttribute('aria-pressed', String(selected.has(id)));
      const caption = article.querySelector('.admin-entry-caption').textContent;
      card.setAttribute('aria-label', `${index + 1}. ${caption}`);
      card.title = caption;
      const image = document.createElement('img');
      image.src = article.querySelector('img').src;
      image.alt = '';
      image.draggable = false;
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${caption}`;
      card.append(image, label);
      return card;
    }));
    if (focusId) [...grid.children].find(card => card.dataset.id === focusId)?.focus({ preventScroll: true });
  }
  button.addEventListener('click', () => {
    articles = new Map(getEntries().map(article => [article.dataset.entryId, article]));
    items = [...articles.keys()];
    selected = new Set();
    anchor = null;
    suppressClick = false;
    sort.value = '';
    render();
    announce();
    dialog.showModal();
    grid.scrollTop = 0;
  });
  sort.addEventListener('change', () => {
    if (saving) return;
    const direction = sort.value === 'oldest' ? 1 : -1;
    items.sort((a, b) => direction * (
      articles.get(a).dataset.createdAt.localeCompare(articles.get(b).dataset.createdAt) || a.localeCompare(b)
    ));
    selected.clear();
    anchor = null;
    render();
    announce();
    grid.scrollTop = 0;
  });
  grid.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return; }
    const card = event.target.closest('.reorder-card');
    if (!card || saving) return;
    const id = card.dataset.id;
    if (event.shiftKey && anchor && items.includes(anchor)) {
      const [first, last] = [items.indexOf(anchor), items.indexOf(id)].sort((a, b) => a - b);
      items.slice(first, last + 1).forEach(item => selected.add(item));
    } else {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      anchor = id;
    }
    updateSelection();
  });
  grid.addEventListener('keydown', event => {
    const card = event.target.closest('.reorder-card');
    if (!card || saving || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const id = card.dataset.id;
    if (!selected.has(id)) selected = new Set([id]);
    const backwards = ['ArrowLeft', 'ArrowUp'].includes(event.key);
    const indices = items.map((item, index) => selected.has(item) ? index : -1).filter(index => index >= 0);
    const target = items[backwards ? Math.min(...indices) - 1 : Math.max(...indices) + 1];
    if (target === undefined) return;
    items = moveSelection(items, selected, target, !backwards);
    sort.value = '';
    render(id);
    announce();
  });
  function clearDrop() {
    grid.querySelectorAll('.drop-before, .drop-after').forEach(card => card.classList.remove('drop-before', 'drop-after'));
    drop = null;
  }
  function locateDrop(x, y) {
    clearDrop();
    const bounds = grid.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const card = document.elementFromPoint(x, y)?.closest('.reorder-card');
    if (card && grid.contains(card)) {
      if (selected.has(card.dataset.id)) return;
      const rect = card.getBoundingClientRect();
      const after = x > rect.left + rect.width / 2;
      drop = { target: card.dataset.id, after };
      card.classList.add(after ? 'drop-after' : 'drop-before');
    } else if (grid.lastElementChild && y > grid.lastElementChild.getBoundingClientRect().bottom) {
      drop = { target: null, after: true };
      grid.lastElementChild.classList.add('drop-after');
    }
  }
  function scrollWhileDragging() {
    if (!drag?.active) return;
    const rect = grid.getBoundingClientRect();
    const speed = drag.y < rect.top + 40 ? -10 : drag.y > rect.bottom - 40 ? 10 : 0;
    if (speed && drag.x >= rect.left && drag.x <= rect.right) {
      grid.scrollTop += speed;
      locateDrop(drag.x, drag.y);
    }
    frame = requestAnimationFrame(scrollWhileDragging);
  }
  function stopDrag() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    ghost?.remove();
    ghost = null;
    grid.querySelectorAll('.is-dragging').forEach(card => card.classList.remove('is-dragging'));
    clearDrop();
    drag = null;
  }
  grid.addEventListener('pointerdown', event => {
    const card = event.target.closest('.reorder-card');
    if (!card || saving || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    drag = { card, id: card.dataset.id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    card.setPointerCapture(event.pointerId);
  });
  grid.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    if (!drag.active) {
      drag.active = true;
      if (!selected.has(drag.id)) selected = new Set([drag.id]);
      updateSelection();
      for (const card of grid.children) card.classList.toggle('is-dragging', selected.has(card.dataset.id));
      ghost = document.createElement('div');
      ghost.className = 'reorder-drag-preview';
      ghost.textContent = `${selected.size} ${selected.size === 1 ? 'submission' : 'submissions'}`;
      dialog.append(ghost);
      frame = requestAnimationFrame(scrollWhileDragging);
    }
    event.preventDefault();
    ghost.style.left = `${drag.x + 12}px`;
    ghost.style.top = `${drag.y + 12}px`;
    locateDrop(drag.x, drag.y);
  });
  grid.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { active, id } = drag;
    if (active && drop) {
      items = moveSelection(items, selected, drop.target, drop.after);
      sort.value = '';
    }
    stopDrag();
    if (active) {
      suppressClick = true;
      render(id);
      announce();
    }
  });
  grid.addEventListener('pointercancel', stopDrag);
  grid.addEventListener('lostpointercapture', stopDrag);
  grid.addEventListener('dragstart', event => event.preventDefault());
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { stopDrag(); button.focus(); });
  save.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    save.disabled = cancel.disabled = sort.disabled = true;
    grid.inert = true;
    status.classList.remove('error');
    status.textContent = 'Saving order...';
    try {
      const result = await saveOrder(items.map(id => articles.get(id)), sort.value || 'custom');
      if (result.ok || result.authenticated === false) dialog.close();
      else { status.classList.add('error'); status.textContent = result.message || 'Could not save. Please try again.'; }
    } catch {
      status.classList.add('error');
      status.textContent = 'Could not save. Your changes are still here; please try again.';
    } finally {
      saving = false;
      save.disabled = cancel.disabled = sort.disabled = false;
      grid.inert = false;
    }
  });
}
