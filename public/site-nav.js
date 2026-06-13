// site-nav.js — keeps momni.com's navigation available inside app.momni.com.
// Desktop (≥961px): the familiar two-row purple ribbon above the app shell.
// Mobile: a 🌐 button (in the topbar when present) opening a full site menu.
// All pages: a condensed momni.com footer at the end of the content, above the tab bar.
(function () {
  // Lift the Tawk chat bubble above the 64px mobile tab bar so it never covers the Links/Me tabs.
  // This file is deferred, so it runs after the inline Tawk_API stub is created but before Tawk's
  // async widget finishes loading — the documented customStyle is read at init. (CSS fallback below.)
  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_API.customStyle = {
    visibility: {
      desktop: { position: 'br', xOffset: 20, yOffset: 20 },
      mobile:  { position: 'br', xOffset: 12, yOffset: 84 }
    }
  };
  var S = 'https://momni.com';
  var TOP = [
    ['Press', S + '/press/'], ['Partnerships', S + '/partnerships/'],
    ['Foundation', 'https://momnifoundation-878.netlify.app'],
    ['The Crisis', S + '/crisis/'], ['Volunteer', S + '/volunteer/']
  ];
  var MAIN = [
    ['Find Care', S + '/find-care/'], ['Become a Momni', S + '/become-a-momni/'],
    ['Circles', S + '/circles/'], ['Shop', S + '/shop/'], ['Map', S + '/map/'],
    ['Our Story', S + '/our-story/'], ['Stories', S + '/stories/'], ['Blog', S + '/blog/']
  ];
  var FOOT = [
    ['Find care', [['Find Care', '/find-care/'], ['Become a Momni', '/become-a-momni/'], ['Circles', '/circles/'], ['Map', '/map/'], ['Apps', '/apps/']]],
    ['Community', [['Team Momni', '/team/'], ['Volunteer', '/volunteer/'], ['Connect', '/connect/'], ['Share & invite', '/share/'], ['Partnerships', '/partnerships/']]],
    ['Stories', [['Stories', '/stories/'], ['Blog', '/blog/'], ['Newsletter', '/newsletter/'], ['Momni History', '/history/'], ['Podcast', '/podcast/'], ['FAQ', '/faq/']]],
    ['About', [['Our Story', '/our-story/'], ['Press', '/press/'], ['Shop', '/shop/'], ['Contact', '/contact/'], ['Transparency', '/transparency/'], ['Suggested Conduct', '/conduct/'], ['Terms', '/terms/'], ['Privacy', '/privacy/']]]
  ];
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  var css = el('style', {}, "\
.snv-ribbon{display:none}\
@media(min-width:961px){\
 body{padding-top:90px!important}\
 .snv-ribbon{display:block;position:fixed;top:0;left:0;right:0;z-index:700;font-family:'Albert Sans',sans-serif}\
 .snv-top{background:#4A3880}.snv-top .in{max-width:1120px;margin:0 auto;display:flex;justify-content:flex-end;gap:20px;height:34px;align-items:center;padding:0 24px}\
 .snv-top a{color:rgba(255,255,255,.8);font-size:13px;text-decoration:none}.snv-top a:hover{color:#fff}\
 .snv-main{background:#6D58A4}.snv-main .in{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:22px;height:56px;padding:0 24px}\
 .snv-main img{height:34px}\
 .snv-main a{color:#fff;font-size:14.5px;font-weight:500;text-decoration:none}.snv-main a:hover{color:#92E2C1}\
 .snv-main .cta{margin-left:auto;background:#92E2C1;color:#0B4A36;font-weight:700;border-radius:100px;padding:8px 18px;font-size:13.5px}\
 .snv-btn{display:none!important}\
}\
.snv-btn{background:none;border:none;font-size:20px;cursor:pointer;padding:4px 6px;line-height:1}\
.snv-btn.floating{position:fixed;top:14px;right:14px;z-index:710;background:rgba(255,255,255,.94);border:1.5px solid #E5E0F0;border-radius:50%;width:38px;height:38px;box-shadow:0 4px 14px rgba(43,34,51,.15)}\
.snv-panel{position:fixed;inset:0;background:rgba(43,34,51,.45);z-index:800;display:none}\
.snv-panel.open{display:block}\
.snv-sheet{position:absolute;top:0;right:0;bottom:0;width:300px;max-width:86vw;background:#fff;overflow:auto;padding:18px 20px 30px;font-family:'Albert Sans',sans-serif}\
.snv-sheet .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}\
.snv-sheet .hd img{height:28px}\
.snv-sheet .x{background:#F5F0FE;border:none;border-radius:50%;width:30px;height:30px;font-size:15px;cursor:pointer}\
.snv-sheet h5{font-family:'Montserrat',sans-serif;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#6D58A4;margin:16px 0 6px}\
.snv-sheet a{display:block;padding:6px 0;color:#2B2233;font-size:14.5px;text-decoration:none}\
.snv-sheet a:hover{color:#0D878F}\
.snv-foot{font-family:'Albert Sans',sans-serif;background:#2B2233;color:rgba(255,255,255,.8);margin-top:34px;padding:26px 20px 90px;border-radius:18px 18px 0 0}\
.snv-foot .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px 18px;max-width:480px;margin:0 auto}\
.snv-foot h5{font-family:'Montserrat',sans-serif;color:#fff;font-size:12px;margin:0 0 8px}\
.snv-foot a{display:block;color:rgba(255,255,255,.6);font-size:12.5px;text-decoration:none;margin-bottom:6px}\
.snv-foot a:hover{color:#92E2C1}\
.snv-foot .disc{max-width:900px;margin:18px auto 0;border-top:1px solid rgba(255,255,255,.15);padding-top:14px;font-size:11px;color:rgba(255,255,255,.45);line-height:1.6;text-align:center}\
@media(max-width:600px){\
 iframe[title='chat widget'],iframe[title='chat widget minimized']{bottom:84px!important}\
}\
");
  document.head.appendChild(css);

  // desktop ribbon
  var ribbon = el('div', { class: 'snv-ribbon' },
    '<div class="snv-top"><div class="in">' + TOP.map(function (l) { return '<a href="' + l[1] + '">' + l[0] + '</a>'; }).join('') + '</div></div>' +
    '<div class="snv-main"><div class="in"><a href="' + S + '"><img src="/assets/momni-logo-white-horizontal.png" alt="Momni"></a>' +
    MAIN.map(function (l) { return '<a href="' + l[1] + '">' + l[0] + '</a>'; }).join('') +
    '<a class="cta" href="' + S + '">momni.com →</a></div></div>');
  document.body.insertBefore(ribbon, document.body.firstChild);

  // mobile menu panel
  var panel = el('div', { class: 'snv-panel', role: 'dialog', 'aria-label': 'momni.com menu' },
    '<div class="snv-sheet"><div class="hd"><img src="/assets/momni-logo-color-horizontal.png" alt="Momni"><button class="x" aria-label="Close">✕</button></div>' +
    FOOT.map(function (g) {
      return '<h5>' + g[0] + '</h5>' + g[1].map(function (l) { return '<a href="' + S + l[1] + '">' + l[0] + '</a>'; }).join('');
    }).join('') + '</div>');
  document.body.appendChild(panel);
  panel.addEventListener('click', function (e) { if (e.target === panel || e.target.classList.contains('x')) panel.classList.remove('open'); });

  // the 🌐 button — into the app topbar when present, floating otherwise
  var btn = el('button', { class: 'snv-btn', 'aria-label': 'Menu', title: 'Menu' },
    "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#4A3880' stroke-width='2.2' stroke-linecap='round' aria-hidden='true'><line x1='3' y1='6' x2='21' y2='6'/><line x1='3' y1='12' x2='21' y2='12'/><line x1='3' y1='18' x2='21' y2='18'/></svg>");
  btn.addEventListener('click', function () { panel.classList.add('open'); });
  var topbar = document.querySelector('.topbar');
  if (topbar) topbar.appendChild(btn); else { btn.classList.add('floating'); document.body.appendChild(btn); }

  // condensed momni.com footer at end of content (above the fixed tab bar)
  var foot = el('div', { class: 'snv-foot' },
    '<div class="cols">' + FOOT.map(function (g) {
      return '<div><h5>' + g[0] + '</h5>' + g[1].map(function (l) { return '<a href="' + S + l[1] + '">' + l[0] + '</a>'; }).join('') + '</div>';
    }).join('') + '</div>' +
    '<div class="disc">Momni is a community platform — Momnis make their own care decisions and pay each other directly.<br>momni.com &amp; app.momni.com are operated by Momni, Inc. The Momni Foundation (momnifoundation.org) is a separate 501(c)(3). One brand, two entities, separate finances.</div>');
  var host = document.querySelector('.content') || document.querySelector('.app') || document.body;
  host.appendChild(foot);

  // Tawk chat bubble vs. the mobile tab bar: Tawk loads async and its launcher iframe is a title-less
  // position:fixed element with a random id sitting at bottom:~20px — right on top of the Links/Me
  // tabs at 375px. customStyle (set above) only applies if it loads before Tawk inits, which isn't
  // guaranteed. So, on small viewports, lift every fixed Tawk iframe once, above the 64px tab bar.
  function liftTawk() {
    if (window.innerWidth > 600) return;
    document.querySelectorAll('iframe').forEach(function (f) {
      if (f.dataset.snvLifted || getComputedStyle(f).position !== 'fixed') return;
      var b = parseInt(getComputedStyle(f).bottom, 10) || 0;
      f.style.setProperty('bottom', (b + 72) + 'px', 'important');  // clear the 64px tabbar + margin
      f.dataset.snvLifted = '1';
    });
  }
  liftTawk();
  if (window.MutationObserver) {
    var t, obs = new MutationObserver(function () { clearTimeout(t); t = setTimeout(liftTawk, 120); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  [800, 1800, 3500].forEach(function (ms) { setTimeout(liftTawk, ms); });  // backstop for slow async load
  window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(liftTawk, 150); });
})();
