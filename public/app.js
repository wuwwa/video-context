(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => fetch(path, opts).then((r) => r.json());

  let tab = 'url';
  let mode = 'scene';
  let job = null;          // latest job view
  let pollTimer = null;
  let previewUrl = null;   // object URL for local preview
  let previewName = null;  // basename of the previewed file (no path)

  // ---------- time helpers (mirror server) ----------
  function parseTime(s) {
    s = (s || '').trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const parts = s.split(':').map((p) => p.trim());
    if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
    let sec = 0; for (const p of parts) sec = sec * 60 + parseFloat(p);
    return sec;
  }
  function fmtLabel(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Transient one-line status next to the Run button.
  function flash(msg, cls) {
    const s = $('status');
    s.textContent = msg || '';
    s.className = 'resCount' + (cls ? ' ' + cls : '');
  }

  // Paint the full server log (newest at bottom); keep pinned to bottom while scrolled there.
  function renderLog(lines) {
    if (!lines || !lines.length) return;
    const el = $('log');
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    el.innerHTML = lines
      .map((l) => `<span class="line${/^ERROR/.test(l) ? ' err' : ''}">${escapeHtml(l)}</span>`)
      .join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // Drive the progress bar from a job's { phase, ratio } plus its status.
  function setBar(progress, status) {
    const wrap = $('progress'), fill = $('progFill'), label = $('progLabel');
    wrap.classList.remove('indeterminate', 'done', 'err');
    const phase = progress && progress.phase ? progress.phase : (status || '');
    if (status === 'error' || phase === 'error') {
      wrap.classList.add('err'); fill.style.width = '100%'; label.textContent = 'error'; return;
    }
    if (status === 'done' || phase === 'done') {
      wrap.classList.add('done'); fill.style.width = '100%'; label.textContent = 'done'; return;
    }
    const ratio = progress ? progress.ratio : null;
    if (ratio == null) {
      wrap.classList.add('indeterminate'); fill.style.width = '35%';
      label.textContent = phase ? `${phase}…` : '';
    } else {
      const pct = Math.round(ratio * 100);
      fill.style.width = pct + '%';
      label.textContent = `${phase} · ${pct}%`;
    }
  }

  // ---------- health ----------
  async function loadHealth() {
    let h;
    try { h = await api('/api/health'); } catch { return; }
    const b = $('banner');
    if (!h.ffmpeg.found) {
      b.className = 'banner err show';
      b.innerHTML = `<div><b>ffmpeg not found.</b> Install it: <code>${h.hints.ffmpeg}</code></div>`;
    } else if (!h.ytdlp.found) {
      b.className = 'banner warn show';
      b.innerHTML = `<div><b>yt-dlp not found</b> — URL mode is disabled. Local files work fine. To enable URLs: <code>${h.hints.ytdlp}</code> then refresh.</div>`;
    } else {
      b.className = 'banner';
    }
    window._urlReady = h.urlReady;
    refreshRunState();
  }

  // ---------- tabs ----------
  function setTab(t) {
    tab = t;
    $('tabUrl').classList.toggle('on', t === 'url');
    $('tabUrl').setAttribute('aria-selected', t === 'url');
    $('tabLocal').classList.toggle('on', t === 'local');
    $('tabLocal').setAttribute('aria-selected', t === 'local');
    $('paneUrl').style.display = t === 'url' ? '' : 'none';
    $('paneLocal').style.display = t === 'local' ? '' : 'none';
    refreshRunState();
  }
  $('tabUrl').onclick = () => setTab('url');
  $('tabLocal').onclick = () => setTab('local');

  // ---------- mode (card radiogroup) ----------
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.modecard').forEach((c) => {
      const on = c.dataset.mode === m;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('budgetField').style.display = m === 'scene' ? '' : 'none';
    $('everyField').style.display = m === 'interval' ? '' : 'none';
    $('modeFields').style.display = (m === 'scene' || m === 'interval') ? '' : 'none';
    $('manualBox').style.display = m === 'manual' ? '' : 'none';
    refreshRunState();
  }
  document.querySelectorAll('.modecard').forEach((c) => {
    c.addEventListener('click', () => setMode(c.dataset.mode));
  });

  // ---------- local file: Browse… (native picker) + drop-to-preview ----------
  $('browseBtn').onclick = async () => {
    const b = $('browseBtn'); const prev = b.textContent;
    b.disabled = true; b.textContent = 'Opening…';
    try {
      const r = await api('/api/pick');
      if (r && r.path) { $('localPath').value = r.path; updateFileCard(); refreshRunState(); }
      else if (r && r.error) { flash('Picker: ' + r.error, 'err'); }
    } catch { flash('Could not open the file picker.', 'err'); }
    b.disabled = false; b.textContent = prev;
  };

  const drop = $('drop');
  drop.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'video/*';
    inp.onchange = (e) => { if (e.target.files[0]) loadPreview(e.target.files[0]); };
    inp.click();
  };
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('video')) loadPreview(f);
  });
  function loadPreview(f) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    previewName = f.name;
    const v = $('video');
    v.src = previewUrl;
    $('vidwrap').classList.remove('hide');
    $('markRow').hidden = false;
    updateFileCard();
    refreshRunState();
    flash('Preview loaded — click Browse… to set its path for extraction.', 'muted');
  }

  // Reflect the local-file state: a real path (ready) vs preview-only (needs Browse…).
  function updateFileCard() {
    const p = $('localPath').value.trim();
    const fc = $('fileCard');
    if (p) {
      fc.hidden = false; fc.className = 'filecard ok';
      $('fcName').textContent = p.split(/[\\/]/).pop();
      $('fcState').textContent = 'ready';
    } else if (previewName) {
      fc.hidden = false; fc.className = 'filecard warn';
      $('fcName').textContent = previewName;
      $('fcState').textContent = 'set path via Browse…';
    } else {
      fc.hidden = true;
    }
  }

  // Mark the current preview time -> Manual timestamp list (switches to Manual mode).
  $('capBtn').onclick = () => {
    const v = $('video');
    if (!v.src) return;
    if (mode !== 'manual') setMode('manual');
    const line = fmtLabel(v.currentTime);
    const ta = $('tsList');
    ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n' + line : line;
    refreshRunState();
    flash('Marked ' + line, 'muted');
  };

  // ---------- run state ----------
  function currentSource() {
    if (tab === 'url') {
      const url = $('url').value.trim();
      return url ? { sourceType: 'url', url } : null;
    }
    const p = $('localPath').value.trim();
    return p ? { sourceType: 'local', path: p } : null;
  }
  function refreshRunState() {
    const src = currentSource();
    $('methodPanel').classList.toggle('locked', !src);
    let ok = !!src;
    if (tab === 'url' && window._urlReady === false) ok = false;
    if (src && mode === 'manual') {
      const has = $('tsList').value.split('\n').some((l) => parseTime(l) != null);
      $('manualErr').style.display = has ? 'none' : 'flex';
      if (!has) ok = false;
    } else {
      $('manualErr').style.display = 'none';
    }
    $('run').disabled = !ok;
  }
  $('url').oninput = refreshRunState;
  $('localPath').oninput = () => { updateFileCard(); refreshRunState(); };
  $('tsList').oninput = refreshRunState;

  // ---------- run a job ----------
  $('run').onclick = async () => {
    const src = currentSource();
    if (!src) return;
    const body = { ...src, method: mode, ext: $('ext').value, wantSubs: $('wantSubs').checked };
    if (mode === 'scene') body.budget = parseInt($('budget').value, 10) || 15;
    if (mode === 'interval') body.every = parseFloat($('every').value) || 30;
    const start = parseTime($('start').value);
    const end = parseTime($('end').value);
    if (start != null && start >= 0) body.start = start;
    if (end != null && end >= 0) body.end = end;
    if (body.start != null && body.end != null && body.end <= body.start) {
      flash('Clip end must be after clip start.', 'err'); return;
    }
    if (mode === 'manual') {
      const times = $('tsList').value.split('\n').map(parseTime).filter((t) => t != null && t >= 0);
      if (!times.length) { flash('Add at least one timestamp.', 'err'); return; }
      body.timestamps = times;
    }
    // enter running state
    $('run').disabled = true;
    $('errLine').hidden = true;
    $('progress').hidden = false;
    $('logwrap').hidden = false; $('logwrap').open = false;
    $('log').innerHTML = '';
    setBar({ phase: 'starting', ratio: null });
    flash('Starting…', 'muted');
    let resp;
    try { resp = await api('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { flash('Request failed: ' + e.message, 'err'); $('run').disabled = false; return; }
    if (resp.error) { flash('Error: ' + resp.error, 'err'); $('run').disabled = false; return; }
    poll(resp.jobId);
  };

  function poll(id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      let v;
      try { v = await api('/api/jobs/' + id); } catch { return; }
      job = v;
      const last = (v.log && v.log.length) ? v.log[v.log.length - 1] : '';
      flash(last, v.status === 'error' ? 'err' : 'muted');
      renderLog(v.log);
      setBar(v.progress, v.status);
      if (v.status === 'error') {
        const e = $('errLine'); e.hidden = false; e.textContent = v.error || last || 'Something went wrong.';
      }
      if (v.status === 'done' || v.status === 'error') {
        clearInterval(pollTimer); pollTimer = null;
        $('run').disabled = false;
        if (v.status === 'done') render(v);
      }
    }, 500);
  }

  // ---------- render results ----------
  function render(v) {
    const panel = $('resPanel');
    panel.style.display = 'block';
    panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');

    const win = v.window ? ` · ${fmtLabel(v.window.start)}–${v.window.end != null ? fmtLabel(v.window.end) : 'end'}` : '';
    const n = v.frames.length;
    $('resCount').textContent = `${n} frame${n === 1 ? '' : 's'}`;
    $('resCtx').textContent = `${n} frames · ${v.method || ''}${win} · output/${v.pkgName}/`;

    // contact sheet (cache-bust: it can be rebuilt on reselect/manual-add)
    if (v.sheet) {
      const src = `${v.sheet}?t=${Date.now()}`;
      $('sheetImg').src = src; $('sheetLink').href = src;
      $('sheetwrap').style.display = 'block';
    } else {
      $('sheetwrap').style.display = 'none';
    }

    const grid = $('grid'); grid.innerHTML = '';
    v.frames.forEach((f) => {
      const card = document.createElement('div'); card.className = 'fcard'; card.dataset.index = f.index;
      const img = document.createElement('img'); img.src = f.url; img.alt = fmtLabel(f.tSec); img.loading = 'lazy';
      img.onclick = () => window.open(f.url, '_blank');
      const cap = document.createElement('div'); cap.className = 'cap';
      const b = document.createElement('b'); b.textContent = fmtLabel(f.tSec);
      const keep = document.createElement('label'); keep.className = 'keep';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.onchange = () => { card.classList.toggle('dropped', !cb.checked); updateApplyState(); };
      keep.appendChild(cb); keep.appendChild(document.createTextNode('keep'));
      cap.appendChild(b); cap.appendChild(keep);
      card.appendChild(img); card.appendChild(cap);
      if (f.transcript) { const tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = '“' + f.transcript + '”'; card.appendChild(tx); }
      grid.appendChild(card);
    });
    updateApplyState();
  }

  function updateApplyState() {
    const cards = [...document.querySelectorAll('.fcard')];
    const dropped = cards.filter((c) => !c.querySelector('input').checked).length;
    const btn = $('applySel');
    btn.disabled = dropped === 0;
    btn.textContent = dropped > 0 ? `Apply selection (remove ${dropped})` : 'Apply selection';
  }

  // save all
  $('saveAll').onclick = () => { if (job) window.location = `/api/jobs/${job.id}/package.zip`; };
  // reveal
  $('reveal').onclick = async () => {
    if (!job) return;
    const r = await api(`/api/jobs/${job.id}/reveal`);
    flash('Opened ' + (r.path || 'output folder'), 'muted');
  };
  // apply selection
  $('applySel').onclick = async () => {
    if (!job) return;
    const keep = [...document.querySelectorAll('.fcard')]
      .filter((c) => c.querySelector('input').checked)
      .map((c) => parseInt(c.dataset.index, 10));
    if (!keep.length) { flash('Keep at least one frame.', 'err'); return; }
    const v = await api(`/api/jobs/${job.id}/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepIndexes: keep }) });
    if (v.error) { flash(v.error, 'err'); return; }
    job = v; render(v);
    flash('Selection applied — manifest rewritten.', 'muted');
  };

  // ---------- init ----------
  setMode('scene');
  setTab('url');
  updateFileCard();
  loadHealth();
  refreshRunState();
})();
