import { MAX_IMAGE_BYTES } from './config.js';
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validateEntryId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Invalid submission ID.');
  }
  return value;
}
export function validateSubmission(form) {
  function text(name, max, required = false) {
    const raw = form.get(name);
    if (raw !== null && typeof raw !== 'string') throw new HttpError(400, `Invalid ${name}.`);
    const value = (raw || '').trim();
    if ((required && !value) || value.length > max) throw new HttpError(400, `Please check the ${name} field.`);
    return value;
  }
  const name = text('name', 120, true);
  const email = text('email', 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const session = text('session', 200, true);
  const caption = text('caption', 500, true);
  const includeName = text('includeName', 3, true);
  if (!['yes', 'no'].includes(includeName)) throw new HttpError(400, 'Please choose whether to include your name.');
  const sentence = text('sentence', 2000);
  const hometown = text('hometown', 200);
  const whyWrite = text('whyWrite', 4000);
  if (whyWrite.split(/\s+/u).filter(Boolean).length > 50) throw new HttpError(400, 'Please keep “Why write?” to 50 words or fewer.');
  const photo = form.get('photo');
  if (!photo || typeof photo.arrayBuffer !== 'function' || !photo.size || photo.size > MAX_IMAGE_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
    throw new HttpError(400, 'Choose a JPG, PNG, or WebP image up to 4 MB.');
  }
  return { record: { name, email, session_attended: session, caption, include_name: includeName === 'yes', sentence, hometown, why_write: whyWrite }, photo };
}
export function checkImage(bytes, mime) {
  const matches = (signature, offset = 0) => signature.every((value, i) => bytes[offset + i] === value);
  const valid = mime === 'image/jpeg' ? matches([0xff, 0xd8, 0xff])
    : mime === 'image/png' ? matches([137, 80, 78, 71, 13, 10, 26, 10])
    : matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8);
  if (!valid) throw new HttpError(400, 'The selected file is not a supported image.');
}
