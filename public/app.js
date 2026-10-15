/* Live Call Translator
 * - Listens (Web Speech API, Chinese) -> translates to English live
 * - Plays saved / typed English phrases as Chinese speech
 * All services used are free: browser speech recognition + synthesis,
 * Google's public translate endpoint (fallback: MyMemory), optional Google online voice.
 */
const $ = (s) => document.querySelector(s);

// ---------- languages ----------
// rec = speech recognition code, tr = translation code, tts = browser voice lang, gtts = Google voice lang
const LANGS = {
  'zh-CN': { label: 'Mandarin – Mainland (简体)', rec: 'zh-CN', tr: 'zh-CN', tts: 'zh-CN', gtts: 'zh-CN' },
  'zh-TW': { label: 'Mandarin – Taiwan (繁體)', rec: 'zh-TW', tr: 'zh-TW', tts: 'zh-TW', gtts: 'zh-TW' },
  'yue':   { label: 'Cantonese – Hong Kong (粵語)', rec: 'zh-HK', tr: 'zh-TW', tts: 'zh-HK', gtts: 'yue' },
};

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('lct.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lct.' + k, JSON.stringify(v)); } catch {} },
};

const settings = Object.assign(
  { lang: 'zh-CN', engine: 'browser', voice: '', rate: 0.9, muteWhilePlaying: true, fontSize: 22 },
  store.get('settings', {})
);
const saveSettings = () => store.set('settings', settings);

const DEFAULT_PRESETS = [
  ['Hello. I don\'t speak Chinese, so I am using a translation app to talk with you. Please speak slowly and in short sentences. Thank you for your patience.',
   '您好。我不会说中文，所以我正在用翻译软件和您交流。请您说慢一点，用简短的句子。感谢您的耐心。'],
  ['Sorry, could you please repeat that?', '对不起，请您再说一遍好吗？'],
  ['Please speak a little more slowly.', '请您说得慢一点。'],
  ['Yes, that is correct.', '是的，没错。'],
  ['No, that is not correct.', '不，那不对。'],
  ['Please wait a moment.', '请稍等一下。'],
  ['Does anyone there speak English?', '请问那边有人会说英语吗？'],
  ['Could you please send this information to me by email?', '请问您可以把这些信息通过电子邮件发给我吗？'],
  ['Thank you very much. Goodbye.', '非常感谢您。再见。'],
].map(([en, zh]) => ({ id: uid(), en, zh, zhLang: 'zh-CN', back: '' }));

let presets = store.get('presets', null) || DEFAULT_PRESETS;
const savePresets = () => store.set('presets', presets);

function uid() { return Math.random().toString(36).slice(2, 10); }
const L = () => LANGS[settings.lang];

// ---------- ui helpers ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function banner(msg) {
  const b = $('#banner');
  b.innerHTML = msg;
  b.classList.toggle('hidden', !msg);
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ---------- translation ----------
const trCache = new Map();

async function googleTranslate(text, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Google translate HTTP ' + r.status);
  const j = await r.json();
  return j[0].map((x) => x[0]).join('');
}

async function myMemoryTranslate(text, sl, tl) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;
  const r = await fetch(url);
  const j = await r.json();
  if (Number(j.responseStatus) !== 200) throw new Error('MyMemory: ' + j.responseDetails);
  return j.responseData.translatedText;
}

// sl may be 'auto' for Google; MyMemory needs a concrete source, given as fallbackSl
async function translate(text, sl, tl, fallbackSl = sl) {
  text = (text || '').trim();
  if (!text) return '';
  const key = `${sl}|${tl}|${text}`;
  if (trCache.has(key)) return trCache.get(key);
  let out;
  try {
    out = await googleTranslate(text, sl, tl);
    setTrStatus('Google');
  } catch (e) {
    console.warn(e);
    out = await myMemoryTranslate(text, fallbackSl, tl);
    setTrStatus('MyMemory (backup)');
  }
  trCache.set(key, out);
  return out;
}
const toEnglish = (zh) => translate(zh, 'auto', 'en', L().tr);
const toChinese = (en) => translate(en, 'en', L().tr);
const zhBackToEnglish = (zh) => translate(zh, L().tr, 'en');

function setTrStatus(name) { $('#trStatus').textContent = 'Translator: ' + name; }

// ---------- transcript ----------
const transcriptLog = []; // {who, time, en, zh}

function addMessage(who, { en = '', zh = '' }) {
  $('#emptyHint')?.remove();
  const entry = { who, time: timeNow(), en, zh };
  transcriptLog.push(entry);

  const box = $('#transcript');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const m = el('div', 'msg ' + who);
  m.appendChild(el('div', 'meta', `${who === 'them' ? 'Caller' : 'You (played)'} · ${entry.time}`));
  const holder = who === 'me' ? m.appendChild(el('div', 'bubble')) : m;
  const enEl = holder.appendChild(el('div', 'en', en));
  const zhEl = holder.appendChild(el('div', 'zh', zh));
  zhEl.lang = 'zh';
  box.appendChild(m);
  if (nearBottom) box.scrollTop = box.scrollHeight;

  return {
    setEnglish(text, pending = false) {
      entry.en = pending ? '' : text;
      enEl.textContent = text;
      enEl.classList.toggle('pending', pending);
      if (nearBottom) box.scrollTop = box.scrollHeight;
    },
  };
}

function transcriptText() {
  return transcriptLog
    .map((e) => e.who === 'them'
      ? `[${e.time}] CALLER: ${e.en}\n           (${e.zh})`
      : `[${e.time}] ME: ${e.en}\n           (${e.zh})`)
    .join('\n');
}

$('#copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(transcriptText()); toast('Transcript copied'); }
  catch { toast('Copy failed'); }
};
$('#downloadBtn').onclick = () => {
  const blob = new Blob([transcriptText()], { type: 'text/plain;charset=utf-8' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `call-transcript-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#clearBtn').onclick = () => {
  if (transcriptLog.length && !confirm('Clear the transcript?')) return;
  transcriptLog.length = 0;
  $('#transcript').innerHTML = '';
};

// ---------- speech recognition (them -> English) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false; // user wants mic on
let suspended = false; // temporarily paused while we play audio
let running = false;   // recognizer actually started

function setMicStatus() {
  const s = $('#micStatus');
  s.className = 'pill';
  if (playingNow) { s.textContent = '🔊 Playing – mic paused'; s.classList.add('playing'); }
  else if (listening && running) { s.textContent = '● Listening'; s.classList.add('listening'); }
  else if (listening) { s.textContent = 'Starting mic…'; }
  else { s.textContent = 'Mic off'; }
  $('#listenBtn').classList.toggle('on', listening);
  $('#listenLabel').textContent = listening ? 'Stop listening' : 'Start listening';
}

function buildRecognizer() {
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onstart = () => { running = true; setMicStatus(); };
  r.onresult = onResult;
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      listening = false;
      banner('Microphone access was blocked. Click the 🔒 icon in the address bar → allow Microphone, then reload.');
    } else if (e.error === 'network') {
      toast('Speech service network error – retrying…');
    } else if (e.error === 'language-not-supported') {
      listening = false;
      toast('This browser does not support speech recognition for that language.');
    } else {
      console.warn('recognition error', e.error);
    }
    setMicStatus();
  };
  r.onend = () => {
    running = false;
    flushInterim();
    setMicStatus();
    // Chrome stops after silence / ~60s; keep it alive while the user wants it on
    if (listening && !suspended) setTimeout(startRecognizer, 250);
  };
  return r;
}

function startRecognizer() {
  if (!listening || suspended || running) return;
  if (!rec) rec = buildRecognizer();
  rec.lang = L().rec;
  try { rec.start(); } catch (e) { /* already starting */ }
  setMicStatus();
}

function stopRecognizer() {
  if (rec) { try { rec.abort(); } catch {} }
  running = false;
}

$('#listenBtn').onclick = () => {
  if (!SR) {
    banner('This browser has no speech recognition. Please open this page in <b>Google Chrome</b> or <b>Microsoft Edge</b>.');
    return;
  }
  listening = !listening;
  if (listening) { banner(''); startRecognizer(); }
  else { stopRecognizer(); hideInterim(); }
  setMicStatus();
};

// interim (live, not-yet-final) text with throttled live translation
let interimText = '';
let interimSeq = 0;
let interimTimer = null;
let lastInterimTr = 0;

function onResult(e) {
  let interim = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const t = res[0].transcript;
    if (res.isFinal) {
      if (t.trim()) addTheirLine(t.trim());
    } else {
      interim += t;
    }
  }
  showInterim(interim);
}

function showInterim(text) {
  interimText = text.trim();
  if (!interimText) { hideInterim(); return; }
  $('#live').classList.remove('hidden');
  $('#liveZh').textContent = interimText;
  // throttle: translate at most every 700ms while they're still talking
  const wait = Math.max(0, 700 - (Date.now() - lastInterimTr));
  clearTimeout(interimTimer);
  interimTimer = setTimeout(async () => {
    lastInterimTr = Date.now();
    const seq = ++interimSeq;
    const src = interimText;
    if (!src) return;
    try {
      const en = await toEnglish(src);
      if (seq === interimSeq && interimText) $('#liveEn').textContent = en;
    } catch {}
  }, wait);
}

function hideInterim() {
  interimText = '';
  interimSeq++;
  clearTimeout(interimTimer);
  $('#live').classList.add('hidden');
  $('#liveZh').textContent = '';
  $('#liveEn').textContent = '';
}

// if the recognizer ends mid-sentence, keep what we had rather than losing it
function flushInterim() {
  if (interimText) addTheirLine(interimText);
  hideInterim();
}

async function addTheirLine(zh) {
  hideInterim();
  const msg = addMessage('them', { zh });
  msg.setEnglish('translating…', true);
  try { msg.setEnglish(await toEnglish(zh)); }
  catch (e) { msg.setEnglish('[translation failed – check internet]'); console.warn(e); }
}

// ---------- speech synthesis (English phrase -> Chinese audio) ----------
let voices = [];
let playingNow = false;
let playToken = 0; // bumped to abort in-flight audio
let speakId = 0;   // identifies the latest speak() call
let stopCurrent = null;

function chineseVoices() {
  const want = L().tts.toLowerCase();
  const isZh = (v) => /^(zh|yue|cmn)/i.test(v.lang);
  const score = (v) => {
    const lang = v.lang.toLowerCase().replace('_', '-');
    let s = 0;
    if (lang === want) s += 10;
    else if (want === 'zh-hk' && /yue|hk/.test(lang)) s += 9;
    if (/natural|online|neural/i.test(v.name)) s += 5; // Edge's high quality voices
    if (/google/i.test(v.name)) s += 3;
    return s;
  };
  return voices.filter(isZh).sort((a, b) => score(b) - score(a));
}

function renderVoiceSelect() {
  const sel = $('#voiceSelect');
  const list = chineseVoices();
  sel.innerHTML = '';
  if (!list.length) {
    sel.appendChild(el('option', null, 'No Chinese voice found – use Google online voice'));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  list.forEach((v) => {
    const o = el('option', null, `${v.name} (${v.lang})`);
    o.value = v.voiceURI;
    sel.appendChild(o);
  });
  if (list.some((v) => v.voiceURI === settings.voice)) sel.value = settings.voice;
  else settings.voice = list[0].voiceURI;
}

function loadVoices() {
  voices = speechSynthesis.getVoices();
  renderVoiceSelect();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

// split long text into sentence-ish chunks (Chrome cuts long utterances; Google voice caps ~200 chars)
function chunkText(text, max) {
  const parts = text.split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur); cur = ''; }
    if (p.length > max) {
      p.split(/(?<=[，,、])/).forEach((q) => {
        if ((cur + q).length > max && cur) { out.push(cur); cur = ''; }
        cur += q;
      });
    } else cur += p;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function speakBrowser(text, token) {
  return new Promise((resolve, reject) => {
    const voice = voices.find((v) => v.voiceURI === settings.voice) || chineseVoices()[0];
    if (!voice) {
      reject(new Error('No Chinese browser voice installed – switch Settings → Voice engine to "Google online voice".'));
      return;
    }
    const parts = chunkText(text, 160);
    stopCurrent = () => { speechSynthesis.cancel(); resolve(); };
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = settings.rate;
      if (i === parts.length - 1) u.onend = () => resolve();
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled') ? resolve() : reject(new Error('Voice error: ' + e.error));
      speechSynthesis.speak(u);
    });
  });
}

async function speakGoogle(text, token) {
  for (const part of chunkText(text, 180)) {
    if (token !== playToken) return;
    await new Promise((resolve, reject) => {
      const a = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${L().gtts}&q=${encodeURIComponent(part)}`);
      a.playbackRate = settings.rate;
      a.preservesPitch = true;
      a.onended = resolve;
      a.onerror = () => reject(new Error('Google online voice failed to load – try the Browser voice.'));
      stopCurrent = () => { a.pause(); resolve(); };
      a.play().catch(reject);
    });
  }
}

function stopSpeaking() {
  playToken++;
  if (stopCurrent) { const s = stopCurrent; stopCurrent = null; s(); }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

async function speak(zh) {
  zh = (zh || '').trim();
  if (!zh) { toast('Nothing to play yet'); return; }
  stopSpeaking();
  const token = ++playToken;
  const id = ++speakId;

  // pause the mic so we don't transcribe our own Chinese audio
  playingNow = true;
  if (settings.muteWhilePlaying && listening) { suspended = true; flushInterim(); stopRecognizer(); }
  setMicStatus();

  try {
    // no Chinese voice installed in this browser -> fall back to the free Google voice
    if (settings.engine === 'google' || !chineseVoices().length) await speakGoogle(zh, token);
    else await speakBrowser(zh, token);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    // only the most recent speak() call cleans up (Stop button aborts but still lands here)
    if (id === speakId) {
      playingNow = false;
      stopCurrent = null;
      document.querySelectorAll('.preset.playing').forEach((p) => p.classList.remove('playing'));
      // short gap so the tail of our audio isn't picked up
      setTimeout(() => {
        if (playingNow) return;
        suspended = false;
        startRecognizer();
        setMicStatus();
      }, 400);
      setMicStatus();
    }
  }
}

async function playPhrase(en, zh) {
  addMessage('me', { en, zh });
  await speak(zh);
}

$('#stopBtn').onclick = stopSpeaking;

// ---------- quick type & speak ----------
const quickEn = $('#quickEn');
const quickZh = $('#quickZh');
let quickSeq = 0;
let quickTimer;

async function quickTranslate() {
  const en = quickEn.value.trim();
  const seq = ++quickSeq;
  if (!en) { quickZh.textContent = ''; $('#quickBack').textContent = ''; return ''; }
  quickZh.textContent = '…';
  try {
    const zh = await toChinese(en);
    if (seq !== quickSeq) return zh;
    quickZh.textContent = zh;
    zhBackToEnglish(zh).then((b) => { if (seq === quickSeq) $('#quickBack').textContent = '↩ Means: ' + b; }).catch(() => {});
    return zh;
  } catch (e) {
    quickZh.textContent = '';
    toast('Translation failed – check internet');
    return '';
  }
}

quickEn.addEventListener('input', () => {
  clearTimeout(quickTimer);
  quickTimer = setTimeout(quickTranslate, 700);
});
quickEn.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    clearTimeout(quickTimer);
    const zh = await quickTranslate();
    if (e.ctrlKey && zh) playPhrase(quickEn.value.trim(), zh);
  }
});
$('#quickTranslateBtn').onclick = () => { clearTimeout(quickTimer); quickTranslate(); };
$('#quickPlayBtn').onclick = async () => {
  const en = quickEn.value.trim();
  let zh = quickZh.textContent.trim();
  if (en && (!zh || zh === '…')) zh = await quickTranslate();
  if (zh) playPhrase(en || '(typed Chinese)', zh);
};
$('#quickSaveBtn').onclick = async () => {
  const en = quickEn.value.trim();
  if (!en) { toast('Type a phrase first'); return; }
  let zh = quickZh.textContent.trim();
  if (!zh || zh === '…') zh = await quickTranslate();
  presets.push({ id: uid(), en, zh, zhLang: settings.lang, back: '' });
  savePresets();
  renderPresets();
  toast('Saved as phrase #' + presets.length);
};

// ---------- presets ----------
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }

async function translatePreset(p, card) {
  const en = p.en.trim();
  if (!en) return;
  const zhBox = card?.querySelector('textarea.zh');
  if (zhBox) zhBox.placeholder = 'translating…';
  try {
    p.zh = await toChinese(en);
    p.zhLang = settings.lang;
    savePresets();
    if (zhBox) { zhBox.value = p.zh; autoGrow(zhBox); }
    p.back = await zhBackToEnglish(p.zh);
    savePresets();
    const b = card?.querySelector('.back');
    if (b) b.textContent = '↩ Means: ' + p.back;
  } catch (e) {
    toast('Translation failed – check internet');
  }
}

function renderPresets() {
  const box = $('#presets');
  box.innerHTML = '';
  presets.forEach((p, i) => {
    const card = el('div', 'preset');
    card.dataset.id = p.id;

    const top = el('div', 'preset-top');
    top.appendChild(el('span', 'num', i < 9 ? String(i + 1) : '•'));
    const play = el('button', 'btn btn-primary btn-small', '▶ Play');
    play.onclick = async () => {
      if (!p.zh) await translatePreset(p, card);
      card.classList.add('playing');
      playPhrase(p.en, p.zh);
    };
    top.appendChild(play);
    top.appendChild(el('span', 'spacer'));
    const up = el('button', 'icon-btn', '↑'); up.title = 'Move up';
    up.onclick = () => { if (i > 0) { [presets[i - 1], presets[i]] = [presets[i], presets[i - 1]]; savePresets(); renderPresets(); } };
    const re = el('button', 'icon-btn', '↻'); re.title = 'Re-translate from English';
    re.onclick = () => translatePreset(p, card);
    const del = el('button', 'icon-btn', '✕'); del.title = 'Delete';
    del.onclick = () => {
      if (!confirm('Delete this phrase?')) return;
      presets = presets.filter((x) => x.id !== p.id);
      savePresets(); renderPresets();
    };
    top.append(up, re, del);

    const en = el('textarea', 'en');
    en.rows = 1; en.value = p.en; en.placeholder = 'English phrase…';
    let t;
    en.addEventListener('input', () => {
      autoGrow(en);
      p.en = en.value; savePresets();
      clearTimeout(t);
      t = setTimeout(() => translatePreset(p, card), 800);
    });

    const zh = el('textarea', 'zh');
    zh.rows = 1; zh.lang = 'zh'; zh.value = p.zh; zh.placeholder = 'Chinese (auto-translated, editable)';
    zh.addEventListener('input', () => { autoGrow(zh); p.zh = zh.value; p.back = ''; savePresets(); card.querySelector('.back').textContent = ''; });

    const back = el('div', 'back', p.back ? '↩ Means: ' + p.back : '');

    card.append(top, en, zh, back);
    box.appendChild(card);
    requestAnimationFrame(() => { autoGrow(en); autoGrow(zh); });
  });
}

// translate any phrase whose Chinese is missing or is for a different dialect/script
async function refreshPresetTranslations() {
  for (const p of presets) {
    if (p.en.trim() && (!p.zh || p.zhLang !== settings.lang)) {
      await translatePreset(p, document.querySelector(`.preset[data-id="${p.id}"]`));
    } else if (p.zh && !p.back) {
      try {
        p.back = await zhBackToEnglish(p.zh);
        const b = document.querySelector(`.preset[data-id="${p.id}"] .back`);
        if (b) b.textContent = '↩ Means: ' + p.back;
      } catch {}
    }
  }
  savePresets();
}

$('#addPresetBtn').onclick = () => {
  presets.push({ id: uid(), en: '', zh: '', zhLang: settings.lang, back: '' });
  savePresets(); renderPresets();
  const cards = document.querySelectorAll('.preset textarea.en');
  cards[cards.length - 1]?.focus();
};
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(presets.map(({ en, zh, zhLang }) => ({ en, zh, zhLang })), null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'phrases.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#importInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data)) throw new Error();
    presets = data.filter((x) => x && x.en).map((x) => ({ id: uid(), en: x.en, zh: x.zh || '', zhLang: x.zhLang || 'zh-CN', back: '' }));
    savePresets(); renderPresets(); refreshPresetTranslations();
    toast(`Imported ${presets.length} phrases`);
  } catch { toast('Not a valid phrases file'); }
  e.target.value = '';
};

// ---------- settings UI ----------
function initSettings() {
  const ls = $('#langSelect');
  Object.entries(LANGS).forEach(([k, v]) => { const o = el('option', null, v.label); o.value = k; ls.appendChild(o); });
  ls.value = settings.lang;
  ls.onchange = () => {
    settings.lang = ls.value; saveSettings();
    if (rec) rec.lang = L().rec;
    if (listening) { stopRecognizer(); setTimeout(startRecognizer, 300); }
    renderVoiceSelect();
    trCache.clear();
    refreshPresetTranslations();
    if (quickEn.value.trim()) quickTranslate();
  };

  $('#settingsBtn').onclick = () => $('#settingsPanel').classList.toggle('hidden');

  const eng = $('#engineSelect');
  eng.value = settings.engine;
  eng.onchange = () => { settings.engine = eng.value; saveSettings(); };

  $('#voiceSelect').onchange = (e) => { settings.voice = e.target.value; saveSettings(); };

  const rate = $('#rateInput');
  rate.value = settings.rate;
  $('#rateVal').textContent = settings.rate + '×';
  rate.oninput = () => { settings.rate = Number(rate.value); $('#rateVal').textContent = settings.rate + '×'; saveSettings(); };

  const font = $('#fontInput');
  const applyFont = () => {
    document.documentElement.style.setProperty('--transcript-size', settings.fontSize + 'px');
    $('#fontVal').textContent = settings.fontSize + 'px';
  };
  font.value = settings.fontSize;
  applyFont();
  font.oninput = () => { settings.fontSize = Number(font.value); applyFont(); saveSettings(); };

  const mute = $('#muteChk');
  mute.checked = settings.muteWhilePlaying;
  mute.onchange = () => { settings.muteWhilePlaying = mute.checked; saveSettings(); };

  $('#testVoiceBtn').onclick = async () => {
    const zh = await toChinese('Hello, this is a voice test.').catch(() => '你好，这是语音测试。');
    speak(zh);
  };
}

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { stopSpeaking(); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (/^[1-9]$/.test(e.key)) {
    const card = document.querySelectorAll('.preset')[Number(e.key) - 1];
    card?.querySelector('.btn-primary')?.click();
  }
});

// ---------- boot ----------
initSettings();
renderPresets();
setMicStatus();
refreshPresetTranslations();

if (!SR) {
  banner('⚠ Speech recognition is not available in this browser. Open this page in <b>Google Chrome</b> or <b>Microsoft Edge</b>.');
} else if (location.protocol === 'file:') {
  banner('⚠ Opened as a file. For reliable microphone access, run <b>npm start</b> and use <b>http://localhost:5173</b>.');
}
