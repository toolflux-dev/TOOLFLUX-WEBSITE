// Pre-renders the blog articles (held in index.html's JS BLOGS array) into static,
// crawlable pages so Google can index the full text.
// Re-run after editing an article in index.html:   node build-blogs.js
const fs = require('fs');
const vm = require('vm');
const ROOT = require('path').resolve(process.argv[2] || __dirname) + '/';
const BASE = 'https://www.toolflux.co.in/';
const PUBLISHED = '2026-06-02'; // commit d2d5b8a, when the articles first shipped

const SLUGS = ['blog-insert-failure.html', 'blog-steel-vs-stainless.html', 'blog-deep-hole-drilling.html'];

// ── 1. Extract BLOGS from index.html ──
const idx = fs.readFileSync(ROOT + 'index.html', 'utf8');
const bStart = idx.indexOf('const BLOGS=');
const bFn = idx.indexOf('function openBlog', bStart);
const bEnd = idx.lastIndexOf('];', bFn) + 1;
const BLOGS = vm.runInNewContext(idx.slice(bStart + 'const BLOGS='.length, bEnd));
if (BLOGS.length !== SLUGS.length) throw new Error('Expected ' + SLUGS.length + ' articles, found ' + BLOGS.length);

// ── 2. Reuse nav + footer from contact.html (keeps logos, links identical) ──
const ct = fs.readFileSync(ROOT + 'contact.html', 'utf8');
let nav = ct.slice(ct.indexOf('<nav'), ct.indexOf('</nav>') + 6)
  .replace(/<a href="contact.html"\s*class="active">/, '<a href="contact.html">')
  .replace('<a href="index.html#blog">Blog</a>', '<a href="index.html#blog" class="active">Blog</a>');
const footer = ct.slice(ct.indexOf('<footer'), ct.indexOf('</footer>') + 9);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function describe(art) {
  const first = strip((art.match(/<p>([\s\S]*?)<\/p>/) || [, art])[1]);
  if (first.length <= 155) return first;
  return first.slice(0, 152).replace(/\s+\S*$/, '') + '…';
}

const CSS = `
body{padding-top:70px}
.bnav{max-width:760px;margin:0 auto;padding:2.2rem 1.5rem 0;font-size:.62rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.bnav a{color:var(--mut)}.bnav a:hover{color:var(--teal-dark)}.bnav span{margin:0 .5rem;opacity:.5}
.bhead{max-width:760px;margin:0 auto;padding:1.6rem 1.5rem 2rem;border-bottom:1px solid var(--rule)}
.bcat{display:inline-block;font-size:.55rem;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#fff;background:var(--teal-dark);padding:.25rem .7rem;border-radius:1px;margin-bottom:1.1rem}
.bhead h1{font-size:clamp(1.9rem,4.6vw,2.8rem);font-weight:800;letter-spacing:-.035em;line-height:1.08;color:var(--T);margin-bottom:.9rem}
.bmeta{font-size:.74rem;color:var(--mut)}
.bart{max-width:760px;margin:0 auto;padding:2.2rem 1.5rem 1rem}
.bart h2{font-size:1.18rem;font-weight:700;letter-spacing:-.02em;color:var(--T);margin:2.1rem 0 .7rem}
.bart p{font-size:1rem;line-height:1.85;color:var(--mid);margin-bottom:1.15rem}
.bart ul{padding-left:1.3rem;margin-bottom:1.2rem}
.bart li{font-size:1rem;line-height:1.75;color:var(--mid);margin-bottom:.45rem}
.bart strong{color:var(--T);font-weight:700}
.bcta{max-width:760px;margin:2rem auto 0;padding:0 1.5rem}
.bcta-in{background:var(--ink);color:#fff;padding:2rem;border-radius:2px;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}
.bcta-in strong{display:block;font-size:1.05rem;margin-bottom:.3rem}
.bcta-in span{font-size:.82rem;color:rgba(255,255,255,.65)}
.bcta-in a{background:var(--teal);color:#fff;font-size:.65rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;padding:.85rem 1.6rem;border-radius:1px;white-space:nowrap}
.bcta-in a:hover{background:var(--tm);color:#fff}
.bmore{max-width:760px;margin:0 auto;padding:3rem 1.5rem 4.5rem}
.bmore h3{font-size:.58rem;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:var(--mut);margin-bottom:1rem}
.bmore a{display:block;padding:1.1rem 0;border-top:1px solid var(--rule);font-size:1rem;font-weight:700;color:var(--T)}
.bmore a:hover{color:var(--teal-dark)}
.bmore small{display:block;font-size:.6rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--teal-dark);margin-bottom:.25rem}
@media(max-width:960px){.nm{display:none}nav{padding:1rem 1.5rem}}
`;

BLOGS.forEach((b, i) => {
  const slug = SLUGS[i];
  const url = BASE + slug;
  const desc = describe(b.art);
  const body = b.art.replace(/<h4>/g, '<h2>').replace(/<\/h4>/g, '</h2>');
  const readTime = (b.meta.match(/(\d+)\s*min/) || [, ''])[1];

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: b.title,
        description: desc,
        datePublished: PUBLISHED,
        dateModified: PUBLISHED,
        inLanguage: 'en',
        mainEntityOfPage: url,
        articleSection: b.cat,
        author: { '@type': 'Organization', name: 'TOOLFLUX', url: BASE },
        publisher: { '@type': 'Organization', name: 'TOOLFLUX', url: BASE }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: BASE },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: BASE + '#blog' },
          { '@type': 'ListItem', position: 3, name: b.title, item: url }
        ]
      }
    ]
  };

  const more = BLOGS.map((o, j) => j === i ? '' :
    `<a href="${SLUGS[j]}"><small>${esc(o.cat)}</small>${esc(o.title)}</a>`).join('\n    ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.title)} — TOOLFLUX</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(b.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="TOOLFLUX">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="shared.css">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
${nav}

<div class="bnav"><a href="index.html">Home</a><span>/</span><a href="index.html#blog">Blog</a><span>/</span>${esc(b.cat)}</div>

<header class="bhead">
  <div class="bcat">${esc(b.cat)}</div>
  <h1>${esc(b.title)}</h1>
  <div class="bmeta">TOOLFLUX Engineering · June 2026${readTime ? ' · ' + readTime + ' min read' : ''}</div>
</header>

<article class="bart">
${body}
</article>

<div class="bcta"><div class="bcta-in">
  <div><strong>Seeing this on your machine?</strong><span>Send your material, operation and machine. We'll reply with a specific fix.</span></div>
  <a href="https://wa.me/918660234766?text=${encodeURIComponent('Hi TOOLFLUX! I read "' + b.title + '" and have a question.')}" target="_blank" rel="noopener">WhatsApp Us</a>
</div></div>

<section class="bmore">
  <h3>More from the Machinist's Notebook</h3>
  ${more}
</section>

${footer}
</body>
</html>
`;
  fs.writeFileSync(ROOT + slug, html, 'utf8');
  console.log('OK  ' + slug.padEnd(30) + (fs.statSync(ROOT + slug).size / 1024).toFixed(1) + ' KB  | desc ' + desc.length + ' chars');
});
