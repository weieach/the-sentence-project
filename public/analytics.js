// Vercel serves this endpoint after Web Analytics is enabled and the site is deployed.
(() => {
  if (window.location.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;

  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.append(script);
})();
