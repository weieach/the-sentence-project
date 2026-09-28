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
    logoAnimation.fromTo(header, { rowGap: '1.75rem' }, {
      rowGap: () => mobileHeader() ? '1rem' : '1.75rem',
      duration: 0.45,
      ease: 'power2.inOut',
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

const contactFooter = document.querySelector('body[data-page="home"] .contact-section');
if (contactFooter) {
  // The ending section fills the viewport space left by the current header and full footer.
  const syncContactFooterHeight = () => {
    document.body.style.setProperty('--contact-footer-height', `${contactFooter.getBoundingClientRect().height}px`);
  };
  syncContactFooterHeight();
  new ResizeObserver(syncContactFooterHeight).observe(contactFooter);
}

const dialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#password-form');
const passwordStatus = document.querySelector('#password-status');
const uploadForm = document.querySelector('#upload-form');
const adminDialog = document.querySelector('#admin-dialog');
const adminLoginForm = document.querySelector('#admin-login-form');
const adminLoginStatus = document.querySelector('#admin-login-status');
const adminEntries = document.querySelector('#admin-entries');
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

async function loadAdminEntries() {
  const status = document.querySelector('#admin-entries-status');
  const gate = document.querySelector('#admin-gate');
  const logout = document.querySelector('[data-admin-logout]');
  const count = document.querySelector('#admin-entry-count');
  count.textContent = '';
  adminEntries.replaceChildren();
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
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = entry.imageUrl;
        image.alt = entry.caption;
        image.loading = 'lazy';
        const caption = document.createElement('figcaption');
        const number = document.createElement('span');
        number.className = 'admin-entry-number';
        number.textContent = `${adminEntries.children.length + 1}.`;
        caption.append(number, ` ${entry.caption}`);
        figure.append(image, caption);
        const info = document.createElement('dl');
        const fields = [
          ['Your name', entry.name], ['Email address', entry.email],
          ['Sentence Project session attended', entry.session_attended],
          ['Sentence from the writing session', entry.sentence],
          ['Include name with photo caption?', entry.include_name ? 'Yes' : 'No'],
          ['Where are you from?', entry.hometown], ['Why write?', entry.why_write],
          ['Submitted', new Date(entry.created_at).toLocaleString()],
          ['Year', entry.year], ['Entry ID', entry.id],
        ];
        for (const [label, value] of fields) {
          if (value == null || (typeof value === 'string' && !value.trim())) continue;
          const term = document.createElement('dt');
          const answer = document.createElement('dd');
          term.textContent = label;
          answer.textContent = String(value);
          info.append(term, answer);
        }
        article.append(figure, info);
        adminEntries.append(article);
      }
      offset = result.nextOffset;
    } while (offset !== null);
    count.textContent = `(${adminEntries.children.length})`;
    status.textContent = adminEntries.children.length ? '' : 'No submissions yet.';
    logout.hidden = false;
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
  let offset = 0;
  try {
    let next;
    do {
      const result = await api(`/api/entries?offset=${offset}`);
      for (const entry of result.entries) {
        const figure = document.createElement('figure');
        const img = document.createElement('img');
        img.src = entry.imageUrl;
        img.alt = entry.caption;
        img.width = 900;
        img.height = 600;
        img.loading = offset === 0 && gallery.children.length < 2 ? 'eager' : 'lazy';
        img.decoding = 'async';
        const caption = document.createElement('figcaption');
        caption.textContent = [entry.caption, entry.displayName, entry.year].filter(Boolean).join(', ');
        figure.append(img, caption);
        gallery.append(figure);
      }
      next = result.nextOffset;
      offset = next;
      status.textContent = result.preview ? 'Layout preview using images from the project sketch. Submission storage is not connected yet.' : (gallery.children.length ? '' : 'No contributions yet.');
    } while (next !== null);
    if (gallery.querySelector('figure')) {
      document.querySelector('.gallery-ending').hidden = false;
    }
  } catch {
    status.textContent = 'The gallery could not be loaded. Please refresh to try again.';
    status.classList.add('error');
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
