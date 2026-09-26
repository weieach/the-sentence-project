const dialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#password-form');
const passwordStatus = document.querySelector('#password-status');
const uploadForm = document.querySelector('#upload-form');
let returnFocus;

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
}
for (const link of document.querySelectorAll('[data-upload-link]')) {
  link.addEventListener('click', (event) => { event.preventDefault(); openPassword(link); });
}
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => returnFocus?.focus());
dialog.addEventListener('click', (event) => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});

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
  photo.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = true;
    photo.setCustomValidity('');
    const file = photo.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      photo.setCustomValidity('Choose a JPG, PNG, or WebP image up to 8 MB.');
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
    const button = uploadForm.querySelector('[type="submit"]');
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
