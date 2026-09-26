// The shared upload password lives here. This file is NEVER served to browsers.
// Change it here, or override it with UPLOAD_PASSWORD in .env / your host settings.
export const UPLOAD_PASSWORD = globalThis.process?.env?.UPLOAD_PASSWORD || 'sentences-together';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const BUCKET = 'sentence-images';
