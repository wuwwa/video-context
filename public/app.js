(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => fetch(path, opts).then((r) => r.json());

  let tab = 'url';
  let job = null;          // latest job view
  let pollTimer = null;
  let previewUrl = null;   // object URL for local preview

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

  function log(msg, cls) { $('log').innerHTML = cls ? `<span class="${cls}">${msg}</span>` : msg; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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
    $('tabLocal').classList.toggle('on', t === 'local');
    $('paneUrl').style.display = t === 'url' ? '' : 'none';
    $('paneLocal').style.display = t === 'local' ? '' : 'none';
    refreshRunState();
  }
  $('tabUrl').onclick = () => setTab('url');
  $('tabLocal').onclick = () => setTab('local');

  // ---------- mode ----------
  function setMode() {
    const m = $('mode').value;
    $('budgetField').style.display = m === 'scene' ? '' : 'none';
    $('everyField').style.display = m === 'interval' ? '' : 'none';
    // Clip start/end apply to every mode, so they stay visible.
    $('manualBox').style.display = m === 'manual' ? '' : 'none';
    refreshRunState();
  }
  $('mode').onchange = setMode;

  // ---------- local preview (drag/drop or picker for scrubbing) ----------
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
    const v = $('video');
    v.src = previewUrl;
    $('vidwrap').classList.remove('hide');
    // prefill path field with the file name as a hint (browser can't give the full path)
    if (!$('localPath').value) $('localPath').value = f.name;
    $('localPath').placeholder = 'paste the FULL path to ' + f.name;
    $('capBtn').disabled = false;
    $('capHint').textContent = 'scrub the video, then capture the current time';
    log(`Preview loaded — paste the full path to “${f.name}” in the box above so the server can read it.`, 'muted');
  }

  // capture current preview time -> manual list
  $('capBtn').onclick = () => {
    const v = $('video');
    const line = fmtLabel(v.currentTime);
    const ta = $('tsList');
    ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n' + line : line;
    log(`Added ${line} to timestamps.`, 'muted');
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
    let ok = !!src;
    if (tab === 'url' && window._urlReady === false) ok = false;
    $('run').disabled = !ok;
  }
  $('url').oninput = refreshRunState;
  $('localPath').oninput = refreshRunState;

  // ---------- run a job ----------
  $('run').onclick = async () => {
    const src = currentSource();
    if (!src) return;
    const mode = $('mode').value;
    const body = { ...src, method: mode, ext: $('ext').value, wantSubs: $('wantSubs').checked };
    if (mode === 'scene') body.budget = parseInt($('budget').value, 10) || 15;
    if (mode === 'interval') body.every = parseFloat($('every').value) || 30;
    // clip window — applies to all modes (only the section is fetched/scanned)
    const start = parseTime($('start').value);
    const end = parseTime($('end').value);
    if (start != null && start >= 0) body.start = start;
    if (end != null && end >= 0) body.end = end;
    if (body.start != null && body.end != null && body.end <= body.start) {
      log('Clip end must be after clip start.', 'err'); $('run').disabled = false; return;
    }
    if (mode === 'manual') {
      const times = $('tsList').value.split('\n').map(parseTime).filter((t) => t != null && t >= 0);
      if (!times.length) { log('Add at least one timestamp for manual mode.', 'err'); return; }
      body.timestamps = times;
    }
    $('run').disabled = true;
    $('log').innerHTML = '';
    log('Starting…');
    setBar({ phase: 'starting', ratio: null });
    let resp;
    try { resp = await api('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { log('Request failed: ' + e.message, 'err'); $('run').disabled = false; return; }
    if (resp.error) { log('Error: ' + resp.error, 'err'); $('run').disabled = false; return; }
    poll(resp.jobId);
  };

  function poll(id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      let v;
      try { v = await api('/api/jobs/' + id); } catch { return; }
      job = v;
      $('status').textContent = v.status;
      renderLog(v.log);
      setBar(v.progress, v.status);
      if (v.status === 'done' || v.status === 'error') {
        clearInterval(pollTimer); pollTimer = null;
        $('run').disabled = false;
        if (v.status === 'done') render(v);
      }
    }, 600);
  }

  // ---------- render results ----------
  function render(v) {
    $('resPanel').style.display = 'block';
    const win = v.window ? ` · window ${fmtLabel(v.window.start)}–${v.window.end != null ? fmtLabel(v.window.end) : 'end'}` : '';
    $('resCount').textContent = `${v.frames.length} frame${v.frames.length === 1 ? '' : 's'}${win} · output/${v.pkgName}/`;

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
      const img = document.createElement('img'); img.src = f.url; img.alt = fmtLabel(f.tSec);
      img.onclick = () => window.open(f.url, '_blank');
      const cap = document.createElement('div'); cap.className = 'cap';
      const b = document.createElement('b'); b.textContent = fmtLabel(f.tSec);
      const keep = document.createElement('label'); keep.className = 'keep';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.style.marginRight = '4px';
      cb.onchange = () => { card.classList.toggle('dropped', !cb.checked); $('applySel').style.display = 'inline-block'; };
      keep.appendChild(cb); keep.appendChild(document.createTextNode('keep'));
      cap.appendChild(b); cap.appendChild(keep);
      card.appendChild(img); card.appendChild(cap);
      if (f.transcript) { const tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = '“' + f.transcript + '”'; card.appendChild(tx); }
      grid.appendChild(card);
    });
    $('applySel').style.display = 'none';
  }

  // save all
  $('saveAll').onclick = () => { if (job) window.location = `/api/jobs/${job.id}/package.zip`; };
  // reveal
  $('reveal').onclick = async () => {
    if (!job) return;
    const r = await api(`/api/jobs/${job.id}/reveal`);
    log('Opened ' + (r.path || 'output folder'), 'muted');
  };
  // apply selection
  $('applySel').onclick = async () => {
    if (!job) return;
    const keep = [...document.querySelectorAll('.fcard')]
      .filter((c) => c.querySelector('input').checked)
      .map((c) => parseInt(c.dataset.index, 10));
    if (!keep.length) { log('Keep at least one frame.', 'err'); return; }
    const v = await api(`/api/jobs/${job.id}/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepIndexes: keep }) });
    if (v.error) { log(v.error, 'err'); return; }
    job = v; render(v);
    log('Selection applied — manifest rewritten.', 'muted');
  };

  // ---------- init ----------
  setMode();
  setTab('url');
  loadHealth();
})();
