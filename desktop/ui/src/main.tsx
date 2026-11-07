import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Crop, FolderOpen, Loader2, MoreHorizontal, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Select } from './components/arc/select/select';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './components/arc/foundation.css';
import './style.css';

type Cue = { start: number; end: number; text: string };
type Asset = { id: string; path: string; name: string; duration: number; last_frame_time?: number; width: number; height: number; codec: string; source_url?: string; subtitles: { index: number; language: string; title: string; readable: boolean }[] };
type Frame = { id: string; asset_id: string; source: string; time: number; timestamp: string; width: number; height: number; caption: string };
type Export = { folder: string; files: string[]; frame_count: number; page_count: number };
type Settings = { width: number; format: string; quality: number; subtitles: string; crop: number[] | null };
type Task = { id?: string; message: string; progress: number };
const key = new URLSearchParams(location.search).get('key') || '';
const media = (kind: string, id: string) => `/${kind}/${id}?key=${encodeURIComponent(key)}`;
async function request(method: string, data: unknown = {}): Promise<any> {
  const response = await (await fetch(`/api/${method}?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (!response.ok) throw new Error(response.error || 'Could not complete this action.');
  return response.result;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const amount = (count: number, name: string) => `${count.toLocaleString()} ${name}${count === 1 ? '' : 's'}`;
function label(seconds: number, precise = false) {
  const millis = Math.max(0, Math.round((seconds || 0) * 1000));
  const t = Math.floor(millis / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${precise ? '.' + String(millis % 1000).padStart(3, '0') : ''}`;
}
function ErrorNotice({ error, close }: { error: string; close: () => void }) {
  return <div className="error-notice" role="alert"><span>{error}</span><button className="icon-button" onClick={close} aria-label="Dismiss error"><X size={16}/></button></div>;
}

function App() {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exported, setExported] = useState<Set<string>>(new Set());
  const [output, setOutput] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [dialog, setDialog] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const [track, setTrack] = useState('off');
  const [cues, setCues] = useState<Cue[]>([]);
  const [vtt, setVtt] = useState('');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<Settings>({ width: 0, format: 'png', quality: 95, subtitles: 'auto', crop: null });
  const [cropping, setCropping] = useState(false);
  const [lastExport, setLastExport] = useState<Export | null>(null);
  const [preview, setPreview] = useState<Frame | null>(null);
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('1080');
  const [language, setLanguage] = useState('en');
  const [downloadSubs, setDownloadSubs] = useState('auto');
  const [embed, setEmbed] = useState(true);
  const [sampleScope, setSampleScope] = useState('whole');
  const [sampleEvery, setSampleEvery] = useState('2');
  const [sampleStart, setSampleStart] = useState('00:00');
  const [sampleEnd, setSampleEnd] = useState('');
  const [exportKind, setExportKind] = useState('reference');
  const [copied, setCopied] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cropOrigin = useRef<number[] | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  function menuDialog(name: string) { if (menuRef.current) { menuRef.current.open = false; menuRef.current.querySelector('summary')?.focus(); } openDialog(name); }
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menuRef.current?.open) { menuRef.current.open = false; menuRef.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  function openDialog(name: string) { dialogOpener.current = document.activeElement as HTMLElement; setDialog(name); }
  function restoreFocus(event: Event) { event.preventDefault(); dialogOpener.current?.focus({ preventScroll: true }); }
  function openPreview(frame: Frame) { dialogOpener.current = document.activeElement as HTMLElement; setPreview(frame); }
  const busy = Boolean(task);

  const showError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function refreshFrames(selectNew = true) {
    const state = await request('bootstrap');
    setFrames(state.frames);
    if (selectNew) setSelected(old => new Set([...old, ...state.frames.filter((f: Frame) => !frames.some(previous => previous.id === f.id)).map((f: Frame) => f.id)]));
  }
  async function loadTrack(a: Asset, choice: string) {
    const data = await request('subtitles', { asset_id: a.id, track: choice });
    setTrack(data.track == null ? 'off' : String(data.track));
    setCues(data.cues);
    setVtt(data.vtt);
  }
  async function loadAsset(a: Asset) {
    setAsset(a); setTime(0); setTimeDraft(null); setPlaying(false); setQuery(''); setCropping(false);
    setSettings(s => ({ ...s, crop: null }));
    setSampleScope('whole'); setSampleStart('00:00'); setSampleEnd(label(a.last_frame_time ?? Math.max(0, a.duration - 0.05), true));
    setTrack('off'); setCues([]); setVtt('');
    setTask({ message: 'Reading subtitles', progress: 0.8 });
    try { await loadTrack(a, 'auto'); }
    catch (e) { showError(e); }
    finally { setTask(null); }
    if (a.subtitles.length && a.subtitles.every(s => !s.readable)) setNotice('This video has image-based subtitles. Text captions need OCR, which is not included.');
  }
  useEffect(() => {
    request('bootstrap').then(state => {
      setOutput(state.output); setDownloadDir(state.output); setFrames(state.frames); setSelected(new Set(state.frames.map((f: Frame) => f.id)));
      if (state.asset) void loadAsset(state.asset);
    }).catch(showError);
  }, []);
  useEffect(() => {
    if (!vtt || track === 'off') return;
    const source = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    const element = document.createElement('track'); element.kind = 'subtitles'; element.label = 'Selected subtitles'; element.srclang = 'und'; element.src = source; element.default = true;
    const enable = () => { element.track.mode = 'showing'; };
    element.addEventListener('load', enable); video.current?.appendChild(element); element.track.mode = 'showing';
    return () => { element.removeEventListener('load', enable); element.remove(); URL.revokeObjectURL(source); };
  }, [vtt, track, asset?.id]);

  async function runTask(method: string, payload: unknown) {
    setError(''); setNotice(''); setTask({ message: 'Starting', progress: 0 });
    try {
      const started = await request(method, payload);
      while (true) {
        const job = await request('job', { id: started.job_id });
        setTask({ id: job.id, message: job.message, progress: job.progress });
        if (job.status === 'complete') { await refreshFrames(); return job.result; }
        if (job.status === 'cancelled') { await refreshFrames(); setNotice('Cancelled. Completed frames are still in the tray.'); return null; }
        if (job.status === 'failed') { await refreshFrames(); throw new Error(job.error); }
        await delay(250);
      }
    } catch (e) { showError(e); return null; }
    finally { setTask(null); }
  }
  async function openVideo() {
    if (busy) return;
    setError(''); setNotice(''); setTask({ message: 'Opening video', progress: 0 });
    try { const result = await request('choose_video'); if (result.asset) await loadAsset(result.asset); }
    catch (e) { showError(e); }
    finally { setTask(null); }
  }
  const capture = useCallback(async () => {
    if (!asset || busy || !video.current) return;
    const at = video.current.currentTime;
    video.current.pause();
    await runTask('capture', { asset_id: asset.id, at, settings: { ...settings, subtitles: track } });
  }, [asset, busy, settings, track]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dialog || preview || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable],[role="combobox"]'))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); void capture(); }
      if (e.code === 'Space' && video.current && asset && !(e.target instanceof HTMLElement && e.target.closest('button'))) { e.preventDefault(); video.current.paused ? void video.current.play() : video.current.pause(); }
      if (e.key === 'ArrowLeft' && video.current) { e.preventDefault(); video.current.currentTime = Math.max(0, video.current.currentTime - 5); }
      if (e.key === 'ArrowRight' && video.current && asset) { e.preventDefault(); video.current.currentTime = Math.min(asset.duration - .05, video.current.currentTime + 5); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [capture, dialog, preview, asset]);
  async function chooseFolder(which: 'download' | 'export') {
    try {
      const result = await request('choose_folder', { path: which === 'download' ? downloadDir : output });
      if (result.path) (which === 'download' ? setDownloadDir : setOutput)(result.path);
    } catch (e) { showError(e); }
  }
  async function downloadVideo() {
    if (!url.trim() || !downloadDir.trim()) return;
    setDialog(null);
    const result = await runTask('download', { url, directory: downloadDir, quality, language, subtitles: downloadSubs, embed });
    if (result?.asset) { await loadAsset(result.asset); if (result.warning) setNotice(result.warning); }
  }
  async function sample() {
    if (!asset) return;
    const options: Record<string, unknown> = { every: Number(sampleEvery) };
    if (sampleScope === 'range') { options.start = sampleStart; options.end = sampleEnd; }
    setDialog(null);
    await runTask('sample', { asset_id: asset.id, options, settings: { ...settings, subtitles: track } });
  }
  async function exportFrames() {
    setDialog(null);
    const ids = frames.filter(f => selected.has(f.id)).map(f => f.id);
    const result = await runTask('export', { frame_ids: ids, directory: output, kind: exportKind });
    if (result) { setLastExport(result); setExported(old => new Set([...old, ...ids])); }
  }
  async function removeFrame(id: string) {
    try { await request('remove_frame', { id }); setFrames(old => old.filter(f => f.id !== id)); setSelected(old => new Set([...old].filter(value => value !== id))); }
    catch (e) { showError(e); }
  }
  function seek(t: number) { if (video.current) { video.current.currentTime = t; video.current.pause(); setTime(t); setTimeDraft(null); } }
  function parseInput(value: string) {
    const parts = value.trim().split(':');
    if (parts.length > 3 || parts.some((p, i) => !/^\d+(?:\.\d+)?$/.test(p) || (i > 0 && Number(p) >= 60))) return null;
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
  }
  function commitTime() {
    if (timeDraft === null || !asset) return;
    const chosen = parseInput(timeDraft);
    if (chosen === null || chosen < 0 || chosen > asset.duration) { setError('Enter a time within the video.'); setTimeDraft(null); return; }
    seek(chosen);
  }
  function togglePlay() { if (!video.current) return; video.current.paused ? void video.current.play().catch(showError) : video.current.pause(); }
  function cropPoint(e: React.PointerEvent) {
    const rect = stage.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))];
  }
  function dragCrop(e: React.PointerEvent) {
    if (!cropOrigin.current) return;
    const point = cropPoint(e), origin = cropOrigin.current;
    setSettings(s => ({ ...s, crop: [Math.min(origin[0], point[0]), Math.min(origin[1], point[1]), Math.abs(point[0] - origin[0]), Math.abs(point[1] - origin[1])] }));
  }
  const interval = Number(sampleEvery);
  const pointStart = sampleScope === 'whole' ? 0 : parseInput(sampleStart);
  const pointEnd = asset ? (sampleScope === 'whole' ? (asset.last_frame_time ?? asset.duration) : parseInput(sampleEnd)) : 0;
  const rangeValid = Boolean(asset && pointStart !== null && pointEnd !== null && pointStart >= 0 && pointStart <= pointEnd && pointEnd <= asset.duration);
  const plannedCount = rangeValid && Number.isFinite(interval) && interval > 0 ? Math.floor((Math.min(pointEnd!, asset!.last_frame_time ?? asset!.duration) - pointStart!) / interval) + 1 : 0;
  // Keep the timeline cheap for thousands of planned captures; the count stays exact.
  const markerStride = Math.max(1, Math.ceil(plannedCount / 100));
  const samplePoints = plannedCount > 0 ? Array.from({ length: Math.ceil(plannedCount / markerStride) }, (_, i) => pointStart! + i * markerStride * interval) : [];
  const selectedCount = frames.filter(f => selected.has(f.id)).length;
  const visibleCues = cues.filter(c => !query || c.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const commands = `framegrab-cli.exe download "VIDEO_URL" --out "videos"\n\nframegrab-cli.exe frames "video.mp4" --every 2 --out "references"\n\nframegrab-cli.exe frames "video.mp4" --every 1 --start 01:00 --end 02:00 --out "references"\n\nframegrab-cli.exe transcript "video.mp4" --query "search words"`;

  return <div className={`app-shell ${frames.length ? 'has-frames' : ''} ${sampleScope === 'range' ? 'has-range' : ''}`}>
    <header className="app-header">
      <h1>framegrab</h1>
      {asset && <span className="filename" title={asset.path}>{asset.name}</span>}
      <div className="header-actions">
        <Button variant={asset ? 'secondary' : 'primary'} onClick={openVideo} disabled={busy}>Open video</Button>
        <Button variant="secondary" onClick={() => openDialog('download')} disabled={busy}>Download</Button>
        <details className="more-menu" ref={menuRef}>
          <summary aria-label="More actions" title="More actions"><MoreHorizontal size={20}/></summary>
          <nav aria-label="More actions">
            <button disabled={!asset || busy} onClick={() => menuDialog('transcript')}>Transcript</button>
            <button disabled={busy} onClick={() => menuDialog('settings')}>Settings</button>
            <button onClick={() => menuDialog('commands')}>Commands</button>
          </nav>
        </details>
      </div>
    </header>
    <main>
      <section className="player" aria-label="Video">
        <div className={`video-stage ${asset ? 'loaded' : ''}`}>
          {asset ? <div className="video-holder" ref={stage} style={{ '--video-aspect': asset.width / asset.height, aspectRatio: `${asset.width}/${asset.height}`, maxWidth: asset.height > asset.width ? 340 : undefined } as React.CSSProperties}>
            <video key={asset.id} ref={video} src={media('media', asset.id)} controls={false} muted={muted} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={() => { if (!cropping) togglePlay(); }} playsInline preload="metadata" onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onError={() => setError('Preview unavailable. Try an H.264 MP4.')} aria-label="Video preview"/>
            {cropping && <div className="crop-layer" onPointerDown={e => { cropOrigin.current = cropPoint(e); e.currentTarget.setPointerCapture(e.pointerId); video.current?.pause(); }} onPointerMove={dragCrop} onPointerUp={e => { dragCrop(e); cropOrigin.current = null; }} onPointerCancel={() => { cropOrigin.current = null; }} aria-label="Drag to crop"/>}
            {settings.crop && <div className="crop-box" style={{ left: `${settings.crop[0] * 100}%`, top: `${settings.crop[1] * 100}%`, width: `${settings.crop[2] * 100}%`, height: `${settings.crop[3] * 100}%` }}/>}
          </div> : <span className="no-video">No video</span>}
        </div>
        {asset && <>
          <div className="timeline">
            <button className="tool-button playback" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
            <div className="timeline-track">
              <input type="range" min="0" max={asset.duration} step="0.001" value={Math.min(time, asset.duration)} disabled={busy || cropping} onChange={e => seek(Number(e.target.value))} aria-label="Video position"/>
              <div className="sample-markers">{samplePoints.map((point, i) => <button key={i} tabIndex={-1} className={`sample-marker ${Math.abs(time - point) < .12 ? 'current' : ''}`} style={{ left: `${point / asset.duration * 100}%` }} onClick={() => seek(point)} title={label(point, true)} aria-label={`Sample point ${i + 1} at ${label(point, true)}`}/>)}</div>
            </div>
            <input className="time-input" value={timeDraft ?? label(time, true)} onChange={e => setTimeDraft(e.target.value)} onBlur={commitTime} onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { e.preventDefault(); setTimeDraft(null); } }} aria-label="Timestamp"/>
            <span className="duration">/ {label(asset.duration)}</span>
            <button className="tool-button mute" onClick={() => setMuted(v => !v)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
          </div>
          <div className="sampler-bar">
            <div className="sample-interval"><label htmlFor="sample-interval">Every</label><input id="sample-interval" type="range" min="1" max="10" step="1" value={Math.max(1, Math.min(10, interval || 1))} onChange={e => setSampleEvery(e.target.value)} disabled={busy} aria-label="Capture interval slider"/><input className="interval-input" type="number" min="0.01" step="any" value={sampleEvery} onChange={e => setSampleEvery(e.target.value)} disabled={busy} aria-label="Interval in seconds"/><span>sec</span></div>
            <select className="scope-select" aria-label="Capture range" value={sampleScope} onChange={e => setSampleScope(e.target.value)} disabled={busy}><option value="whole">Whole video</option><option value="range">Range</option></select>
            <Button className="sample-action" onClick={() => sample()} disabled={busy || plannedCount < 1 || plannedCount > 10000}>Sample {plannedCount > 0 ? amount(plannedCount, 'frame') : 'frames'}</Button>
            <Button variant="secondary" onClick={capture} disabled={busy} title="Capture this frame (C)" aria-keyshortcuts="c">Capture</Button>
            <div className="player-options">
              {asset.subtitles.length > 0 && <><label className="sr-only" htmlFor="subtitle-track">Subtitles</label><select id="subtitle-track" value={track} disabled={busy} onChange={async e => { setTask({ message: 'Loading subtitles', progress: .5 }); try { await loadTrack(asset, e.target.value); } catch (e) { showError(e); } finally { setTask(null); } }}><option value="off">Subtitles off</option>{asset.subtitles.map(s => <option key={s.index} value={String(s.index)} disabled={!s.readable}>{s.title && !/handler/i.test(s.title) ? s.title : s.language === 'und' ? 'Subtitles' : s.language.toUpperCase()}{!s.readable ? ' (image)' : ''}</option>)}</select></>}
              <button className={`tool-button ${cropping ? 'active' : ''}`} disabled={busy} onClick={() => setCropping(v => !v)} aria-pressed={cropping} title={cropping ? 'Finish crop' : 'Crop'}><Crop size={17}/><span>{cropping ? 'Done' : 'Crop'}</span></button>
              {settings.crop && <button className="text-button" onClick={() => setSettings(s => ({ ...s, crop: null }))}>Reset</button>}
            </div>
          </div>
          {sampleScope === 'range' && <div className="range-fields"><label>Start<input value={sampleStart} disabled={busy} onChange={e => setSampleStart(e.target.value)} aria-label="Range start"/></label><span>→</span><label>End<input value={sampleEnd} disabled={busy} onChange={e => setSampleEnd(e.target.value)} aria-label="Range end"/></label>{!rangeValid && <span className="range-error">Enter a range within the video.</span>}</div>}
          {plannedCount > 10000 && <p className="range-error">More than 10,000 frames. Increase the interval or choose a shorter range.</p>}
        </>}
      </section>
      {task && <div className="task-status" role="status"><Loader2 size={15} className="spin"/><span>{task.message}</span><progress max={1} value={task.progress}/>{task.id && <button className="text-button" onClick={() => request('cancel', { id: task.id }).catch(showError)}>Cancel</button>}</div>}
      {error && <ErrorNotice error={error} close={() => setError('')}/>}
      {notice && <div className="inline-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {frames.length > 0 && <section className="frames" aria-label="Captured frames">
        <div className="frames-toolbar"><h2>Frames <span>{frames.length}</span></h2><label className="select-all"><input type="checkbox" disabled={busy} checked={selectedCount === frames.length} onChange={() => setSelected(selectedCount === frames.length ? new Set() : new Set(frames.map(f => f.id)))}/>All</label><Button variant="secondary" onClick={() => openDialog('export')} disabled={!selectedCount || busy}>Save{selectedCount !== frames.length ? ` ${selectedCount}` : ''}…</Button></div>
        <div className="frame-strip">{frames.map((frame, i) => <article className="frame-item" key={frame.id}>
          <div className={`frame-image ${selected.has(frame.id) ? 'selected' : ''}`}><button className="image-preview" onClick={() => openPreview(frame)} aria-label={`Preview frame ${i + 1}`}><img loading="lazy" decoding="async" src={media('thumb', frame.id)} alt={frame.caption || `${frame.source} at ${frame.timestamp}`}/></button><input type="checkbox" checked={selected.has(frame.id)} aria-label={`Select frame ${i + 1}`} onChange={() => setSelected(old => { const next = new Set(old); next.has(frame.id) ? next.delete(frame.id) : next.add(frame.id); return next; })}/><button className="remove-frame" disabled={busy} onClick={() => removeFrame(frame.id)} aria-label={`Remove frame ${i + 1}`}><X size={14}/></button></div>
          <div className="frame-caption"><span>{label(frame.time, true)}</span>{exported.has(frame.id) && <Check size={12} aria-label="Saved"/>}</div>
        </article>)}</div>
      </section>}
      {lastExport && <div className="saved-result" role="status"><Check size={14}/><span>{amount(lastExport.frame_count, 'frame')}{lastExport.page_count ? ` · ${amount(lastExport.page_count, 'page')}` : ''}</span><span className="saved-path" title={lastExport.folder}>{lastExport.folder}</span><button className="text-button" onClick={() => request('reveal', { path: lastExport.folder }).catch(showError)}>Open folder</button></div>}
    </main>

    <Dialog open={dialog === 'download'} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title="Download"><form onSubmit={e => { e.preventDefault(); void downloadVideo(); }} className="dialog-form">
      <label className="field">Video URL<input autoFocus required type="url" value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)}/></label>
      <div className="field-row"><Select label="Quality" value={quality} onValueChange={setQuality} options={[{ value: '1080', label: 'High · 1080p' }, { value: '720', label: 'Medium · 720p' }, { value: '480', label: 'Low · 480p' }, { value: 'best', label: 'Best available' }]}/><label className="field">Subtitle language<input required value={language} maxLength={20} onChange={e => setLanguage(e.target.value)}/></label></div>
      <label className="field">Folder<div className="folder-field"><input required value={downloadDir} onChange={e => setDownloadDir(e.target.value)}/><Button type="button" variant="secondary" aria-label="Choose download folder" onClick={() => chooseFolder('download')}><FolderOpen size={17}/></Button></div></label>
      <details className="advanced"><summary>Options</summary><div><Select label="Subtitles" value={downloadSubs} onValueChange={setDownloadSubs} options={[{ value: 'auto', label: 'Include automatic captions' }, { value: 'manual', label: 'Creator-provided only' }, { value: 'none', label: 'None' }]}/><label className="check-field"><input type="checkbox" checked={embed} disabled={downloadSubs === 'none'} onChange={e => setEmbed(e.target.checked)}/>Embed subtitles</label></div></details>
      <div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy || !url.trim() || !downloadDir.trim()}>Download</Button></div>
    </form></DialogContent></Dialog>

    <Dialog open={dialog === 'export'} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title="Save"><div className="dialog-form">
      <Select label="Save as" value={exportKind} onValueChange={setExportKind} options={[{ value: 'reference', label: 'AI reference pack' }, { value: 'sheet', label: 'Image pages' }, { value: 'frames', label: 'Images only' }]}/>
      <p className="export-summary">{exportKind !== 'frames' ? amount(Math.ceil(selectedCount / 4), 'page') : ''}{exportKind === 'reference' ? ` · ${amount(selectedCount, 'image')} · transcript` : exportKind === 'frames' ? amount(selectedCount, 'image') : ''}</p>
      <label className="field">Folder<div className="folder-field"><input required value={output} onChange={e => setOutput(e.target.value)}/><Button variant="secondary" onClick={() => chooseFolder('export')} aria-label="Choose save folder"><FolderOpen size={17}/></Button></div></label>
      <div className="dialog-actions"><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={exportFrames} disabled={!output.trim() || busy}>Save</Button></div>
    </div></DialogContent></Dialog>

    <Dialog open={dialog === 'settings'} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title="Settings"><div className="dialog-form">
      <div className="field-row"><Select label="Width" value={String(settings.width)} onValueChange={v => setSettings(s => ({ ...s, width: Number(v) }))} options={[320, 480, 640, 960, 1280, 1920, 0].map(v => ({ value: String(v), label: v ? `${v}px` : 'Original' }))}/><Select label="Format" value={settings.format} onValueChange={v => setSettings(s => ({ ...s, format: v }))} options={[{ value: 'jpg', label: 'JPEG' }, { value: 'png', label: 'PNG' }]}/></div>
      {settings.format === 'jpg' && <label className="field">Quality: {settings.quality}%<input type="range" min="30" max="100" value={settings.quality} onChange={e => setSettings(s => ({ ...s, quality: Number(e.target.value) }))}/></label>}
      <details className="advanced"><summary>Crop (%)</summary><div><div className="crop-inputs">{['Left', 'Top', 'Width', 'Height'].map((name, index) => <label className="field" key={name}>{name}<input type="number" min="0" max="100" step="0.1" value={Number(((settings.crop || [0, 0, 1, 1])[index] * 100).toFixed(1))} onChange={e => setSettings(s => { const crop = [...(s.crop || [0, 0, 1, 1])]; crop[index] = Number(e.target.value) / 100; return { ...s, crop }; })}/></label>)}</div><button className="text-button" onClick={() => setSettings(s => ({ ...s, crop: null }))}>Reset</button></div></details>
      <div className="dialog-actions"><Button onClick={() => setDialog(null)}>Done</Button></div>
    </div></DialogContent></Dialog>

    <Dialog open={dialog === 'transcript'} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title="Transcript"><div className="dialog-form">
      <input className="search-input" autoFocus aria-label="Search transcript" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="transcript-list">{visibleCues.length ? visibleCues.map((cue, i) => <button className="cue" key={`${cue.start}-${i}`} onClick={() => { seek(cue.start); setDialog(null); }}><span>{label(cue.start)}</span><p>{cue.text}</p></button>) : <span className="empty-results">{query ? 'No matches' : 'No text subtitles'}</span>}</div>
    </div></DialogContent></Dialog>

    <Dialog open={dialog === 'commands'} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title="Commands"><div className="dialog-form"><pre className="command-block">{commands}</pre><div className="dialog-actions"><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(commands); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setNotice('Select and copy the command text.'); } }}>{copied ? 'Copied' : 'Copy'}</Button></div></div></DialogContent></Dialog>

    <Dialog open={preview !== null} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent onCloseAutoFocus={restoreFocus} title={preview ? label(preview.time, true) : 'Frame'} className="preview-dialog">{preview && <img className="large-preview" src={media('frame', preview.id)} alt={preview.caption || 'Captured frame'}/>}</DialogContent></Dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
