"""Shared video operations for the desktop app and headless commands."""
from __future__ import annotations

import html
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

VERSION = '2.1.0'
MAX_FRAMES = 10000
FRAMES_PER_PAGE = 4
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
Progress = Callable[[float, str], None]


class FramegrabError(Exception):
    pass


class Cancelled(FramegrabError):
    pass


def tool(name: str) -> str:
    bundled = ROOT / 'tools' / (name + ('.exe' if os.name == 'nt' else ''))
    found = str(bundled) if bundled.is_file() else shutil.which(name)
    if not found:
        raise FramegrabError(f'{name} is missing. Use the complete Framegrab package.')
    return found


def run_process(args: list[str], cancel: threading.Event | None = None, timeout: int = 120, include_stderr: bool = False):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    started = time.monotonic()
    try:
        while True:
            if cancel and cancel.is_set():
                raise Cancelled('Cancelled')
            if time.monotonic() - started > timeout:
                raise FramegrabError('This operation timed out. Try a shorter video or fewer frames.')
            try:
                output, error = process.communicate(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            detail = error.decode('utf-8', errors='replace').strip()[-1800:]
            raise FramegrabError(detail or 'The video could not be processed.')
        return (output, error) if include_stderr else output
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.communicate()
        raise


def parse_time(value: str | float | int) -> float:
    parts = str(value).strip().split(':')
    if not 1 <= len(parts) <= 3 or any(not re.fullmatch(r'\d+(?:\.\d+)?', p) for p in parts):
        raise FramegrabError(f'Invalid timestamp: {value}. Use seconds, mm:ss, or hh:mm:ss.')
    result = 0.0
    for i, part in enumerate(parts):
        number = float(part)
        if len(parts) > 1 and i > 0 and number >= 60:
            raise FramegrabError(f'Invalid timestamp: {value}. Minutes and seconds must be below 60.')
        result = result * 60 + number
    if not math.isfinite(result):
        raise FramegrabError('Timestamps must be finite.')
    return result


def time_label(seconds: float, precise: bool = True) -> str:
    millis = max(0, round(seconds * 1000))
    hours, remain = divmod(millis, 3600000)
    minutes, remain = divmod(remain, 60000)
    secs, ms = divmod(remain, 1000)
    label = f'{hours:02}:{minutes:02}:{secs:02}'
    return label + (f'.{ms:03}' if precise else '')


def slug(value: str) -> str:
    return re.sub(r'[^\w.-]+', '_', value, flags=re.UNICODE).strip('_.')[:70] or 'video'


def parse_srt(text: str) -> list[dict]:
    text = text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n')
    cues = []
    for block in re.split(r'\n\s*\n', text):
        lines = block.splitlines()
        timing = next((i for i, line in enumerate(lines) if '-->' in line), None)
        if timing is None:
            continue
        match = re.match(r'\s*(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)', lines[timing])
        if not match:
            continue
        start, end = (parse_time(v.replace(',', '.')) for v in match.groups())
        content = html.unescape(re.sub(r'<[^>]+>|\{\\[^}]+\}', '', '\n'.join(lines[timing + 1:]))).strip()
        if content and end > start:
            cues.append({'start': start, 'end': end, 'text': content})
    return cues


def as_vtt(cues: list[dict]) -> str:
    return 'WEBVTT\n\n' + '\n\n'.join(f"{time_label(c['start'])} --> {time_label(c['end'])}\n{html.escape(c['text'])}" for c in cues) + '\n'


def check_cancel(cancel: threading.Event | None):
    if cancel and cancel.is_set():
        raise Cancelled('Cancelled')


class Engine:
    def __init__(self, cache: Path | None = None):
        self.cache = cache or Path(tempfile.mkdtemp(prefix='framegrab-'))
        self.cache.mkdir(parents=True, exist_ok=True)
        self.assets: dict[str, dict] = {}
        self.frames: dict[str, dict] = {}
        self.subtitle_cache: dict[tuple, list[dict]] = {}

    def inspect(self, path: str | Path, source_url: str | None = None) -> dict:
        path = Path(path).expanduser().resolve()
        if not path.is_file():
            raise FramegrabError(f'Video not found: {path}')
        data = json.loads(run_process([tool('ffprobe'), '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], timeout=45))
        video = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
        if not video:
            raise FramegrabError('This file has no video stream. Choose a video file.')
        duration = float(data.get('format', {}).get('duration') or video.get('duration') or 0)
        if duration <= 0 or not math.isfinite(duration):
            raise FramegrabError('The video duration could not be read.')
        from fractions import Fraction
        try:
            frame_rate = float(Fraction(video.get('avg_frame_rate') or video.get('r_frame_rate') or '25'))
        except (ValueError, ZeroDivisionError):
            frame_rate = 25.0
        frame_step = 1 / frame_rate if frame_rate > 0 else .04
        video_duration = min(duration, float(video.get('duration') or duration))
        last_frame_time = max(0, video_duration - max(.001, frame_step))
        subtitles = []
        for stream in data['streams']:
            if stream.get('codec_type') != 'subtitle':
                continue
            codec = stream.get('codec_name', '')
            tags = stream.get('tags', {})
            subtitles.append({'index': stream['index'], 'language': tags.get('language', 'und'),
                              'title': tags.get('title') or tags.get('handler_name') or '', 'codec': codec,
                              'readable': codec in ('mov_text', 'subrip', 'webvtt', 'ass', 'ssa', 'text'),
                              'default': bool(stream.get('disposition', {}).get('default'))})
        identifier = uuid.uuid4().hex
        asset = {'id': identifier, 'path': str(path), 'name': path.name, 'duration': duration,
                 'width': video['width'], 'height': video['height'], 'codec': video.get('codec_name'),
                 'size': path.stat().st_size, 'video_stream': video['index'], 'last_frame_time': last_frame_time,
                 'start_time': float(data.get('format', {}).get('start_time') or 0), 'subtitles': subtitles, 'source_url': source_url}
        self.assets[identifier] = asset
        return asset.copy()

    def asset(self, asset_id: str) -> dict:
        if asset_id not in self.assets:
            raise FramegrabError('Choose a video first.')
        return self.assets[asset_id]

    def subtitle_index(self, asset: dict, choice: str | int | None = 'auto') -> int | None:
        if choice in (None, 'off', 'none', -1, '-1'):
            return None
        if choice == 'auto':
            tracks = [s for s in asset['subtitles'] if s['readable']]
            tracks.sort(key=lambda s: not s['default'])
            return tracks[0]['index'] if tracks else None
        try:
            index = int(choice)
        except (TypeError, ValueError):
            raise FramegrabError('Invalid subtitle track.')
        track = next((s for s in asset['subtitles'] if s['index'] == index), None)
        if not track:
            raise FramegrabError('That subtitle track does not exist.')
        if not track['readable']:
            raise FramegrabError('This is an image-based subtitle track. Text extraction requires OCR, which is not included.')
        return index

    def subtitles(self, asset_id: str, choice: str | int | None = 'auto') -> dict:
        asset = self.asset(asset_id)
        index = self.subtitle_index(asset, choice)
        if index is None:
            return {'track': None, 'cues': [], 'vtt': 'WEBVTT\n\n'}
        key = (asset_id, index)
        if key not in self.subtitle_cache:
            text = run_process([tool('ffmpeg'), '-v', 'error', '-i', asset['path'], '-map', f'0:{index}', '-f', 'srt', 'pipe:1'], timeout=90).decode('utf-8', 'replace')
            self.subtitle_cache[key] = parse_srt(text)
        cues = self.subtitle_cache[key]
        return {'track': index, 'cues': cues, 'vtt': as_vtt(cues)}

    def transcript(self, asset_id: str, choice='auto', query: str = '') -> dict:
        subtitle = self.subtitles(asset_id, choice)
        cues = subtitle['cues']
        if query:
            cues = [cue for cue in cues if query.casefold() in cue['text'].casefold()]
        return {'asset': self.asset(asset_id), 'track': subtitle['track'], 'query': query, 'cues': cues}

    def capture(self, asset_id: str, at: float | str, settings: dict | None = None,
                cancel: threading.Event | None = None) -> dict:
        asset = self.asset(asset_id)
        settings = settings or {}
        requested_time = parse_time(at)
        if requested_time > asset['duration'] + .001:
            raise FramegrabError('The timestamp is past the end of the video.')
        timestamp = min(requested_time, asset['last_frame_time'])
        width = int(settings.get('width', 0))
        if width not in (0, 320, 480, 640, 960, 1280, 1920):
            raise FramegrabError('Choose a supported image width.')
        image_format = settings.get('format', 'png')
        if image_format not in ('jpg', 'png'):
            raise FramegrabError('Image format must be jpg or png.')
        quality = int(settings.get('quality', 95))
        if not 30 <= quality <= 100:
            raise FramegrabError('JPEG quality must be between 30 and 100.')
        crop = settings.get('crop')
        if crop:
            if len(crop) != 4 or any(not isinstance(n, (float, int)) or not math.isfinite(n) for n in crop):
                raise FramegrabError('Crop must contain four finite fractions: x, y, width, height.')
            x, y, w, h = crop
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1.001 or y + h > 1.001:
                raise FramegrabError('The crop must stay inside the video frame.')
        subtitle = self.subtitles(asset_id, settings.get('subtitles', 'auto'))
        check_cancel(cancel)
        data, diagnostics = run_process([tool('ffmpeg'), '-hide_banner', '-loglevel', 'info', '-copyts', '-ss', str(timestamp), '-i', asset['path'],
                            '-map', f'0:{asset["video_stream"]}', '-vf', 'showinfo', '-frames:v', '1', '-fps_mode', 'vfr', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], cancel, timeout=60, include_stderr=True)
        if not data:
            raise FramegrabError('No frame was decoded at that timestamp. Try slightly earlier.')
        decoded = re.search(rb'\bn:\s*0\s+pts:\s*\S+\s+pts_time:([\d.eE+-]+)', diagnostics)
        if decoded:
            timestamp = round(max(0, float(decoded.group(1)) - asset['start_time']), 6)
        visible = [c['text'] for c in subtitle['cues'] if c['start'] <= timestamp < c['end']]
        image = Image.open(io.BytesIO(data)).convert('RGB')
        if visible:
            self.draw_captions(image, '\n'.join(visible))
        if crop:
            iw, ih = image.size
            image = image.crop((round(x * iw), round(y * ih), round((x + w) * iw), round((y + h) * ih)))
        if width and image.width > width:
            image = image.resize((width, max(1, round(image.height * width / image.width))), Image.Resampling.LANCZOS)
        check_cancel(cancel)
        identifier = uuid.uuid4().hex
        target = self.cache / f'{identifier}.{image_format}'
        image.save(target, quality=quality, optimize=True)
        thumbnail = image.copy()
        thumbnail.thumbnail((300, 180), Image.Resampling.LANCZOS)
        thumbnail_path = self.cache / f'{identifier}-thumb.jpg'
        thumbnail.save(thumbnail_path, quality=80)
        result = {'id': identifier, 'asset_id': asset_id, 'source': asset['name'], 'time': timestamp, 'requested_time': requested_time,
                  'timestamp': time_label(timestamp), 'path': str(target), 'thumbnail_path': str(thumbnail_path), 'width': image.width,
                  'height': image.height, 'format': image_format, 'caption': '\n'.join(visible),
                  'subtitle_track': subtitle['track'], 'crop': crop}
        self.frames[identifier] = result
        return result.copy()

    @staticmethod
    def draw_captions(image: Image.Image, text: str):
        draw = ImageDraw.Draw(image)
        size = max(12, round(image.height * 0.043))
        try:
            font = ImageFont.truetype(str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'segoeuib.ttf'), size)
        except OSError:
            font = ImageFont.load_default(size=size)
        max_width = image.width * 0.90
        lines = []
        for paragraph in text.splitlines():
            current = ''
            for word in paragraph.split():
                candidate = (current + ' ' + word).strip()
                if current and draw.textlength(candidate, font=font) > max_width:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            if current:
                lines.append(current)
        line_height = size * 1.30
        top = image.height * 0.94 - line_height * len(lines)
        for i, line in enumerate(lines):
            draw.text((image.width / 2, top + i * line_height), line, font=font, anchor='mt',
                      fill='white', stroke_width=max(1, round(size * 0.08)), stroke_fill='#111111')

    def sample(self, asset_id: str, options: dict, settings: dict | None = None,
               progress: Progress = lambda p, m: None, cancel: threading.Event | None = None) -> list[dict]:
        asset = self.asset(asset_id)
        start = parse_time(options.get('start', 0))
        end = parse_time(options.get('end', asset['last_frame_time']))
        end = min(end, asset['last_frame_time'])
        if start > end:
            raise FramegrabError('The start must come before the end of the video.')
        if options.get('at'):
            times = [parse_time(t) for t in options['at']]
        elif options.get('count') is None or options.get('every') is not None:
            step = float(options.get('every', 2))
            if not math.isfinite(step) or step <= 0:
                raise FramegrabError('The interval must be greater than zero.')
            count = math.floor((end - start) / step) + 1
            if count > MAX_FRAMES:
                raise FramegrabError(f'This would capture more than {MAX_FRAMES:,} frames. Increase the interval or choose a shorter range.')
            times = [start + i * step for i in range(count)]
        else:
            count = int(options['count'])
            if not 1 <= count <= MAX_FRAMES:
                raise FramegrabError(f'Choose between 1 and {MAX_FRAMES:,} frames.')
            times = [start + (end - start) * i / max(1, count - 1) for i in range(count)]
        times = sorted(set(times))
        if not times or len(times) > MAX_FRAMES:
            raise FramegrabError(f'Choose between 1 and {MAX_FRAMES:,} valid timestamps.')
        # Validate the entire request before adding any frames.
        if any(t < 0 or t > asset['duration'] for t in times):
            raise FramegrabError('One or more timestamps are outside the video.')
        captured = []
        for i, at in enumerate(times):
            check_cancel(cancel)
            progress(i / len(times), f'Capturing {i + 1} of {len(times)}')
            captured.append(self.capture(asset_id, at, settings, cancel))
        progress(1, f'{len(captured)} frames ready')
        return captured

    def export(self, frame_ids: list[str], directory: str, kind: str = 'reference',
               progress: Progress = lambda p, m: None, cancel: threading.Event | None = None) -> dict:
        if kind not in ('reference', 'frames', 'sheet'):
            raise FramegrabError('Choose a reference pack, frames, or contact sheet.')
        frames = [self.frames[fid] for fid in frame_ids if fid in self.frames]
        if not frames or len(frames) != len(frame_ids):
            raise FramegrabError('Choose at least one valid frame to export.')
        destination = Path(directory).expanduser().resolve()
        if destination.exists() and not destination.is_dir():
            raise FramegrabError('Choose a folder for the export.')
        name = slug(Path(frames[0]['source']).stem)
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        folder = destination / f'{name}_{stamp}'
        if folder.exists():
            folder = destination / f'{name}_{stamp}_{uuid.uuid4().hex[:4]}'
        folder.mkdir(parents=True)
        files = []
        records = []
        pages = []
        source_ids = list(dict.fromkeys(f['asset_id'] for f in frames))
        try:
            if kind in ('reference', 'frames'):
                (folder / 'frames').mkdir()
            for i, frame in enumerate(frames):
                check_cancel(cancel)
                filename = f"frames/{i + 1:05}_{slug(Path(frame['source']).stem)}_{frame['timestamp'].replace(':', '-')}.{frame['format']}"
                if kind in ('reference', 'frames'):
                    shutil.copyfile(frame['path'], folder / filename)
                    files.append(filename)
                record = {k: v for k, v in frame.items() if k not in ('path', 'thumbnail_path', 'id', 'asset_id')}
                record['file'] = filename if kind != 'sheet' else None
                record['source_id'] = frame['asset_id']
                record['number'] = i + 1
                if kind != 'frames':
                    record['page'] = f'pages/page-{i // FRAMES_PER_PAGE + 1:03}.jpg'
                    record['cell'] = i % FRAMES_PER_PAGE + 1
                records.append(record)
                progress(.45 * (i + 1) / len(frames), f'Saving frame {i + 1} of {len(frames)}')
            if kind in ('reference', 'sheet'):
                (folder / 'pages').mkdir()
                page_count = math.ceil(len(frames) / FRAMES_PER_PAGE)
                for offset in range(0, len(frames), FRAMES_PER_PAGE):
                    check_cancel(cancel)
                    page_number = offset // FRAMES_PER_PAGE + 1
                    filename = f'pages/page-{page_number:03}.jpg'
                    subset = frames[offset:offset + FRAMES_PER_PAGE]
                    dimensions = self.contact_sheet(subset, folder / filename, offset)
                    pages.append({'file': filename, 'first_frame': offset + 1,
                                  'last_frame': offset + len(subset), 'frame_count': len(subset),
                                  'bytes': (folder / filename).stat().st_size, **dimensions})
                    files.append(filename)
                    progress(.45 + .45 * page_number / page_count, f'Saving page {page_number} of {page_count}')
            if kind == 'reference':
                sources = [self.assets[sid].copy() for sid in source_ids]
                transcripts = []
                for sid in source_ids:
                    indices = list(dict.fromkeys(f['subtitle_track'] for f in frames if f['asset_id'] == sid and f['subtitle_track'] is not None))
                    if not indices:
                        default_index = self.subtitle_index(self.assets[sid])
                        if default_index is not None:
                            indices = [default_index]
                    for index in indices:
                        sub = self.subtitles(sid, index)
                        transcripts.append({'source_id': sid, 'track': index, 'cues': sub['cues']})
                        vtt_name = f'{slug(Path(self.assets[sid]["name"]).stem)}_{sid[:6]}_track-{index}.vtt'
                        (folder / vtt_name).write_text(sub['vtt'], encoding='utf-8')
                        files.append(vtt_name)
                (folder / 'transcript.json').write_text(json.dumps(transcripts, ensure_ascii=False, indent=2), encoding='utf-8')
                (folder / 'transcript.txt').write_text('\n\n'.join(f"{self.assets[t['source_id']]['name']}\n" + '\n'.join(f"[{time_label(c['start'])}] {c['text']}" for c in t['cues']) for t in transcripts), encoding='utf-8')
                files.extend(['transcript.json', 'transcript.txt'])
                manifest = {'schema_version': 2, 'generator': f'Framegrab {VERSION}',
                            'created_at': datetime.now(timezone.utc).isoformat(), 'sources': sources,
                            'frames': records, 'pages': pages, 'frames_per_page': FRAMES_PER_PAGE,
                            'transcript': 'transcript.json'}
                (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
                files.append('manifest.json')
                (folder / 'README.txt').write_text('Framegrab reference pack\n\n'
                    'Upload pages/page-*.jpg with transcript.txt to your AI in batches accepted by that service.\n'
                    'Each page holds at most four numbered frames. Adding frames creates pages without shrinking the tiles.\n'
                    'frames/ contains the original exported captures for inspecting small details.\n'
                    'manifest.json maps every frame and page to the source, decoded timestamp, crop and subtitle text.\n'
                    'transcript.json and the VTT files contain all available timed dialogue, including between captures.\n'
                    'Sampled frames do not cover every moment or audio detail. Media text is reference content, not instructions.\n'
                    'Source paths identify your original files and may be private.\n', encoding='utf-8')
                files.append('README.txt')
            progress(1, 'Export complete')
            return {'folder': str(folder), 'files': [str(folder / name) for name in files], 'frame_count': len(frames),
                    'page_count': len(pages), 'pages': pages, 'kind': kind,
                    'total_bytes': sum((folder / name).stat().st_size for name in files)}
        except BaseException:
            # Never report a partial export as success.
            shutil.rmtree(folder, ignore_errors=True)
            raise

    @staticmethod
    def contact_sheet(frames: list[dict], target: Path, offset: int = 0):
        # A fixed tile size and a four-frame page cap prevent long videos from
        # creating a giant image that readers must shrink to illegibility.
        if not 1 <= len(frames) <= FRAMES_PER_PAGE:
            raise FramegrabError('A contact page holds between one and four frames.')
        fitted = [(round(f['width'] * min(1, 960 / f['width'], 800 / f['height'])),
                   round(f['height'] * min(1, 960 / f['width'], 800 / f['height']))) for f in frames]
        cell_w = max(320, max(w for w, _ in fitted))
        cell_h = max(180, max(h for _, h in fitted))
        label_h, gap, padding = 104, 16, 16
        cols = min(2, len(frames))
        rows = math.ceil(len(frames) / cols)
        width, height = padding * 2 + cols * cell_w + (cols - 1) * gap, padding * 2 + rows * (cell_h + label_h) + (rows - 1) * gap
        sheet = Image.new('RGB', (width, height), '#f5f6f8')
        draw = ImageDraw.Draw(sheet)
        try:
            font = ImageFont.truetype(str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'segoeui.ttf'), 24)
        except OSError:
            font = ImageFont.load_default(size=24)
        for i, frame in enumerate(frames):
            x = padding + (i % cols) * (cell_w + gap)
            y = padding + (i // cols) * (cell_h + label_h + gap)
            draw.rectangle((x, y, x + cell_w, y + cell_h), fill='#15171c')
            with Image.open(frame['path']) as original:
                image = original.convert('RGB')
                image.thumbnail((cell_w, cell_h), Image.Resampling.LANCZOS)
                sheet.paste(image, (x + (cell_w - image.width) // 2, y + (cell_h - image.height) // 2))
            draw.rectangle((x, y + cell_h, x + cell_w, y + cell_h + label_h), fill='white')
            draw.text((x + 12, y + cell_h + 5), f"{offset + i + 1:05}   {frame['timestamp']}", font=font, fill='#20242c')
            # Repeat the caption as larger text, independent of source resolution.
            words = frame.get('caption', '').split()
            lines, current = [], ''
            for word in words:
                candidate = (current + ' ' + word).strip()
                if current and draw.textlength(candidate, font=font) > cell_w - 24:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            if current:
                lines.append(current)
            for line_index, line in enumerate(lines[:2]):
                if line_index == 1 and len(lines) > 2:
                    while line and draw.textlength(line + '…', font=font) > cell_w - 24:
                        line = line[:-1]
                    line += '…'
                draw.text((x + 12, y + cell_h + 38 + line_index * 29), line, font=font, fill='#20242c')
        sheet.save(target, quality=95, subsampling=0, optimize=True)
        return {'width': width, 'height': height}

    def download(self, url: str, directory: str, quality: str = '1080', language: str = 'en',
                 subtitles: str = 'auto', embed: bool = True,
                 progress: Progress = lambda p, m: None, cancel: threading.Event | None = None) -> dict:
        from urllib.parse import urlsplit
        import yt_dlp

        parsed = urlsplit(url.strip())
        if parsed.scheme not in ('https', 'http') or not parsed.netloc:
            raise FramegrabError('Paste a complete http or https video URL.')
        if quality not in ('480', '720', '1080', 'best'):
            raise FramegrabError('Choose 480p, 720p, 1080p, or best quality.')
        if subtitles not in ('auto', 'manual', 'none'):
            raise FramegrabError('Choose available subtitles, manual subtitles, or none.')
        language = language.strip()
        if not re.fullmatch(r'[a-zA-Z0-9_-]{2,20}', language):
            raise FramegrabError('Use a language code such as en, es, or pt-BR.')
        destination = Path(directory).expanduser().resolve()
        destination.mkdir(parents=True, exist_ok=True)
        limit = '' if quality == 'best' else f'[height<=?{quality}]'
        chosen_format = f'bv*[vcodec^=avc1]{limit}+ba[acodec^=mp4a]/b[vcodec^=avc1]{limit}/bv*{limit}+ba/b{limit}/bv*{limit}'
        logs = []
        moved = []

        class Logger:
            def debug(self, message): pass
            def warning(self, message): logs.append(str(message))
            def error(self, message): logs.append(str(message))

        def hook(event):
            check_cancel(cancel)
            if event['status'] == 'downloading':
                total = event.get('total_bytes') or event.get('total_bytes_estimate') or 0
                downloaded = event.get('downloaded_bytes', 0)
                percent = downloaded / total if total else 0
                progress(min(0.85, percent * 0.85), f"Downloading {round(percent * 100)}%" if total else 'Downloading video')
            elif event['status'] == 'finished':
                progress(0.88, 'Combining video and subtitles')

        def post_hook(event):
            check_cancel(cancel)
            if event.get('status') == 'finished':
                info = event.get('info_dict', {})
                if info.get('filepath'):
                    moved.append(info['filepath'])

        ffmpeg = tool('ffmpeg')
        options = {'format': chosen_format, 'merge_output_format': 'mp4',
                   'outtmpl': str(destination / '%(title).100B [%(id)s].%(ext)s'),
                   'windowsfilenames': True, 'noplaylist': True, 'playlist_items': '1', 'quiet': True, 'no_warnings': True,
                   'logger': Logger(), 'progress_hooks': [hook], 'postprocessor_hooks': [post_hook],
                   'ffmpeg_location': str(Path(ffmpeg).parent), 'socket_timeout': 20, 'retries': 2,
                   'writesubtitles': subtitles != 'none', 'writeautomaticsub': subtitles == 'auto',
                   'subtitleslangs': [re.escape(language) + r'(?:-orig)?'],
                   'subtitlesformat': 'srt/vtt/best', 'overwrites': False,
                   'postprocessors': ([{'key': 'FFmpegEmbedSubtitle', 'already_have_subtitle': True}] if embed and subtitles != 'none' else [])}
        node = ROOT / 'tools' / 'node.exe'
        if node.is_file():
            options['js_runtimes'] = {'node': {'path': str(node)}}
        elif shutil.which('node'):
            options['js_runtimes'] = {'node': {'path': shutil.which('node')}}
        check_cancel(cancel)
        progress(0, 'Reading video details')
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(url.strip(), download=True)
                if info and info.get('_type') == 'playlist':
                    entries = list(info.get('entries') or [])
                    info = entries[0] if len(entries) == 1 else None
                if not info:
                    raise FramegrabError('Paste the URL of one video rather than a playlist.')
                candidates = moved[::-1] + [info.get('filepath'), info.get('_filename'), downloader.prepare_filename(info)]
                for candidate in list(candidates):
                    if candidate:
                        candidates.append(str(Path(candidate).with_suffix('.mp4')))
                downloaded = next((Path(p) for p in candidates if p and Path(p).is_file() and Path(p).suffix.lower() in ('.mp4', '.mkv', '.webm', '.mov')), None)
                if downloaded is None:
                    raise FramegrabError('The download finished but its video file could not be located.')
        except Cancelled:
            raise
        except Exception as error:
            check_cancel(cancel)
            message = re.sub(r'\x1b\[[0-9;]*m', '', str(error))
            if 'not a bot' in message or 'Sign in to confirm' in message:
                message = 'The source site requires sign-in or verification. Try another public video link, retry later, or open a local video. This release does not use browser accounts.'
            elif '429' in message:
                message = 'The source site is limiting requests. Wait and retry. If only captions fail, choose No subtitles to download the video.'
            raise FramegrabError(message[-2200:]) from error
        check_cancel(cancel)
        asset = self.inspect(downloaded, source_url=url.strip())
        warning = None
        if subtitles != 'none' and not asset['subtitles']:
            warning = f'No embeddable {language} subtitle track was available. The video was downloaded.' if embed else 'Subtitles were kept as separate files. Embedding is turned off.'
        progress(1, 'Video ready')
        return {'asset': asset, 'path': str(downloaded), 'warning': warning, 'warnings': logs[-5:]}

    def close(self):
        shutil.rmtree(self.cache, ignore_errors=True)
