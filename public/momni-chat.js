/* momni-chat.js — "Chat with Karmel": Momni's own chat bubble.
   One script tag on any page (momni.com or the app). Messages POST to the app's /api/support and are
   texted to the founder's phone with the visitor's number, so she replies from her own phone. */
(function(){
  if (window.__momniChat) return; window.__momniChat = true;
  var me = document.currentScript, base = '';
  try { base = new URL(me.src, location.href).origin; } catch(e){}
  var FOUNDER_TEL = '+18014279293', FOUNDER = 'Karmel';
  var css = "\
#mc-root{position:fixed;right:16px;bottom:18px;z-index:2147483000;font-family:'Albert Sans',Helvetica,Arial,sans-serif;color:#2B2233}\
#mc-root.mc-tabs{bottom:88px}\
@media(min-width:961px){#mc-root.mc-tabs{bottom:18px}}\
#mc-btn{display:flex;align-items:center;gap:9px;background:#6D58A4;color:#fff;border:none;border-radius:100px;padding:11px 18px 11px 12px;font:600 14px/1 'Albert Sans',Helvetica,Arial,sans-serif;box-shadow:0 10px 28px rgba(74,56,128,.35);cursor:pointer}\
#mc-btn:hover{background:#5d4a92}#mc-btn:focus-visible{outline:3px solid #92E2C1;outline-offset:2px}\
#mc-btn .mc-av{width:28px;height:28px;border-radius:50%;background:#92E2C1;color:#0B4A36;display:flex;align-items:center;justify-content:center;font:800 14px 'Montserrat',Helvetica,Arial,sans-serif}\
#mc-panel{position:absolute;right:0;bottom:58px;width:min(360px,calc(100vw - 32px));background:#fff;border:1.5px solid #E5E0F0;border-radius:20px;box-shadow:0 22px 60px rgba(43,34,51,.22);overflow:hidden;display:none}\
#mc-root.open #mc-panel{display:block}\
#mc-head{background:#6D58A4;color:#fff;padding:16px 18px;display:flex;gap:12px;align-items:center}\
#mc-head .mc-av{width:42px;height:42px;border-radius:50%;background:#92E2C1;color:#0B4A36;display:flex;align-items:center;justify-content:center;font:800 18px 'Montserrat',Helvetica,Arial,sans-serif;flex-shrink:0}\
#mc-head b{display:block;font:800 15px 'Montserrat',Helvetica,Arial,sans-serif}#mc-head span{font-size:12.5px;opacity:.9}\
#mc-x{margin-left:auto;background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;font-size:18px;cursor:pointer}\
#mc-body{padding:14px 18px 16px}\
#mc-body p.mc-intro{font-size:13.5px;line-height:1.5;margin:0 0 12px}\
#mc-body label{display:block;font-size:12px;font-weight:600;color:#6B6477;margin:8px 0 4px}\
#mc-body input,#mc-body textarea{width:100%;box-sizing:border-box;border:1.5px solid #E5DEF4;border-radius:12px;padding:10px 12px;font:15px/1.4 'Albert Sans',Helvetica,Arial,sans-serif;color:#2B2233;background:#fff}\
#mc-body textarea{min-height:84px;resize:vertical}\
#mc-body input:focus,#mc-body textarea:focus{outline:none;border-color:#6D58A4}\
#mc-send{width:100%;margin-top:12px;background:#0D878F;color:#fff;border:none;border-radius:100px;padding:12px;font:700 15px 'Albert Sans',Helvetica,Arial,sans-serif;cursor:pointer}\
#mc-send:hover{background:#0A6B72}#mc-send[disabled]{opacity:.6;cursor:default}\
#mc-err{color:#B4434E;font-size:13px;min-height:16px;margin-top:8px}\
#mc-fine{font-size:11.5px;color:#6B6477;line-height:1.45;margin-top:10px}\
#mc-fine a,#mc-done a{color:#0A6B72;font-weight:600}\
#mc-done{display:none;padding:22px 18px 20px;text-align:center}#mc-done .mc-big{font-size:34px}#mc-done b{display:block;font:800 17px 'Montserrat',Helvetica,Arial,sans-serif;margin:6px 0 4px;color:#4A3880}#mc-done p{font-size:13.5px;line-height:1.5;margin:0}\
";
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var root = document.createElement('div'); root.id = 'mc-root';
  if (document.querySelector('.tabbar')) root.className = 'mc-tabs';
  root.innerHTML =
    '<div id="mc-panel" role="dialog" aria-label="Chat with ' + FOUNDER + '" aria-modal="false">' +
      '<div id="mc-head"><span class="mc-av" aria-hidden="true">K</span><div><b>' + FOUNDER + '</b><span>Momni founder · replies from her phone</span></div>' +
      '<button id="mc-x" type="button" aria-label="Close chat">×</button></div>' +
      '<div id="mc-body"><p class="mc-intro">Hi, I’m ' + FOUNDER + '. Send me a note and I’ll text you back — usually within the hour.</p>' +
        '<form id="mc-form" novalidate>' +
        '<label for="mc-name">Your name</label><input id="mc-name" autocomplete="name" maxlength="80">' +
        '<label for="mc-phone">Mobile number <span style="font-weight:400">(so I can text you back)</span></label><input id="mc-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(801) 555-1234" maxlength="24">' +
        '<label for="mc-msg">Your message</label><textarea id="mc-msg" maxlength="1000"></textarea>' +
        '<button id="mc-send" type="submit">Send to ' + FOUNDER + '</button><div id="mc-err" role="alert"></div>' +
        '<p id="mc-fine">By sending, you’re okay with a text back at this number (standard rates apply). We never share it. Prefer to text directly? <a href="sms:' + FOUNDER_TEL + '">Open Messages</a>.</p>' +
        '</form></div>' +
      '<div id="mc-done"><div class="mc-big">💜</div><b>Sent!</b><p id="mc-done-p"></p></div>' +
    '</div>' +
    '<button id="mc-btn" type="button" aria-haspopup="dialog" aria-expanded="false"><span class="mc-av" aria-hidden="true">K</span>Chat with ' + FOUNDER + '</button>';
  document.body.appendChild(root);
  var btn = root.querySelector('#mc-btn'), panel = root.querySelector('#mc-panel'), form = root.querySelector('#mc-form'),
      err = root.querySelector('#mc-err'), send = root.querySelector('#mc-send'), done = root.querySelector('#mc-done'), body = root.querySelector('#mc-body');
  var nameEl = root.querySelector('#mc-name'), phoneEl = root.querySelector('#mc-phone'), msgEl = root.querySelector('#mc-msg');
  try { nameEl.value = localStorage.getItem('mc-name') || ''; phoneEl.value = localStorage.getItem('mc-phone') || ''; } catch(e){}
  function open(o){ root.classList.toggle('open', o); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); if (o) setTimeout(function(){ (nameEl.value ? msgEl : nameEl).focus(); }, 30); }
  btn.addEventListener('click', function(){ open(!root.classList.contains('open')); });
  root.querySelector('#mc-x').addEventListener('click', function(){ open(false); btn.focus(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && root.classList.contains('open')) { open(false); btn.focus(); } });
  form.addEventListener('submit', function(e){
    e.preventDefault(); err.textContent = '';
    var digits = phoneEl.value.replace(/\D/g, '');
    if (!msgEl.value.trim()) { err.textContent = 'Type a message first.'; msgEl.focus(); return; }
    if (digits.length < 10) { err.textContent = 'Add a mobile number so ' + FOUNDER + ' can text you back.'; phoneEl.focus(); return; }
    send.disabled = true; send.textContent = 'Sending…';
    try { localStorage.setItem('mc-name', nameEl.value); localStorage.setItem('mc-phone', phoneEl.value); } catch(e){}
    fetch(base + '/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameEl.value, phone: phoneEl.value, message: msgEl.value, page: location.href }) })
    .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
    .then(function(x){
      if (!x.ok) throw new Error((x.j && x.j.error) || 'Could not send — try again.');
      body.style.display = 'none'; done.style.display = 'block';
      root.querySelector('#mc-done-p').textContent = FOUNDER + ' will text you back at ' + phoneEl.value.trim() + '.';
      msgEl.value = '';
    })
    .catch(function(e){ err.textContent = e.message || 'Could not send — try again.'; })
    .then(function(){ send.disabled = false; send.textContent = 'Send to ' + FOUNDER; });
  });
})();
