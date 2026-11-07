"""Desktop bridge and token-protected local media server."""
from __future__ import annotations

import contextlib
import io
import json
import mimetypes
import os
import secrets
import sys
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from core import Engine, FramegrabError, Cancelled, ROOT, VERSION


class Application:
    def __init__(self, initial_video=None, default_output=None):
        self.engine = Engine()
        self.current = self.engine.inspect(initial_video) if initial_video else None
        self.window = None
        self.default_output = str(Path(default_output).resolve()) if default_output else str(Path.home() / 'Downloads' / 'Framegrab')
        self.exports = []
        self.jobs = {}
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='framegrab')
        self.job_lock = threading.Lock()
        self.key = secrets.token_urlsafe(32)
        self.server = None

    def start_job(self, function, *args, **kwargs):
        identifier = uuid.uuid4().hex
        event = threading.Event()
        job = {'id': identifier, 'status': 'running', 'progress': 0, 'message': 'Starting', 'cancel': event}
        self.jobs[identifier] = job

        def progress(value, message):
            with self.job_lock:
                job.update(progress=max(0, min(1, value)), message=message)

        def run():
            try:
                result = function(*args, **kwargs, progress=progress, cancel=event)
                with self.job_lock:
                    job.update(status='complete', progress=1, result=result, message='Complete')
            except Cancelled:
                with self.job_lock:
                    job.update(status='cancelled', message='Cancelled')
            except Exception as error:
                with self.job_lock:
                    job.update(status='failed', error=str(error), message='Could not finish')
        self.executor.submit(run)
        return {'job_id': identifier}

    def choose(self, kind, start=None):
        if not self.window:
            raise FramegrabError('File dialogs are available in the desktop app. Use a path with the command interface.')
        import webview
        if kind == 'video':
            paths = self.window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False,
                file_types=('Video files (*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v)', 'All files (*.*)'))
        else:
            paths = self.window.create_file_dialog(webview.FileDialog.FOLDER, directory=start or self.default_output)
        return str(paths[0]) if paths else None

    def dispatch(self, method: str, data: dict):
        try:
            result = self._dispatch(method, data)
            return {'ok': True, 'result': result}
        except Exception as error:
            return {'ok': False, 'error': str(error)}

    def _dispatch(self, method, data):
        if method == 'bootstrap':
            return {'version': VERSION, 'asset': self.current, 'frames': list(self.engine.frames.values()),
                    'output': self.default_output, 'desktop': self.window is not None}
        if method in ('choose_video', 'open_video'):
            path = self.choose('video') if method == 'choose_video' else data['path']
            if not path:
                return {'cancelled': True}
            self.current = self.engine.inspect(path)
            return {'asset': self.current}
        if method == 'choose_folder':
            path = self.choose('folder', data.get('path'))
            return {'path': path, 'cancelled': path is None}
        if method == 'subtitles':
            return self.engine.subtitles(data['asset_id'], data.get('track', 'auto'))
        if method == 'capture':
            return self.start_job(lambda **kw: self.engine.capture(data['asset_id'], data['at'], data.get('settings'), kw['cancel']))
        if method == 'sample':
            return self.start_job(self.engine.sample, data['asset_id'], data['options'], data.get('settings'))
        if method == 'download':
            def download(**kw):
                result = self.engine.download(data['url'], data['directory'], data.get('quality', '1080'), data.get('language', 'en'),
                                              data.get('subtitles', 'auto'), data.get('embed', True), **kw)
                self.current = result['asset']
                return result
            return self.start_job(download)
        if method == 'export':
            def export(**kw):
                result = self.engine.export(data['frame_ids'], data['directory'], data.get('kind', 'reference'), **kw)
                self.exports.append(result['folder'])
                self.default_output = data['directory']
                return result
            return self.start_job(export)
        if method == 'job':
            with self.job_lock:
                job = self.jobs.get(data['id'])
                if not job:
                    raise FramegrabError('That task could not be found.')
                return {k: v for k, v in job.items() if k != 'cancel'}
        if method == 'cancel':
            job = self.jobs.get(data['id'])
            if job:
                job['cancel'].set()
            return {'cancelled': True}
        if method == 'remove_frame':
            frame = self.engine.frames.pop(data['id'], None)
            if frame:
                Path(frame['path']).unlink(missing_ok=True)
                Path(frame['thumbnail_path']).unlink(missing_ok=True)
            return {'removed': bool(frame)}
        if method == 'clear_frames':
            for frame in list(self.engine.frames.values()):
                Path(frame['path']).unlink(missing_ok=True)
                Path(frame['thumbnail_path']).unlink(missing_ok=True)
            self.engine.frames.clear()
            return {'cleared': True}
        if method == 'reveal':
            path = str(Path(data['path']).resolve())
            allowed = self.exports + [a['path'] for a in self.engine.assets.values()]
            if path not in allowed:
                raise FramegrabError('Choose a video or completed export to open its folder.')
            directory = Path(path) if Path(path).is_dir() else Path(path).parent
            os.startfile(str(directory))
            return {'path': str(directory)}
        raise FramegrabError('Unknown command.')

    def serve(self, port=0):
        application = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def send_data(self, status, data, content_type):
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def authorized(self):
                return parse_qs(urlsplit(self.path).query).get('key', [''])[0] == application.key

            def do_POST(self):
                parsed = urlsplit(self.path)
                if not self.authorized() or not parsed.path.startswith('/api/'):
                    return self.send_data(403, b'{"ok":false,"error":"Access denied"}', 'application/json')
                try:
                    size = int(self.headers.get('Content-Length', 0))
                    if not 0 <= size <= 1024 * 1024:
                        raise ValueError('Request too large')
                    data = json.loads(self.rfile.read(size)) if size else {}
                    result = application.dispatch(parsed.path.rsplit('/', 1)[-1], data)
                    self.send_data(200, json.dumps(result, ensure_ascii=False).encode(), 'application/json; charset=utf-8')
                except (ValueError, KeyError) as error:
                    self.send_data(400, json.dumps({'ok': False, 'error': str(error)}).encode(), 'application/json')

            def do_GET(self):
                parsed = urlsplit(self.path)
                if parsed.path.startswith(('/media/', '/frame/', '/thumb/')):
                    if not self.authorized():
                        return self.send_data(403, b'Access denied', 'text/plain')
                    identifier = parsed.path.rsplit('/', 1)[-1]
                    item = application.engine.assets.get(identifier) if parsed.path.startswith('/media/') else application.engine.frames.get(identifier)
                    if not item:
                        return self.send_data(404, b'Not found', 'text/plain')
                    return self.stream(Path(item['thumbnail_path'] if parsed.path.startswith('/thumb/') else item['path']))
                relative = 'index.html' if parsed.path == '/' else parsed.path.lstrip('/')
                path = (ROOT / 'web' / relative).resolve()
                if not path.is_relative_to((ROOT / 'web').resolve()) or not path.is_file():
                    return self.send_data(404, b'Not found', 'text/plain')
                content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
                self.send_data(200, path.read_bytes(), content_type)

            def stream(self, path):
                size = path.stat().st_size
                start, end = 0, size - 1
                range_header = self.headers.get('Range')
                if range_header:
                    try:
                        if not range_header.startswith('bytes=') or ',' in range_header:
                            raise ValueError()
                        left, right = range_header[6:].split('-', 1)
                        if left:
                            start = int(left)
                            if right:
                                end = min(end, int(right))
                        elif right:
                            start = max(0, size - int(right))
                        else:
                            raise ValueError()
                        if start < 0 or start > end:
                            raise ValueError()
                    except ValueError:
                        self.send_response(416)
                        self.send_header('Content-Range', f'bytes */{size}')
                        self.send_header('Content-Length', '0')
                        self.end_headers()
                        return
                self.send_response(206 if range_header else 200)
                self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'no-store')
                if range_header:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()
                try:
                    with path.open('rb') as handle:
                        handle.seek(start)
                        remaining = end - start + 1
                        while remaining:
                            chunk = handle.read(min(1024 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        self.server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return f'http://127.0.0.1:{self.server.server_port}/?key={self.key}'

    def close(self):
        for job in self.jobs.values():
            job['cancel'].set()
        self.executor.shutdown(wait=True, cancel_futures=True)
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.engine.close()


def run_headless(arguments):
    from cli import main
    index = arguments.index('--result-file')
    target = Path(arguments[index + 1])
    command = arguments[:index] + arguments[index + 2:]
    output, errors = io.StringIO(), io.StringIO()
    code = 0
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            try:
                code = main(command)
            except SystemExit as error:
                code = int(error.code or 0)
    except Exception as error:
        output.write(json.dumps({'ok': False, 'error': str(error)}))
        code = 1
    target.write_text(json.dumps({'stdout': output.getvalue(), 'stderr': errors.getvalue(), 'code': code}), encoding='utf-8')
    return code


def main():
    if '--headless' in sys.argv:
        arguments = sys.argv[1:]
        arguments.remove('--headless')
        return run_headless(arguments)
    if '--serve' in sys.argv:
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument('--serve', action='store_true')
        parser.add_argument('--video')
        parser.add_argument('--out')
        parser.add_argument('--port', type=int, default=0)
        args = parser.parse_args()
        application = Application(args.video, args.out)
        print(application.serve(args.port), flush=True)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        finally:
            application.close()
        return 0
    import webview
    application = Application()
    url = application.serve()
    application.window = webview.create_window('Framegrab', url, width=1280, height=870,
        min_size=(760, 600), background_color='#f5f6f8', text_select=True)
    try:
        webview.start(gui='edgechromium')
    finally:
        application.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
