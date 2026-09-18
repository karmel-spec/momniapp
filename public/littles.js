// littles.js — shared by host.html (display) and me.html (editor): boy/girl icons + birthday → age label.
window.MomniLittles = (function(){
  function icon(sex){
    var girl = sex === 'girl', hair = girl ? '#6D58A4' : '#0D878F', bg = girl ? '#F5F0FE' : '#E1F7F2';
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="' + bg + '"/>' +
      (girl ? '<circle cx="15" cy="41" r="6.5" fill="' + hair + '"/><circle cx="49" cy="41" r="6.5" fill="' + hair + '"/>' : '') +
      '<circle cx="32" cy="37" r="13" fill="#F6DCC8"/>' +
      (girl ? '<path d="M18 38c0-13 6-21 14-21s14 8 14 21c-2-7-6-10-14-10s-12 3-14 10z" fill="' + hair + '"/>'
            : '<path d="M19 34c1-10 6-16 13-16s12 6 13 16c-3-5-7-7-13-7s-10 2-13 7z" fill="' + hair + '"/>') +
      '<circle cx="27.5" cy="37" r="1.7" fill="#2B2233"/><circle cx="36.5" cy="37" r="1.7" fill="#2B2233"/>' +
      '<path d="M28 43q4 3 8 0" stroke="#2B2233" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
  }
  // "3 wks" · "7 mo" · "4" (years) — computed from the birthday every time it renders, so it's never stale.
  function ageLabel(birthdate){
    if (!birthdate) return '';
    var b = new Date(birthdate + 'T00:00:00'), n = new Date(); if (isNaN(b)) return '';
    var months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth()) - (n.getDate() < b.getDate() ? 1 : 0);
    if (months < 0) return '';
    if (months < 1) return Math.max(1, Math.floor((n - b) / 604800000)) + ' wks';
    if (months < 24) return months + ' mo';
    return Math.floor(months / 12) + ' yrs';
  }
  // Payment-method chips: typeset in each brand's color (no downloaded logos).
  var PAY = {
    venmo:     ['Venmo',      '#008CFF', '#fff', 'font-weight:800;letter-spacing:-.02em;text-transform:lowercase'],
    paypal:    ['PayPal',     '#003087', '#fff', 'font-weight:800;font-style:italic'],
    zelle:     ['Zelle',      '#6D1ED4', '#fff', 'font-weight:800'],
    cashapp:   ['Cash App',   '#00D632', '#fff', 'font-weight:800'],
    applecash: ['\uF8FF Apple Cash', '#111', '#fff', 'font-weight:700'],
    cash:      ['Cash or check', '#F3F0F8', '#4A3880', 'font-weight:700']
  };
  // Official marks (Venmo, PayPal, Zelle, Cash App) live in /assets/pay/; Apple Cash and cash stay typeset.
  var LOGO = { venmo: 'venmo.svg', paypal: 'paypal.svg', zelle: 'zelle.svg', cashapp: 'cashapp.svg' };
  var base = (function(){ try { var sc = document.currentScript; return sc ? new URL(sc.src, location.href).origin : ''; } catch(e){ return ''; } })();
  function payChip(key){
    var p = PAY[key]; if (!p) return '';
    if (LOGO[key]) return '<span class="paychip logo" title="' + p[0] + '"><img src="' + base + '/assets/pay/' + LOGO[key] + '" alt="' + p[0] + '">' + (key === 'cashapp' ? '<b>Cash App</b>' : '') + '</span>';
    return '<span class="paychip" style="background:' + p[1] + ';color:' + p[2] + ';' + p[3] + '">' + p[0] + '</span>';
  }
  function payLabel(key){ return PAY[key] ? PAY[key][0] : key; }
  return { icon: icon, ageLabel: ageLabel, payChip: payChip, payLabel: payLabel, PAY_KEYS: Object.keys(PAY) };
})();
