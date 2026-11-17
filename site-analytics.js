// Visitor analytics for the public pages: Google Analytics 4 + Microsoft Clarity.
// Open any page once with ?notrack=1 to stop counting your own visits on that
// browser (?notrack=0 turns counting back on). Never runs on localhost.
(function () {
  var GA_ID = 'G-Q65NVMNG67';
  var CLARITY_ID = ''; // Microsoft Clarity project ID; empty = Clarity off

  var host = location.hostname;
  if (!/(^|\.)toolflux\.co\.in$/.test(host)) return;

  try {
    var q = new URLSearchParams(location.search).get('notrack');
    if (q === '1') localStorage.setItem('tf_notrack', '1');
    if (q === '0') localStorage.removeItem('tf_notrack');
    if (localStorage.getItem('tf_notrack') === '1') return;
  } catch (e) {}

  function load(src) {
    var s = document.createElement('script');
    s.async = true; s.src = src;
    document.head.appendChild(s);
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_ID);
  load('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);

  if (CLARITY_ID) {
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    load('https://www.clarity.ms/tag/' + CLARITY_ID);
  }

  // The actions that matter: how visitors reach out, and Machlog sign-ups.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    var name =
      /wa\.me|whatsapp/i.test(href) ? 'contact_whatsapp' :
      /^tel:/i.test(href) ? 'contact_call' :
      /^mailto:/i.test(href) ? 'contact_email' :
      /machlog-app/i.test(href) ? 'machlog_start_trial' :
      a.hasAttribute('download') && /machining-log/i.test(href) ? 'machlog_download' :
      /instagram\.com|linkedin\.com|youtube\.com/i.test(href) ? 'social_click' : '';
    if (name) gtag('event', name, { link_text: (a.textContent || '').trim().slice(0, 60), page: location.pathname });
  }, true);
})();
