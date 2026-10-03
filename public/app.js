// The about intro meets the header after 196px of scroll. Same point on every page.
const LOGO_SHRINK_AT = 196;

const header = document.querySelector('.site-header');
const brand = document.querySelector('.brand');
if (brand && window.gsap && window.ScrollTrigger && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.registerPlugin(ScrollTrigger);
  const logoOrigin = () => window.matchMedia('(max-width: 600px)').matches ? 'center top' : 'left top';
  const fitHeaderToLogo = () => {
    // Transforms do not change grid sizing; remove the space the smaller logo leaves behind.
    brand.style.marginBottom = `${brand.offsetHeight * (gsap.getProperty(brand, 'scaleY') - 1)}px`;
  };
  gsap.set(brand, { transformOrigin: logoOrigin() });
  const logoAnimation = gsap.timeline({
    scrollTrigger: {
      trigger: document.body,
      start: `top+=${LOGO_SHRINK_AT} top`,
      toggleActions: 'play none none reverse',
      invalidateOnRefresh: true,
    },
  });
  const mobileHeader = () => window.matchMedia('(max-width: 600px)').matches;
  logoAnimation.fromTo(brand, { scale: 1 }, {
    scale: () => mobileHeader() ? 0.7 : 0.8,
    duration: 0.45,
    ease: 'power2.inOut',
    onUpdate: fitHeaderToLogo,
  }, 0);
  const tagline = brand.querySelector('.tagline');
  if (tagline) {
    logoAnimation.fromTo(tagline, { autoAlpha: 1 }, {
      autoAlpha: 0,
      height: () => mobileHeader() ? 0 : tagline.offsetHeight,
      marginTop: () => mobileHeader() ? 0 : parseFloat(getComputedStyle(tagline).marginTop),
      overflow: 'hidden',
      duration: 0.3,
      ease: 'power2.out',
      onUpdate: fitHeaderToLogo,
    }, 0);
  }
  if (header) {
    gsap.fromTo(header, { '--header-line': 0 }, {
      '--header-line': 0.3,
      ease: 'none',
      scrollTrigger: {
        trigger: document.body,
        start: 'top top',
        end: `top+=${LOGO_SHRINK_AT} top`,
        scrub: true,
      },
    });
  }
  window.addEventListener('resize', () => {
    gsap.set(brand, { transformOrigin: logoOrigin() });
    fitHeaderToLogo();
  });
}

if (header) {
  const syncHeaderOffset = () => {
    // Reserve the expanded header's space so shrinking it cannot move the scroll trigger.
    const currentHeight = header.offsetHeight;
    const expandedHeight = currentHeight - (parseFloat(brand?.style.marginBottom) || 0);
    document.body.style.setProperty('--current-header-height', `${currentHeight}px`);
    document.body.style.setProperty('--header-height', `${expandedHeight}px`);
    document.body.style.paddingTop = `${expandedHeight}px`;
  };
  syncHeaderOffset();
  new ResizeObserver(syncHeaderOffset).observe(header);
  window.addEventListener('load', syncHeaderOffset);
}

const dialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#password-form');
const passwordStatus = document.querySelector('#password-status');
const uploadForm = document.querySelector('#upload-form');
const adminDialog = document.querySelector('#admin-dialog');
const adminLoginForm = document.querySelector('#admin-login-form');
const adminLoginStatus = document.querySelector('#admin-login-status');
const adminEntries = document.querySelector('#admin-entries');
const adminOrder = document.querySelector('#admin-order');
const changeOrder = document.querySelector('#change-order');
let orderDialogReady = false;
let adminListReady = false;
let orderingEntries = false;
let galleryEntries = [];
let returnFocus;
let adminReturnFocus;

function openPassword(trigger) {
  returnFocus = trigger || document.querySelector('[data-upload-link]');
  passwordStatus.textContent = '';
  passwordForm.reset();
  if (!dialog.open) dialog.showModal();
  document.querySelector('#password').focus();
}
function revealUpload() {
  document.querySelector('#upload-gate').hidden = true;
  uploadForm.hidden = false;
  for (const link of document.querySelectorAll('.site-nav > a:not(.nav-action)')) link.hidden = true;
  for (const action of document.querySelectorAll('.nav-action')) action.hidden = false;
}
for (const link of document.querySelectorAll('[data-upload-link]')) {
  link.addEventListener('click', (event) => { event.preventDefault(); openPassword(link); });
}
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { if (!adminDialog.open) returnFocus?.focus(); });
dialog.addEventListener('click', (event) => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});

function openAdminLogin(trigger) {
  adminReturnFocus = dialog.open ? returnFocus : trigger;
  if (dialog.open) dialog.close();
  adminLoginForm.reset();
  adminLoginStatus.textContent = '';
  if (!adminDialog.open) adminDialog.showModal();
  adminLoginForm.elements.username.focus();
}
for (const button of document.querySelectorAll('[data-admin-login]')) {
  button.addEventListener('click', () => openAdminLogin(button));
}
adminDialog.querySelector('.dialog-close').addEventListener('click', () => adminDialog.close());
adminDialog.addEventListener('close', () => adminReturnFocus?.focus());
adminDialog.addEventListener('click', event => {
  const box = adminDialog.getBoundingClientRect();
  if (event.target === adminDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) adminDialog.close();
});
adminLoginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = adminLoginForm.querySelector('[type="submit"]');
  button.disabled = true;
  adminLoginStatus.textContent = '';
  try {
    await api('/api/admin-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminLoginForm.elements.username.value, password: adminLoginForm.elements.password.value }),
    });
    adminLoginForm.reset();
    adminDialog.close();
    if (adminEntries) await loadAdminEntries();
    else window.location.assign('/admin.html');
  } catch (error) {
    adminLoginStatus.textContent = error.status ? error.message : 'Could not connect. Please try again.';
    adminLoginForm.elements.password.focus();
  } finally { button.disabled = false; }
});

function confirmDelete() {
  const confirmDialog = document.querySelector('#delete-dialog');
  confirmDialog.returnValue = '';
  return new Promise(resolve => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'delete'), { once: true });
    confirmDialog.showModal();
  });
}
function updateAdminCount() {
  document.querySelector('#admin-entry-count').textContent = `(${adminEntries.children.length})`;
  adminEntries.querySelectorAll('.admin-entry-number').forEach((number, index) => { number.textContent = `${index + 1}.`; });
  updateOrderControls();
}
function setAdminAction(button, label, icon) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('class', 'admin-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#ph-${icon}`);
  svg.append(use);
  button.replaceChildren(svg, document.createTextNode(label));
}
for (const button of document.querySelectorAll('[data-icon]')) {
  setAdminAction(button, button.textContent, button.dataset.icon);
}
function updateOrderControls() {
  if (!adminEntries) return;
  const entries = [...adminEntries.children];
  adminOrder.disabled = !adminListReady || Boolean(editingAdminEntry) || orderingEntries;
  changeOrder.disabled = adminOrder.disabled || !orderDialogReady || entries.length < 2;
  entries.forEach((article, index) => {
    article.querySelector('[data-move="up"]').disabled = !adminListReady || orderingEntries || index === 0;
    article.querySelector('[data-move="down"]').disabled = !adminListReady || orderingEntries || index === entries.length - 1;
  });
}
function getGalleryEntries() {
  return galleryEntries.filter(article => article.parentElement === adminEntries);
}
function applyAdminViewOrder() {
  const entries = getGalleryEntries();
  if (adminOrder.value && adminOrder.value !== 'custom') {
    const direction = adminOrder.value === 'oldest' ? 1 : -1;
    entries.sort((a, b) => direction * (
      a.dataset.createdAt.localeCompare(b.dataset.createdAt) || a.dataset.entryId.localeCompare(b.dataset.entryId)
    ));
  }
  adminEntries.append(...entries);
  updateAdminCount();
}
async function saveAdminOrder(order, entries) {
  if (!adminListReady || editingAdminEntry || orderingEntries) return false;
  orderingEntries = true;
  updateOrderControls();
  adminEntries.inert = true;
  const status = document.querySelector('#admin-entries-status');
  status.classList.remove('error');
  status.textContent = 'Saving gallery order...';
  try {
    await api('/api/admin-order', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, ...(entries && order === 'custom' ? { ids: entries.map(entry => entry.dataset.entryId) } : {}) }),
    });
    if (entries) {
      galleryEntries = [...entries];
      applyAdminViewOrder();
    } else if (!await loadAdminEntries()) return;
    status.textContent = '';
    return true;
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.status ? error.message : 'Could not save the order. Please try again.';
    if (error.status === 401) await loadAdminEntries();
    return false;
  } finally {
    orderingEntries = false;
    adminEntries.inert = false;
    updateOrderControls();
  }
}
function addOrderActions(article, details) {
  const actions = document.createElement('div');
  actions.className = 'entry-order-actions';
  for (const [direction, label] of [['up', 'Move up'], ['down', 'Move down']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entry-action';
    button.dataset.move = direction;
    setAdminAction(button, label, `arrow-${direction}`);
    button.disabled = true;
    button.addEventListener('click', async () => {
      const entries = [...adminEntries.children];
      const index = entries.indexOf(article);
      const destination = index + (direction === 'up' ? -1 : 1);
      if (destination < 0 || destination >= entries.length) return;
      [entries[index], entries[destination]] = [entries[destination], entries[index]];
      if (await saveAdminOrder('custom', entries)) {
        adminOrder.value = 'custom';
        applyAdminViewOrder();
      }
      const focusButton = button.disabled ? article.querySelector(`[data-move="${direction === 'up' ? 'down' : 'up'}"]`) : button;
      focusButton?.focus({ preventScroll: true });
    });
    actions.append(button);
  }
  details.append(actions);
}
const adminEditableFields = [
  ['name', 'Your name', 'text', 120, true],
  ['email', 'Email address', 'email', 254, true],
  ['session_attended', 'Sentence Project session attended', 'text', 200, true],
  ['sentence', 'Sentence from the writing session', 'textarea', 2000],
  ['include_name', 'Include name with photo caption?', 'select'],
  ['hometown', 'Where are you from?', 'text', 200],
  ['why_write', 'Why write?', 'textarea', 4000],
  ['year', 'Year', 'number'],
];
let editingAdminEntry = null;
function setEditingAdminEntry(article) {
  editingAdminEntry = article;
  for (const other of adminEntries.children) {
    other.classList.toggle('is-editing', other === article);
    other.inert = Boolean(article && other !== article);
  }
  updateOrderControls();
}
function entryInput(key, label, type, value, max, required = false) {
  const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  input.className = 'entry-editor';
  input.dataset.entryField = key;
  input.setAttribute('aria-label', label);
  if (type === 'select') {
    for (const [value, label] of [['true', 'Yes'], ['false', 'No']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      input.append(option);
    }
  } else if (type === 'textarea') {
    input.rows = Math.max(2, Math.min(8, String(value || '').split('\n').length + 1));
  } else input.type = type;
  if (max) input.maxLength = max;
  if (type === 'number') { input.min = '1000'; input.max = '9999'; input.step = '1'; required = true; }
  input.required = required;
  input.value = value ?? '';
  return input;
}
function renderEntryText(entry, article, editing = false) {
  const caption = article.querySelector('.admin-entry-caption');
  caption.replaceChildren(editing ? entryInput('caption', 'Photo caption', 'textarea', entry.caption, 500, true) : document.createTextNode(entry.caption));
  article.querySelector('img').alt = entry.caption;
  const info = article.querySelector('dl');
  info.replaceChildren();
  const fields = [...adminEditableFields];
  fields.splice(fields.length - 1, 0, ['created_at', 'Submitted', 'readonly']);
  fields.push(['id', 'Entry ID', 'readonly']);
  for (const [key, label, type, max, required] of fields) {
    const value = key === 'created_at' ? new Date(entry.created_at).toLocaleString() : entry[key];
    if (!editing && (value == null || (typeof value === 'string' && !value.trim()))) continue;
    const term = document.createElement('dt');
    term.textContent = label;
    const answer = document.createElement('dd');
    if (editing && type !== 'readonly') answer.append(entryInput(key, label, type, value, max, required));
    else answer.textContent = key === 'include_name' ? (value ? 'Yes' : 'No') : String(value ?? '');
    info.append(term, answer);
  }
}
function addEntryActions(entry, article, details) {
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  const toggle = document.createElement('button');
  const remove = document.createElement('button');
  const edit = document.createElement('button');
  const cancel = document.createElement('button');
  const save = document.createElement('button');
  for (const button of [toggle, remove, edit, cancel, save]) {
    button.type = 'button';
    button.className = 'entry-action';
  }
  let hidden = entry.is_hidden;
  article.classList.toggle('is-hidden', Boolean(hidden));
  remove.classList.add('entry-action-delete');
  setAdminAction(toggle, hidden ? 'Show' : 'Hide', hidden ? 'eye' : 'eye-slash');
  setAdminAction(remove, 'Delete', 'trash');
  setAdminAction(edit, 'Edit', 'pencil-simple');
  setAdminAction(cancel, 'Cancel', 'x');
  setAdminAction(save, 'Save', 'check');
  const message = document.createElement('p');
  message.className = 'status entry-action-status';
  message.setAttribute('role', 'status');
  actions.append(remove, toggle, edit);
  details.append(actions, message);
  const setBusy = busy => {
    for (const button of [toggle, remove, edit, cancel, save]) button.disabled = busy;
    for (const input of article.querySelectorAll('.entry-editor')) input.disabled = busy;
  };
  const reportError = async error => {
    message.classList.add('error');
    message.textContent = error.status ? error.message : 'Could not connect. Please try again.';
    if (error.status === 401) await loadAdminEntries();
  };
  const finishEditing = () => {
    setEditingAdminEntry(null);
    renderEntryText(entry, article);
    actions.replaceChildren(remove, toggle, edit);
    edit.focus();
  };
  edit.addEventListener('click', () => {
    if (editingAdminEntry) return;
    setEditingAdminEntry(article);
    renderEntryText(entry, article, true);
    actions.replaceChildren(cancel, save);
    message.classList.remove('error');
    message.textContent = '';
    article.querySelector('.entry-editor').focus();
  });
  cancel.addEventListener('click', () => {
    finishEditing();
    message.classList.remove('error');
    message.textContent = '';
  });
  save.addEventListener('click', async () => {
    const inputs = [...article.querySelectorAll('.entry-editor')];
    const why = inputs.find(input => input.dataset.entryField === 'why_write');
    why.setCustomValidity(why.value.trim().split(/\s+/u).filter(Boolean).length > 50 ? 'Please keep “Why write?” to 50 words or fewer.' : '');
    if (inputs.some(input => !input.reportValidity())) return;
    const values = Object.fromEntries(inputs.map(input => [input.dataset.entryField,
      input.dataset.entryField === 'include_name' ? input.value === 'true' : input.dataset.entryField === 'year' ? Number(input.value) : input.value]));
    setBusy(true);
    message.classList.remove('error');
    message.textContent = 'Saving...';
    try {
      const result = await api(`/api/admin-entries?id=${encodeURIComponent(entry.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: values }),
      });
      Object.assign(entry, result.entry);
      setBusy(false);
      finishEditing();
      message.textContent = 'Changes saved.';
    } catch (error) { await reportError(error); }
    finally { setBusy(false); }
  });
  toggle.addEventListener('click', async () => {
    setBusy(true);
    message.classList.remove('error');
    message.textContent = '';
    try {
      const result = await api(`/api/admin-entries?id=${encodeURIComponent(entry.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !hidden }),
      });
      hidden = result.hidden;
      entry.is_hidden = hidden;
      article.classList.toggle('is-hidden', Boolean(hidden));
      setAdminAction(toggle, hidden ? 'Show' : 'Hide', hidden ? 'eye' : 'eye-slash');
      showAdminToast(hidden ? 'Hidden from gallery.' : 'Visible in gallery.');
    } catch (error) { await reportError(error); }
    finally { setBusy(false); }
  });
  remove.addEventListener('click', async () => {
    if (!await confirmDelete()) return;
    setBusy(true);
    message.classList.remove('error');
    message.textContent = '';
    try {
      const result = await api(`/api/admin-entries?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      article.remove();
      updateAdminCount();
      const status = document.querySelector('#admin-entries-status');
      status.classList.toggle('error', Boolean(result.warning));
      status.textContent = result.warning || (adminEntries.children.length ? 'Submission deleted.' : 'No submissions yet.');
    } catch (error) { await reportError(error); }
    finally { setBusy(false); }
  });
}

let adminToastTimer;
function showAdminToast(message) {
  const toast = document.querySelector('#admin-toast');
  clearTimeout(adminToastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  adminToastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 5000);
}

async function loadAdminEntries() {
  const status = document.querySelector('#admin-entries-status');
  const gate = document.querySelector('#admin-gate');
  const logout = document.querySelector('[data-admin-logout]');
  const count = document.querySelector('#admin-entry-count');
  adminListReady = false;
  count.textContent = '';
  setEditingAdminEntry(null);
  adminEntries.replaceChildren();
  galleryEntries = [];
  gate.hidden = true;
  logout.hidden = true;
  status.classList.remove('error');
  status.textContent = 'Loading submissions...';
  try {
    let offset = 0;
    do {
      const result = await api(`/api/admin-entries?offset=${offset}`);
      for (const entry of result.entries) {
        const article = document.createElement('article');
        article.className = 'admin-entry';
        article.dataset.entryId = entry.id;
        article.dataset.createdAt = entry.created_at || '';
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = entry.imageUrl;
        image.alt = entry.caption;
        image.loading = 'lazy';
        const caption = document.createElement('figcaption');
        const number = document.createElement('span');
        number.className = 'admin-entry-number';
        number.textContent = `${adminEntries.children.length + 1}.`;
        const captionText = document.createElement('span');
        captionText.className = 'admin-entry-caption';
        caption.append(number, ' ', captionText);
        figure.append(image, caption);
        const info = document.createElement('dl');
        const details = document.createElement('div');
        details.className = 'admin-entry-details';
        details.append(info);
        addEntryActions(entry, article, details);
        addOrderActions(article, details);
        article.append(figure, details);
        renderEntryText(entry, article);
        article.inert = Boolean(editingAdminEntry);
        adminEntries.append(article);
      }
      offset = result.nextOffset;
    } while (offset !== null);
    adminListReady = true;
    galleryEntries = [...adminEntries.children];
    applyAdminViewOrder();
    status.textContent = adminEntries.children.length ? '' : 'No submissions yet.';
    logout.hidden = false;
    return true;
  } catch (error) {
    if (error.status === 401) {
      adminEntries.replaceChildren();
      status.textContent = 'Log in as an admin to view submissions.';
      gate.hidden = false;
      openAdminLogin(gate);
    } else {
      status.classList.add('error');
      status.textContent = error.status ? error.message : 'Could not load submissions. Please refresh to try again.';
      // Keep logout available when an authenticated storage request fails.
      logout.hidden = false;
    }
  }
}
if (adminEntries) {
  import('/reorder.js').then(({ initOrderDialog }) => {
    initOrderDialog({
      button: changeOrder,
      getEntries: getGalleryEntries,
      saveOrder: async (entries, order) => ({
        ok: await saveAdminOrder(order, entries),
        message: document.querySelector('#admin-entries-status').textContent,
        authenticated: adminListReady,
      }),
    });
    orderDialogReady = true;
    updateOrderControls();
  }).catch(() => {
    document.querySelector('#admin-entries-status').textContent = 'Could not load the order dialog. Refresh to try again.';
  });
  adminOrder.addEventListener('change', applyAdminViewOrder);
  loadAdminEntries();
  document.querySelector('[data-admin-logout]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/admin-session', { method: 'DELETE' });
      adminEntries.replaceChildren();
      window.location.replace('/');
    } catch {
      document.querySelector('#admin-entries-status').textContent = 'Could not log out. Please try again.';
    } finally { button.disabled = false; }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) loadAdminEntries(); });
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = passwordForm.querySelector('[type="submit"]');
  button.disabled = true;
  passwordStatus.textContent = '';
  try {
    await api('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: passwordForm.password.value }) });
    dialog.close();
    if (uploadForm) { revealUpload(); document.querySelector('#name').focus(); }
    else window.location.assign('/upload.html');
  } catch (error) {
    passwordStatus.textContent = error.status ? error.message : 'Could not connect. Please try again.';
    document.querySelector('#password').focus();
  } finally { button.disabled = false; }
});

async function loadGallery() {
  const gallery = document.querySelector('#gallery');
  const status = document.querySelector('#gallery-status');
  const loading = gallery.querySelector('.gallery-loading');
  const finishLoading = () => {
    loading?.remove();
    gallery.setAttribute('aria-busy', 'false');
  };
  let offset = 0;
  try {
    let next;
    do {
      const result = await api(`/api/entries?offset=${offset}`);
      const columns = Number(getComputedStyle(gallery).getPropertyValue('--gallery-columns'));
      const firstRowImages = [];
      for (const [index, entry] of result.entries.entries()) {
        const figure = document.createElement('figure');
        const img = document.createElement('img');
        img.src = entry.imageUrl;
        img.alt = entry.caption;
        img.width = 900;
        img.height = 600;
        const firstRow = offset === 0 && index < columns;
        img.loading = firstRow ? 'eager' : 'lazy';
        img.decoding = 'async';
        const caption = document.createElement('figcaption');
        caption.textContent = [entry.caption, entry.displayName, entry.year].filter(Boolean).join(', ');
        figure.append(img, caption);
        gallery.append(figure);
        if (firstRow) firstRowImages.push(img.decode().catch(() => {}));
      }
      if (offset === 0) {
        await Promise.all(firstRowImages);
        finishLoading();
      }
      next = result.nextOffset;
      offset = next;
      status.textContent = result.preview ? 'Layout preview using images from the project sketch. Submission storage is not connected yet.' : '';
    } while (next !== null);
    if (!gallery.querySelector('figure')) {
      const empty = document.createElement('div');
      empty.className = 'gallery-empty gallery-state';
      empty.setAttribute('role', 'status');
      const message = document.createElement('span');
      message.className = 'gallery-state-label';
      message.textContent = 'No contributions yet.';
      empty.append(message);
      gallery.append(empty);
    }
  } catch {
    status.textContent = 'The gallery could not be loaded. Please refresh to try again.';
    status.classList.add('error');
  } finally {
    finishLoading();
  }
}
if (document.querySelector('#gallery')) loadGallery();

if (uploadForm) {
  api('/api/session').then(({ authenticated }) => {
    if (authenticated) revealUpload(); else openPassword();
  }).catch(() => { document.querySelector('#upload-gate').textContent = 'Could not connect. Please refresh to try again.'; });
  const photo = document.querySelector('#photo');
  const preview = document.querySelector('#upload-preview');
  const why = document.querySelector('#whyWrite');
  let previewUrl;
  const photoName = document.querySelector('#photo-name');
  document.querySelector('.file-picker').addEventListener('click', () => photo.click());
  photo.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = true;
    photo.setCustomValidity('');
    const file = photo.files[0];
    photoName.textContent = file ? file.name : 'No file chosen';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      photo.setCustomValidity('Choose a JPG, PNG, or WebP image up to 4 MB.');
      photo.reportValidity();
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
  });
  why.addEventListener('input', () => {
    const count = why.value.trim().split(/\s+/u).filter(Boolean).length;
    document.querySelector('#word-count').textContent = `${count} / 50 words`;
    why.setCustomValidity(count > 50 ? 'Please keep your answer to 50 words or fewer.' : '');
  });
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!uploadForm.reportValidity()) return;
    const button = document.querySelector('[data-submit-upload]');
    const status = document.querySelector('#upload-status');
    button.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Uploading your contribution…';
    try {
      await api('/api/entries', { method: 'POST', body: new FormData(uploadForm) });
      window.location.assign('/');
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.status ? error.message : 'Could not connect. Your form is still here; please try again.';
      if (error.status === 401) openPassword();
    } finally { button.disabled = false; }
  });
}
