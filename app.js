'use strict';
/* Werkbonnen & Offertes. Alles draait lokaal op het apparaat (IndexedDB), ook offline. */

// ---------- Helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const eur = n => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0);
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fdate = d => d ? new Date(d + 'T12:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const fnum = n => String(Math.round(n * 100) / 100).replace('.', ',');
const opts = (list, sel) => list.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

const WB_STATUS = [['open', 'Open'], ['afgerond', 'Afgerond'], ['gefactureerd', 'Gefactureerd']];
const OF_STATUS = [['concept', 'Concept'], ['verzonden', 'Verzonden'], ['akkoord', 'Akkoord'], ['afgewezen', 'Afgewezen']];
const label = (list, v) => (list.find(x => x[0] === v) || [v, v])[1];

// ---------- Opslag ----------
const DB = {
  open: () => new Promise((res, rej) => {
    const r = indexedDB.open('werkbonnen-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }),
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    } catch { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Opslaan mislukt, maak een back-up!'); } }
  }
};

const defaults = () => ({
  v: 1,
  settings: { bedrijf: '', adres: '', postcode: '', plaats: '', tel: '', email: '', kvk: '', btwnr: '', iban: '', logo: '',
    uurtarief: 55, btw: 21, geldigheid: 30, wbVolg: 1, ofVolg: 1,
    voorwaarden: 'Betaling binnen 14 dagen na factuurdatum.\nPrijzen zijn exclusief BTW tenzij anders vermeld.' },
  klanten: [], artikelen: [], werkbonnen: [], offertes: []
});

let S = defaults();
let cur = null;            // huidig scherm: { obj, update, after, renderList }
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 300); };
const flush = () => { clearTimeout(saveT); return DB.set('state', S); };
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Berekeningen ----------
const rowTotal = r => num(r.aantal) * num(r.prijs);

function rowsOf(kind, o) {
  if (kind === 'offerte') return o.regels;
  const rows = [];
  if (num(o.uren) > 0) rows.push({ omschr: 'Arbeid', aantal: o.uren, eenheid: 'uur', prijs: o.tarief });
  rows.push(...o.materialen);
  if (num(o.voorrijkosten) > 0) rows.push({ omschr: 'Voorrijkosten', aantal: 1, eenheid: '', prijs: o.voorrijkosten });
  return rows;
}
function totals(kind, o) {
  const sub = rowsOf(kind, o).reduce((s, r) => s + rowTotal(r), 0);
  const korting = kind === 'offerte' ? sub * num(o.korting) / 100 : 0;
  const excl = sub - korting, btw = excl * num(o.btw) / 100;
  return { sub, korting, excl, btw, incl: excl + btw };
}
const klantOf = id => S.klanten.find(k => k.id === id) || null;
const klantNaam = id => (klantOf(id) || {}).naam || 'Geen klant';

// ---------- Nieuwe objecten ----------
const pad = n => String(n).padStart(4, '0');
function newWerkbon() {
  const s = S.settings, y = new Date().getFullYear();
  const w = { id: uid(), nr: `WB-${y}-${pad(s.wbVolg++)}`, datum: today(), status: 'open', klantId: '', locatie: '', omschrijving: '',
    start: '', eind: '', pauze: '', uren: '', tarief: s.uurtarief, btw: s.btw, voorrijkosten: '', materialen: [], fotos: [],
    handtekening: '', handtekeningNaam: '', toonPrijzen: true, notitie: '' };
  S.werkbonnen.unshift(w); save(); return w;
}
function newOfferte() {
  const s = S.settings, y = new Date().getFullYear(), d = today();
  const o = { id: uid(), nr: `OF-${y}-${pad(s.ofVolg++)}`, datum: d, geldigTot: addDays(d, num(s.geldigheid) || 30), status: 'concept',
    klantId: '', titel: '', intro: '', regels: [], korting: '', btw: s.btw, voorwaarden: s.voorwaarden };
  S.offertes.unshift(o); save(); return o;
}

// ---------- Router ----------
const main = $('#main');
const NAV = [['#/', '🏠', 'Home', ['', 'home']], ['#/werkbonnen', '🧾', 'Werkbonnen', ['werkbonnen', 'werkbon']],
  ['#/offertes', '📝', 'Offertes', ['offertes', 'offerte']], ['#/klanten', '👥', 'Klanten', ['klanten', 'klant']],
  ['#/instellingen', '⚙️', 'Meer', ['instellingen', 'artikelen', 'artikel']]];

let lastHash = null;
function render() {
  document.activeElement?.blur?.();   // laat een openstaand veld eerst netjes opslaan
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  cur = null;
  let html;
  switch (a) {
    case 'nieuw': {
      const o = b === 'werkbon' ? newWerkbon() : newOfferte();
      return location.replace(`#/${b}/${o.id}`);
    }
    case 'werkbonnen': html = viewList('werkbon'); break;
    case 'offertes': html = viewList('offerte'); break;
    case 'werkbon': html = viewWerkbon(b); break;
    case 'offerte': html = viewOfferte(b); break;
    case 'doc': html = viewDoc(b, c); break;
    case 'klanten': html = viewKlanten(); break;
    case 'klant': html = viewKlant(b); break;
    case 'artikelen': html = viewArtikelen(); break;
    case 'artikel': html = viewArtikel(b); break;
    case 'instellingen': html = viewSettings(); break;
    default: html = viewHome();
  }
  main.innerHTML = html;
  cur?.after?.();
  $('#nav').innerHTML = NAV.map(([h, i, l, m]) => `<a href="${h}" class="${m.includes(a || '') ? 'on' : ''}"><span>${i}</span>${l}</a>`).join('');
  $('#art').innerHTML = S.artikelen.map(x => `<option value="${esc(x.omschr)}">`).join('');
  if (lastHash !== location.hash) scrollTo(0, 0);
  lastHash = location.hash;
}
addEventListener('hashchange', render);

const topbar = (title, back, extra = '') =>
  `<div class="topbar"><a class="back" href="${back}" aria-label="Terug">‹</a><h1>${esc(title)}</h1>${extra}</div>`;

// ---------- Home ----------
function viewHome() {
  const openWb = S.werkbonnen.filter(w => w.status === 'open').length;
  const toBill = S.werkbonnen.filter(w => w.status === 'afgerond').length;
  const wait = S.offertes.filter(o => o.status === 'verzonden');
  const waitSum = wait.reduce((s, o) => s + totals('offerte', o).excl, 0);
  const accepted = S.offertes.filter(o => o.status === 'akkoord').length;
  const missing = !S.settings.bedrijf;
  const recent = (kind, list) => list.slice(0, 4).map(x => itemHtml(kind, x)).join('') ||
    `<div class="empty">Nog niets. Maak je eerste ${kind} aan.</div>`;
  return `
    <div class="topbar"><h1>${esc(S.settings.bedrijf || 'Werkbonnen & Offertes')}</h1></div>
    ${missing ? `<a class="banner" href="#/instellingen">Vul eerst je bedrijfsgegevens in, die komen op je documenten →</a>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/nieuw/werkbon">＋ Nieuwe werkbon</a>
      <a class="btn primary" href="#/nieuw/offerte">＋ Nieuwe offerte</a>
    </div>
    <div class="tiles">
      <a class="tile" href="#/werkbonnen"><b>${openWb}</b><small>open werkbonnen</small></a>
      <a class="tile" href="#/werkbonnen"><b>${toBill}</b><small>klaar om te factureren</small></a>
      <a class="tile" href="#/offertes"><b>${wait.length}</b><small>offertes wachten (${eur(waitSum)})</small></a>
      <a class="tile" href="#/offertes"><b>${accepted}</b><small>offertes akkoord</small></a>
    </div>
    <h2>Laatste werkbonnen</h2>${recent('werkbon', S.werkbonnen)}
    <h2>Laatste offertes</h2>${recent('offerte', S.offertes)}`;
}

// ---------- Lijsten ----------
const listState = { werkbon: { q: '', st: '' }, offerte: { q: '', st: '' } };

function itemHtml(kind, x) {
  const stl = kind === 'werkbon' ? WB_STATUS : OF_STATUS;
  const sub = kind === 'werkbon' ? x.omschrijving : x.titel;
  return `<a class="item" href="#/${kind}/${x.id}">
    <div><b>${esc(x.nr)} · ${esc(klantNaam(x.klantId))}</b><small>${fdate(x.datum)}${sub ? ' · ' + esc(sub) : ''}</small></div>
    <div style="text-align:right"><div class="amount">${eur(totals(kind, x).excl)}</div><span class="badge st-${x.status}">${label(stl, x.status)}</span></div></a>`;
}

function viewList(kind) {
  const st = listState[kind], stl = kind === 'werkbon' ? WB_STATUS : OF_STATUS;
  const all = kind === 'werkbon' ? S.werkbonnen : S.offertes;
  const renderItems = () => {
    const q = st.q.toLowerCase();
    const list = all.filter(x => (!st.st || x.status === st.st) &&
      (!q || [x.nr, klantNaam(x.klantId), x.omschrijving, x.titel, x.locatie].join(' ').toLowerCase().includes(q)));
    return list.map(x => itemHtml(kind, x)).join('') ||
      `<div class="empty">${all.length ? 'Niets gevonden.' : `Nog geen ${kind === 'werkbon' ? 'werkbonnen' : 'offertes'}.`}</div>`;
  };
  cur = { renderList: () => { $('#list').innerHTML = renderItems(); $$('.chip').forEach(c => c.classList.toggle('on', c.dataset.st === st.st)); } };
  return `
    <div class="topbar"><h1>${kind === 'werkbon' ? 'Werkbonnen' : 'Offertes'}</h1><a class="btn primary" href="#/nieuw/${kind}">＋ Nieuw</a></div>
    <input class="search" type="search" data-q="${kind}" placeholder="Zoek op nummer, klant of omschrijving" value="${esc(st.q)}">
    <div class="chips">${[['', 'Alles'], ...stl].map(([v, l]) => `<span class="chip ${st.st === v ? 'on' : ''}" data-act="chip" data-kind="${kind}" data-st="${v}">${l}</span>`).join('')}</div>
    <div id="list">${renderItems()}</div>`;
}

// ---------- Regels (materialen / offerteregels) ----------
function linesHtml(list) {
  return list.map((r, i) => `
    <div class="line">
      <input list="art" placeholder="Omschrijving" data-list="__L__" data-i="${i}" data-f="omschr" value="${esc(r.omschr)}">
      <div class="l-row">
        <input inputmode="decimal" placeholder="Aantal" data-list="__L__" data-i="${i}" data-f="aantal" value="${esc(r.aantal)}">
        <input placeholder="Eenheid" data-list="__L__" data-i="${i}" data-f="eenheid" value="${esc(r.eenheid)}">
        <input inputmode="decimal" placeholder="Prijs € / eenheid" data-list="__L__" data-i="${i}" data-f="prijs" value="${esc(r.prijs)}">
        <button class="btn danger" data-act="del-line" data-i="${i}" aria-label="Regel verwijderen">✕</button>
        <output data-lt="${i}">${eur(rowTotal(r))}</output>
      </div>
    </div>`).join('');
}
const linesBlock = (listName, list) => `<div id="lines">${linesHtml(list).replaceAll('__L__', listName)}</div>`;
function rerenderLines() {
  const l = cur.listName;
  $('#lines').innerHTML = linesHtml(cur.obj[l]).replaceAll('__L__', l);
  cur.update();
}
function totalsHtml(kind, o) {
  const t = totals(kind, o);
  return `<div class="totals">
    ${t.korting ? `<div><span>Subtotaal</span><span>${eur(t.sub)}</span></div><div><span>Korting ${fnum(num(o.korting))}%</span><span>−${eur(t.korting)}</span></div>` : ''}
    <div><span>Totaal excl. BTW</span><span>${eur(t.excl)}</span></div>
    <div><span>BTW ${fnum(num(o.btw))}%</span><span>${eur(t.btw)}</span></div>
    <div class="big"><span>Totaal incl. BTW</span><span>${eur(t.incl)}</span></div></div>`;
}
function updateLineTotals(list) {
  list.forEach((r, i) => { const el = $(`[data-lt="${i}"]`); if (el) el.textContent = eur(rowTotal(r)); });
}

const klantPicker = o => `
  <div class="full"><label>Klant
    <select data-f="klantId"><option value="">— Kies een klant —</option>${S.klanten.slice().sort((a, b) => a.naam.localeCompare(b.naam))
      .map(k => `<option value="${k.id}" ${k.id === o.klantId ? 'selected' : ''}>${esc(k.naam)}</option>`).join('')}</select></label>
    <div class="row" style="margin-top:8px">
      <button class="btn small" data-act="new-klant">＋ Nieuwe klant</button>
      ${o.klantId ? `<a class="btn small" href="#/klant/${o.klantId}">Klant bewerken</a>` : ''}
    </div></div>`;

// ---------- Werkbon ----------
function viewWerkbon(id) {
  const w = S.werkbonnen.find(x => x.id === id);
  if (!w) return notFound('#/werkbonnen');
  cur = { kind: 'werkbon', obj: w, listName: 'materialen', update: () => {
    updateLineTotals(w.materialen); $('#totals').innerHTML = totalsHtml('werkbon', w); }, after: () => { initSig(w); cur.update(); } };
  return `
    ${topbar(w.nr, '#/werkbonnen', `<a class="btn" href="#/doc/werkbon/${w.id}">Voorbeeld / PDF</a>`)}
    <section class="card grid2">
      <label>Datum<input type="date" data-f="datum" value="${w.datum}"></label>
      <label>Status<select data-f="status">${opts(WB_STATUS, w.status)}</select></label>
      ${klantPicker(w)}
      <label class="full">Locatie van het werk<input data-f="locatie" placeholder="Adres waar je werkt" value="${esc(w.locatie)}"></label>
      <label class="full">Uitgevoerde werkzaamheden<textarea rows="5" data-f="omschrijving" placeholder="Wat heb je gedaan?">${esc(w.omschrijving)}</textarea></label>
    </section>
    <section class="card">
      <h3>Tijd</h3>
      <div class="grid2">
        <label>Starttijd<input type="time" data-f="start" value="${w.start}"></label>
        <label>Eindtijd<input type="time" data-f="eind" value="${w.eind}"></label>
        <label>Pauze (minuten)<input inputmode="numeric" data-f="pauze" value="${esc(w.pauze)}"></label>
        <label>Totaal uren<input inputmode="decimal" data-f="uren" placeholder="bijv. 3,5" value="${esc(w.uren)}"></label>
        <label>Uurtarief (€)<input inputmode="decimal" data-f="tarief" value="${esc(w.tarief)}"></label>
        <label>Voorrijkosten (€)<input inputmode="decimal" data-f="voorrijkosten" value="${esc(w.voorrijkosten)}"></label>
      </div>
    </section>
    <section class="card">
      <h3>Materialen</h3>
      ${linesBlock('materialen', w.materialen)}
      <div class="row"><button class="btn" data-act="add-line">＋ Materiaal toevoegen</button></div>
      <label class="check" style="margin-top:14px"><input type="checkbox" data-f="toonPrijzen" ${w.toonPrijzen ? 'checked' : ''}>Prijzen tonen op de werkbon</label>
      <div id="totals"></div>
    </section>
    <section class="card">
      <h3>Foto's</h3>
      <label class="btn" for="fotoIn">📷 Foto toevoegen</label>
      <input id="fotoIn" class="hidden-file" type="file" accept="image/*" multiple data-act="foto">
      <div class="photos">${w.fotos.map((f, i) => `<div><img src="${f}" alt="Foto ${i + 1}"><button data-act="del-foto" data-i="${i}" aria-label="Foto verwijderen">✕</button></div>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Handtekening klant</h3>
      <canvas id="sig"></canvas>
      <div class="grid2" style="margin-top:10px">
        <label>Naam ondertekenaar<input data-f="handtekeningNaam" value="${esc(w.handtekeningNaam)}"></label>
        <div class="row" style="align-items:flex-end"><button class="btn" data-act="clear-sig">Opnieuw</button></div>
      </div>
    </section>
    <section class="card"><label>Interne notitie (komt niet op de werkbon)<textarea rows="2" data-f="notitie">${esc(w.notitie)}</textarea></label></section>
    <div class="actions">
      <a class="btn primary" href="#/doc/werkbon/${w.id}">Voorbeeld / PDF</a>
      <button class="btn" data-act="dup">Dupliceren</button>
      <button class="btn danger" data-act="del">Verwijderen</button>
    </div>`;
}

function calcUren(w) {
  if (!w.start || !w.eind) return;
  const [h1, m1] = w.start.split(':').map(Number), [h2, m2] = w.eind.split(':').map(Number);
  let min = (h2 * 60 + m2) - (h1 * 60 + m1) - num(w.pauze);
  if (min < 0) min += 1440;
  w.uren = fnum(min / 60);
  const el = $('[data-f="uren"]'); if (el) el.value = w.uren;
}

// Handtekening
function initSig(w) {
  const c = $('#sig'); if (!c) return;
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  g.lineWidth = 2.4; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#111';
  if (w.handtekening) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0, r.width, r.height); img.src = w.handtekening; }
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  let down = false;
  c.onpointerdown = e => { down = true; c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); g.lineTo(...pos(e)); g.stroke(); e.preventDefault(); };
  c.onpointermove = e => { if (down) { g.lineTo(...pos(e)); g.stroke(); } };
  const end = () => { if (!down) return; down = false; w.handtekening = c.toDataURL('image/png'); save(); };
  c.onpointerup = c.onpointercancel = end;
  cur.clearSig = () => { g.clearRect(0, 0, r.width, r.height); w.handtekening = ''; save(); };
}

// ---------- Offerte ----------
function viewOfferte(id) {
  const o = S.offertes.find(x => x.id === id);
  if (!o) return notFound('#/offertes');
  cur = { kind: 'offerte', obj: o, listName: 'regels', update: () => {
    updateLineTotals(o.regels); $('#totals').innerHTML = totalsHtml('offerte', o); }, after: () => cur.update() };
  return `
    ${topbar(o.nr, '#/offertes', `<a class="btn" href="#/doc/offerte/${o.id}">Voorbeeld / PDF</a>`)}
    <section class="card grid2">
      <label>Datum<input type="date" data-f="datum" value="${o.datum}"></label>
      <label>Geldig tot<input type="date" data-f="geldigTot" value="${o.geldigTot}"></label>
      <label>Status<select data-f="status">${opts(OF_STATUS, o.status)}</select></label>
      ${klantPicker(o)}
      <label class="full">Onderwerp<input data-f="titel" placeholder="Bijv. Vervangen badkamerkraan" value="${esc(o.titel)}"></label>
      <label class="full">Inleiding (optioneel)<textarea rows="3" data-f="intro" placeholder="Naar aanleiding van ons gesprek bieden wij u aan:">${esc(o.intro)}</textarea></label>
    </section>
    <section class="card">
      <h3>Regels</h3>
      ${linesBlock('regels', o.regels)}
      <div class="row">
        <button class="btn" data-act="add-line">＋ Regel</button>
        <button class="btn" data-act="add-arbeid">＋ Arbeid (uurtarief)</button>
        <button class="btn" data-act="add-artikel">＋ Uit artikelen</button>
      </div>
      <div class="grid2" style="margin-top:14px">
        <label>Korting (%)<input inputmode="decimal" data-f="korting" value="${esc(o.korting)}"></label>
        <label>BTW (%)<input inputmode="decimal" data-f="btw" value="${esc(o.btw)}"></label>
      </div>
      <div id="totals"></div>
    </section>
    <section class="card"><label>Voorwaarden<textarea rows="4" data-f="voorwaarden">${esc(o.voorwaarden)}</textarea></label></section>
    <div class="actions">
      <a class="btn primary" href="#/doc/offerte/${o.id}">Voorbeeld / PDF</a>
      <button class="btn" data-act="to-werkbon">→ Maak werkbon</button>
      <button class="btn" data-act="dup">Dupliceren</button>
      <button class="btn danger" data-act="del">Verwijderen</button>
    </div>`;
}

// ---------- Document / voorbeeld ----------
function viewDoc(kind, id) {
  const o = (kind === 'werkbon' ? S.werkbonnen : S.offertes).find(x => x.id === id);
  if (!o) return notFound('#/');
  const s = S.settings, k = klantOf(o.klantId) || {}, t = totals(kind, o), isWb = kind === 'werkbon';
  const showPrices = !isWb || o.toonPrijzen;
  const rows = rowsOf(kind, o).filter(r => r.omschr || num(r.prijs));
  cur = { obj: o, kind };
  cur.shareText = isWb
    ? `Werkbon ${o.nr} (${fdate(o.datum)})\n${klantNaam(o.klantId)}\n${o.locatie ? o.locatie + '\n' : ''}\n${o.omschrijving}\n\nUren: ${o.uren || 0}${showPrices ? `\nTotaal incl. BTW: ${eur(t.incl)}` : ''}\n\n${s.bedrijf}`
    : `Offerte ${o.nr}${o.titel ? ' - ' + o.titel : ''}\n\n${o.intro ? o.intro + '\n\n' : ''}${rows.map(r => `- ${r.omschr}: ${fnum(num(r.aantal))} ${r.eenheid || ''} x ${eur(num(r.prijs))} = ${eur(rowTotal(r))}`).join('\n')}\n\nTotaal excl. BTW: ${eur(t.excl)}\nBTW ${fnum(num(o.btw))}%: ${eur(t.btw)}\nTotaal incl. BTW: ${eur(t.incl)}\n\nGeldig tot ${fdate(o.geldigTot)}.\n\n${s.bedrijf}`;
  cur.mail = `mailto:${encodeURIComponent(k.email || '')}?subject=${encodeURIComponent((isWb ? 'Werkbon ' : 'Offerte ') + o.nr)}&body=${encodeURIComponent(cur.shareText)}`;
  return `
    ${topbar((isWb ? 'Werkbon ' : 'Offerte ') + o.nr, `#/${kind}/${o.id}`)}
    <div class="actions">
      <button class="btn primary" data-act="print">🖨 Afdrukken / PDF opslaan</button>
      <button class="btn" data-act="share">Delen</button>
      <a class="btn" href="${cur.mail}">✉️ E-mail</a>
    </div>
    <article class="doc">
      <div class="head">
        <div>${s.logo ? `<img src="${s.logo}" alt="">` : ''}<strong>${esc(s.bedrijf)}</strong><div class="small">${esc([s.adres, [s.postcode, s.plaats].filter(Boolean).join(' '), s.tel, s.email].filter(Boolean).join('\n'))}${s.kvk ? '\nKvK ' + esc(s.kvk) : ''}${s.btwnr ? '\nBTW ' + esc(s.btwnr) : ''}</div></div>
        <div style="text-align:right"><h2>${isWb ? 'Werkbon' : 'Offerte'}</h2>
          <div>Nr. ${esc(o.nr)}</div><div>Datum: ${fdate(o.datum)}</div>${isWb ? '' : `<div>Geldig tot: ${fdate(o.geldigTot)}</div>`}</div>
      </div>
      <div style="margin-top:18px"><strong>${esc(k.naam || '')}</strong><div class="small">${esc([k.contact, k.adres, [k.postcode, k.plaats].filter(Boolean).join(' ')].filter(Boolean).join('\n'))}</div></div>
      ${isWb && o.locatie ? `<p><strong>Locatie:</strong> ${esc(o.locatie)}</p>` : ''}
      ${!isWb && o.titel ? `<p><strong>Betreft:</strong> ${esc(o.titel)}</p>` : ''}
      ${!isWb && o.intro ? `<p style="white-space:pre-line">${esc(o.intro)}</p>` : ''}
      ${isWb ? `<p style="white-space:pre-line"><strong>Uitgevoerde werkzaamheden</strong><br>${esc(o.omschrijving)}</p>
        ${o.start && o.eind ? `<p class="small">Tijd: ${o.start} – ${o.eind}${num(o.pauze) ? `, pauze ${fnum(num(o.pauze))} min` : ''}</p>` : ''}` : ''}
      <table><thead><tr><th>Omschrijving</th><th class="r">Aantal</th>${showPrices ? '<th class="r">Prijs</th><th class="r">Totaal</th>' : ''}</tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.omschr)}</td><td class="r">${fnum(num(r.aantal))} ${esc(r.eenheid || '')}</td>${showPrices ? `<td class="r">${eur(num(r.prijs))}</td><td class="r">${eur(rowTotal(r))}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${showPrices ? totalsHtml(kind, o) : ''}
      ${!isWb && o.voorwaarden ? `<p class="small" style="margin-top:20px"><strong>Voorwaarden</strong>\n${esc(o.voorwaarden)}</p>` : ''}
      ${!isWb && s.iban ? `<p class="small">IBAN: ${esc(s.iban)}</p>` : ''}
      ${isWb ? `<div class="sig" style="margin-top:24px"><strong>Voor akkoord</strong><br>${o.handtekening ? `<img src="${o.handtekening}" alt="Handtekening">` : '<div style="height:70px;border-bottom:1px solid #111"></div>'}<div class="small">${esc(o.handtekeningNaam)}</div></div>
        ${o.fotos.length ? `<h3 style="margin-top:20px">Foto's</h3><div class="photos">${o.fotos.map(f => `<div><img src="${f}" alt=""></div>`).join('')}</div>` : ''}`
        : `<div class="signbox"><div>Datum en handtekening voor akkoord</div><div>Naam</div></div>`}
    </article>`;
}

// ---------- Klanten ----------
function viewKlanten() {
  const st = listState.klant || (listState.klant = { q: '' });
  const renderItems = () => {
    const q = st.q.toLowerCase();
    const list = S.klanten.filter(k => !q || [k.naam, k.plaats, k.tel, k.email].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.naam.localeCompare(b.naam));
    return list.map(k => `<a class="item" href="#/klant/${k.id}"><div><b>${esc(k.naam)}</b><small>${esc([k.adres, k.plaats].filter(Boolean).join(', ') || k.tel || '')}</small></div><span>›</span></a>`).join('')
      || `<div class="empty">${S.klanten.length ? 'Niets gevonden.' : 'Nog geen klanten.'}</div>`;
  };
  cur = { renderList: () => { $('#list').innerHTML = renderItems(); } };
  return `<div class="topbar"><h1>Klanten</h1><button class="btn primary" data-act="new-klant-page">＋ Nieuw</button></div>
    <input class="search" type="search" data-q="klant" placeholder="Zoek klant" value="${esc(st.q)}"><div id="list">${renderItems()}</div>`;
}
function viewKlant(id) {
  const k = S.klanten.find(x => x.id === id);
  if (!k) return notFound('#/klanten');
  cur = { obj: k, kind: 'klant' };
  const f = (key, lbl, extra = '') => `<label>${lbl}<input data-f="${key}" value="${esc(k[key])}" ${extra}></label>`;
  return `${topbar(k.naam || 'Klant', '#/klanten')}
    <section class="card grid2">
      <div class="full">${f('naam', 'Naam / bedrijf')}</div>${f('contact', 'Contactpersoon')}${f('tel', 'Telefoon', 'type="tel"')}
      ${f('email', 'E-mail', 'type="email"')}${f('adres', 'Adres')}${f('postcode', 'Postcode')}${f('plaats', 'Plaats')}
      <label class="full">Notitie<textarea rows="3" data-f="notitie">${esc(k.notitie)}</textarea></label>
    </section>
    <div class="actions">
      ${k.tel ? `<a class="btn" href="tel:${esc(k.tel)}">📞 Bellen</a>` : ''}
      <a class="btn primary" data-act="klant-wb" href="#">＋ Werkbon</a>
      <a class="btn primary" data-act="klant-of" href="#">＋ Offerte</a>
      <button class="btn danger" data-act="del">Verwijderen</button>
    </div>`;
}
const newKlant = (naam = '') => { const k = { id: uid(), naam, contact: '', adres: '', postcode: '', plaats: '', tel: '', email: '', notitie: '' }; S.klanten.push(k); save(); return k; };

// ---------- Artikelen ----------
function viewArtikelen() {
  cur = { renderList: null };
  return `${topbar('Artikelen & prijslijst', '#/instellingen', `<button class="btn primary" data-act="new-artikel">＋ Nieuw</button>`)}
    <p class="muted">Je vaste materialen en werkzaamheden. Typ later de naam in een offerte of werkbon en de prijs wordt automatisch ingevuld.</p>
    ${S.artikelen.slice().sort((a, b) => a.omschr.localeCompare(b.omschr)).map(a => `<a class="item" href="#/artikel/${a.id}"><div><b>${esc(a.omschr)}</b><small>per ${esc(a.eenheid || 'stuk')}</small></div><span class="amount">${eur(num(a.prijs))}</span></a>`).join('')
      || '<div class="empty">Nog geen artikelen.</div>'}`;
}
function viewArtikel(id) {
  const a = S.artikelen.find(x => x.id === id);
  if (!a) return notFound('#/artikelen');
  cur = { obj: a, kind: 'artikel' };
  return `${topbar(a.omschr || 'Artikel', '#/artikelen')}
    <section class="card grid2">
      <label class="full">Omschrijving<input data-f="omschr" value="${esc(a.omschr)}"></label>
      <label>Eenheid<input data-f="eenheid" placeholder="stuk, m, m², uur" value="${esc(a.eenheid)}"></label>
      <label>Prijs excl. BTW (€)<input inputmode="decimal" data-f="prijs" value="${esc(a.prijs)}"></label>
    </section>
    <div class="actions"><button class="btn danger" data-act="del">Verwijderen</button></div>`;
}

// ---------- Instellingen ----------
function viewSettings() {
  const s = S.settings; cur = { obj: s, kind: 'settings' };
  const f = (key, lbl, extra = '') => `<label>${lbl}<input data-f="${key}" value="${esc(s[key])}" ${extra}></label>`;
  return `<div class="topbar"><h1>Meer</h1></div>
    <a class="item" href="#/artikelen"><div><b>Artikelen & prijslijst</b><small>${S.artikelen.length} artikelen</small></div><span>›</span></a>
    <h2>Bedrijfsgegevens</h2>
    <section class="card grid2">
      <div class="full">${f('bedrijf', 'Bedrijfsnaam')}</div>${f('adres', 'Adres')}${f('postcode', 'Postcode')}${f('plaats', 'Plaats')}
      ${f('tel', 'Telefoon', 'type="tel"')}${f('email', 'E-mail', 'type="email"')}${f('kvk', 'KvK-nummer')}${f('btwnr', 'BTW-nummer')}
      <div class="full">${f('iban', 'IBAN')}</div>
      <div class="full"><label>Logo</label>
        ${s.logo ? `<img src="${s.logo}" alt="Logo" style="max-height:60px;display:block;margin:6px 0">` : ''}
        <div class="row"><label class="btn" for="logoIn">Logo kiezen</label>${s.logo ? '<button class="btn danger" data-act="del-logo">Logo verwijderen</button>' : ''}</div>
        <input id="logoIn" class="hidden-file" type="file" accept="image/*" data-act="logo"></div>
    </section>
    <h2>Standaardwaarden</h2>
    <section class="card grid2">
      ${f('uurtarief', 'Uurtarief excl. BTW (€)', 'inputmode="decimal"')}${f('btw', 'BTW-percentage', 'inputmode="decimal"')}
      ${f('geldigheid', 'Offerte geldig (dagen)', 'inputmode="numeric"')}
      <label class="full">Standaard voorwaarden op offertes<textarea rows="4" data-f="voorwaarden">${esc(s.voorwaarden)}</textarea></label>
    </section>
    <h2>Back-up</h2>
    <section class="card">
      <p class="muted" style="margin-top:0">Je gegevens staan alleen op dit apparaat. Maak regelmatig een back-up, ook handig om naar je andere apparaat te verhuizen.</p>
      <div class="row"><button class="btn primary" data-act="export">Back-up downloaden</button>
        <label class="btn" for="importIn">Back-up terugzetten</label>
        <input id="importIn" class="hidden-file" type="file" accept="application/json,.json" data-act="import"></div>
    </section>`;
}

const notFound = back => { cur = null; return `${topbar('Niet gevonden', back)}<div class="empty">Dit item bestaat niet (meer).</div>`; };

// ---------- Afbeeldingen ----------
function resizeImage(file, max, type = 'image/jpeg', q = .72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL(type, q));
    };
    img.onerror = () => rej(new Error('Afbeelding niet leesbaar')); img.src = url;
  });
}

// ---------- Events ----------
function onField(e) {
  const el = e.target;
  if (!el.isConnected) return;   // veld is al vervangen door een nieuwe weergave
  if (el.dataset.q) { listState[el.dataset.q].q = el.value; cur?.renderList?.(); return; }
  if (!el.dataset.f || !cur?.obj) return;
  const o = el.dataset.list ? cur.obj[el.dataset.list][+el.dataset.i] : cur.obj;
  if (!o) return;
  const f = el.dataset.f;
  o[f] = el.type === 'checkbox' ? el.checked : el.value;
  if (cur.kind === 'werkbon' && ['start', 'eind', 'pauze'].includes(f)) calcUren(cur.obj);
  // Artikel herkend? Vul eenheid en prijs automatisch in.
  if (e.type === 'change' && el.dataset.list && f === 'omschr') {
    const a = S.artikelen.find(x => x.omschr.toLowerCase() === el.value.trim().toLowerCase());
    if (a && !num(o.prijs)) { o.prijs = a.prijs; o.eenheid = o.eenheid || a.eenheid; if (!num(o.aantal)) o.aantal = 1; rerenderLines(); }
  }
  if (e.type === 'change' && f === 'klantId') { render(); return; }
  if (cur.kind === 'klant' && f === 'naam') { const h = $('.topbar h1'); if (h) h.textContent = el.value || 'Klant'; }
  save(); cur.update?.();
}
document.addEventListener('input', onField);
document.addEventListener('change', onField);

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, o = cur?.obj, kind = cur?.kind;
  const list = cur?.listName;
  switch (act) {
    case 'chip': listState[el.dataset.kind].st = el.dataset.st; cur.renderList(); break;
    case 'add-line': o[list].push({ omschr: '', aantal: 1, eenheid: 'stuk', prijs: '' }); rerenderLines(); $$('#lines .line:last-child input')[0]?.focus(); break;
    case 'add-arbeid': o.regels.push({ omschr: 'Arbeid', aantal: 1, eenheid: 'uur', prijs: S.settings.uurtarief }); rerenderLines(); save(); break;
    case 'add-artikel': {
      if (!S.artikelen.length) { toast('Maak eerst artikelen aan onder Meer'); break; }
      const nm = prompt('Naam van artikel:\n' + S.artikelen.map(a => '• ' + a.omschr).join('\n'));
      const a = nm && S.artikelen.find(x => x.omschr.toLowerCase().includes(nm.trim().toLowerCase()));
      if (a) { o.regels.push({ omschr: a.omschr, aantal: 1, eenheid: a.eenheid, prijs: a.prijs }); rerenderLines(); save(); } else if (nm) toast('Artikel niet gevonden');
      break;
    }
    case 'del-line': o[list].splice(+el.dataset.i, 1); rerenderLines(); save(); break;
    case 'new-klant': {
      const naam = prompt('Naam van de klant:'); if (!naam) break;
      const k = newKlant(naam.trim()); o.klantId = k.id; save(); render(); toast('Klant toegevoegd'); break;
    }
    case 'new-klant-page': { const k = newKlant(); location.hash = '#/klant/' + k.id; break; }
    case 'new-artikel': { const a = { id: uid(), omschr: '', eenheid: 'stuk', prijs: '' }; S.artikelen.push(a); save(); location.hash = '#/artikel/' + a.id; break; }
    case 'klant-wb': case 'klant-of': {
      e.preventDefault(); const n = act === 'klant-wb' ? newWerkbon() : newOfferte(); n.klantId = o.id; save();
      location.hash = `#/${act === 'klant-wb' ? 'werkbon' : 'offerte'}/${n.id}`; break;
    }
    case 'clear-sig': cur.clearSig?.(); break;
    case 'del-foto': o.fotos.splice(+el.dataset.i, 1); save(); render(); break;
    case 'dup': {
      const copy = structuredClone(o); copy.id = uid(); copy.datum = today();
      if (kind === 'werkbon') { copy.nr = `WB-${new Date().getFullYear()}-${pad(S.settings.wbVolg++)}`; copy.status = 'open'; copy.handtekening = ''; copy.fotos = []; S.werkbonnen.unshift(copy); }
      else { copy.nr = `OF-${new Date().getFullYear()}-${pad(S.settings.ofVolg++)}`; copy.status = 'concept'; copy.geldigTot = addDays(copy.datum, num(S.settings.geldigheid) || 30); S.offertes.unshift(copy); }
      save(); location.hash = `#/${kind}/${copy.id}`; toast('Gedupliceerd'); break;
    }
    case 'to-werkbon': {
      const w = newWerkbon(); w.klantId = o.klantId; w.omschrijving = o.titel;
      w.materialen = o.regels.filter(r => r.eenheid !== 'uur').map(r => ({ ...r }));
      const uren = o.regels.filter(r => r.eenheid === 'uur').reduce((s, r) => s + num(r.aantal), 0);
      if (uren) w.uren = fnum(uren);
      save(); location.hash = '#/werkbon/' + w.id; toast('Werkbon aangemaakt uit offerte'); break;
    }
    case 'del': {
      if (!confirm('Weet je zeker dat je dit wilt verwijderen?')) break;
      const coll = { werkbon: 'werkbonnen', offerte: 'offertes', klant: 'klanten', artikel: 'artikelen' }[kind];
      S[coll] = S[coll].filter(x => x.id !== o.id); save();
      location.hash = { werkbon: '#/werkbonnen', offerte: '#/offertes', klant: '#/klanten', artikel: '#/artikelen' }[kind]; break;
    }
    case 'print': print(); break;
    case 'share': {
      if (navigator.share) { try { await navigator.share({ title: document.title, text: cur.shareText }); } catch { /* geannuleerd */ } }
      else { try { await navigator.clipboard.writeText(cur.shareText); toast('Tekst gekopieerd'); } catch { toast('Delen niet beschikbaar'); } }
      break;
    }
    case 'del-logo': S.settings.logo = ''; save(); render(); break;
    case 'export': {
      await flush();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
      a.download = `werkbonnen-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); break;
    }
  }
});

document.addEventListener('change', async e => {
  const el = e.target; if (el.type !== 'file' || !el.files.length) return;
  try {
    if (el.dataset.act === 'foto') {
      for (const f of el.files) cur.obj.fotos.push(await resizeImage(f, 1280));
      save(); render(); toast('Foto toegevoegd');
    } else if (el.dataset.act === 'logo') {
      S.settings.logo = await resizeImage(el.files[0], 400, 'image/png'); save(); render();
    } else if (el.dataset.act === 'import') {
      const d = JSON.parse(await el.files[0].text());
      if (!d.settings || !Array.isArray(d.werkbonnen)) throw new Error('Geen geldige back-up');
      if (!confirm('Alle huidige gegevens worden vervangen door deze back-up. Doorgaan?')) return;
      S = { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings } }; await flush(); render(); toast('Back-up teruggezet');
    }
  } catch (err) { toast(err.message || 'Mislukt'); }
  el.value = '';
});

// ---------- Start ----------
(async function init() {
  const saved = await DB.get('state');
  if (saved) S = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
