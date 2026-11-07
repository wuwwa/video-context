"""Real FFmpeg and yt-dlp integration checks, using a tiny local video fixture."""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from core import Engine, FramegrabError, Cancelled, parse_time, run_process, tool
from app import Application


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='framegrab-tests-')
        cls.root = Path(cls.temp.name)
        cls.video = cls.root / 'Reference session – two languages.mp4'
        srt = '1\n00:00:00,100 --> 00:00:02,500\nA useful opening frame\n\n2\n00:00:02,500 --> 00:00:05,900\nSearchable <i>caption</i> with context\n'
        (cls.root / 'en.srt').write_text(srt, encoding='utf-8')
        (cls.root / 'es.srt').write_text(srt.replace('A useful opening frame', 'Un fotograma de apertura').replace('Searchable', 'Buscable'), encoding='utf-8')
        (cls.root / 'captions.vtt').write_text('WEBVTT\n\n00:00:00.100 --> 00:00:05.900\nDownloaded caption\n', encoding='utf-8')
        run_process([tool('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12:duration=6',
                     '-i', str(cls.root / 'en.srt'), '-i', str(cls.root / 'es.srt'), '-map', '0:v', '-map', '1', '-map', '2',
                     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
                     '-metadata:s:s:1', 'language=spa', '-disposition:s:0', 'default', str(cls.video)])
        run_process([tool('ffmpeg'), '-v', 'error', '-y', '-i', str(cls.video), '-map', '0:v', '-c', 'copy', str(cls.root / 'source.mp4')])
        (cls.root / 'index.html').write_text('<html><head><title>Framegrab download test</title></head><body><video controls><source src="source.mp4" type="video/mp4"><track kind="subtitles" src="captions.vtt" srclang="en" label="English"></video></body></html>', encoding='utf-8')
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(cls.root)))
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.temp.cleanup()

    def setUp(self):
        self.engine = Engine()
        self.asset = self.engine.inspect(self.video)

    def tearDown(self):
        self.engine.close()

    def test_subtitle_tracks_and_search(self):
        self.assertEqual(len(self.asset['subtitles']), 2)
        transcript = self.engine.transcript(self.asset['id'], 'auto', 'searchable')
        self.assertEqual(len(transcript['cues']), 1)
        self.assertEqual(transcript['cues'][0]['start'], 2.5)
        self.assertNotIn('<i>', transcript['cues'][0]['text'])
        spanish = self.engine.subtitles(self.asset['id'], self.asset['subtitles'][1]['index'])
        self.assertIn('Un fotograma', spanish['cues'][0]['text'])

    def test_caption_is_rendered_and_off_works(self):
        on = self.engine.capture(self.asset['id'], 1, {'format': 'png', 'subtitles': 'auto'})
        off = self.engine.capture(self.asset['id'], 1, {'format': 'png', 'subtitles': 'off'})
        self.assertEqual(on['caption'], 'A useful opening frame')
        self.assertEqual(off['caption'], '')
        with Image.open(on['path']) as a, Image.open(off['path']) as b:
            difference = ImageChops.difference(a, b)
            self.assertIsNotNone(difference.getbbox())
            self.assertGreater(difference.getbbox()[1], 250)

    def test_crop_and_resize(self):
        frame = self.engine.capture(self.asset['id'], 3, {'crop': [.25, .25, .5, .5], 'width': 320})
        self.assertEqual((frame['width'], frame['height']), (320, 180))
        self.assertIn('Searchable caption', frame['caption'])

    def test_sample_reaches_last_frame_and_records_decoded_time(self):
        frames = self.engine.sample(self.asset['id'], {'count': 3})
        self.assertEqual(len(frames), 3)
        self.assertAlmostEqual(frames[-1]['time'], 71 / 12, places=4)
        frame = self.engine.capture(self.asset['id'], '2.975')
        self.assertEqual(frame['requested_time'], 2.975)
        self.assertEqual(frame['time'], 3.0)

    def test_reference_pack_contains_actual_files(self):
        frames = self.engine.sample(self.asset['id'], {'at': ['00:01', '00:03', '00:05']})
        result = self.engine.export([f['id'] for f in frames], str(self.root / 'exports'))
        manifest = json.loads((Path(result['folder']) / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['frames']), 3)
        self.assertEqual([f['time'] for f in manifest['frames']], [1, 3, 5])
        for frame in manifest['frames']:
            self.assertTrue((Path(result['folder']) / frame['file']).is_file())
        self.assertEqual(result['page_count'], 1)
        self.assertTrue((Path(result['folder']) / 'pages/page-001.jpg').is_file())
        self.assertIn('Searchable caption', (Path(result['folder']) / 'transcript.txt').read_text(encoding='utf-8'))
        self.assertEqual(self.engine.export([f['id'] for f in frames], str(self.root / 'exports'), 'sheet')['frame_count'], 3)

    def test_default_interval_and_selected_range(self):
        frames = self.engine.sample(self.asset['id'], {})
        self.assertEqual([f['requested_time'] for f in frames], [0, 2, 4])
        self.assertTrue(all(f['format'] == 'png' and f['width'] == 640 and f['height'] == 360 for f in frames))
        selected = self.engine.sample(self.asset['id'], {'every': 1, 'start': '00:01', 'end': '00:04.5'})
        self.assertEqual([f['requested_time'] for f in selected], [1, 2, 3, 4])
        self.assertTrue(all(f['caption'] for f in selected))

    def test_301_frames_keep_native_images_and_constant_page_detail(self):
        # Reuse one detailed native capture to isolate export scaling from decoding.
        original = self.engine.capture(self.asset['id'], 1)
        image = Image.new('RGB', (1920, 1080), '#e9edf3')
        draw = ImageDraw.Draw(image)
        for x in range(0, 1920, 8):
            draw.line((x, 0, x, 950), fill='#253148', width=2)
        self.engine.draw_captions(image, 'Small visual details and captions must remain readable')
        image.save(original['path'])
        identifiers = []
        for i in range(301):
            identifier = f'export-regression-{i}'
            self.engine.frames[identifier] = {**original, 'id': identifier, 'width': 1920, 'height': 1080}
            identifiers.append(identifier)
        small = self.engine.export(identifiers[:4], str(self.root / 'scale-exports'))
        large = self.engine.export(identifiers, str(self.root / 'scale-exports'))
        folder = Path(large['folder'])
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(large['page_count'], 76)
        self.assertEqual(len(manifest['frames']), 301)
        self.assertEqual(manifest['pages'][-1]['first_frame'], 301)
        self.assertEqual(manifest['pages'][-1]['last_frame'], 301)
        self.assertEqual(manifest['frames'][-1]['page'], 'pages/page-076.jpg')
        self.assertEqual(manifest['frames'][-1]['cell'], 1)
        self.assertEqual((folder / 'pages/page-001.jpg').read_bytes(), (Path(small['folder']) / 'pages/page-001.jpg').read_bytes())
        self.assertEqual((folder / manifest['frames'][-1]['file']).read_bytes(), Path(original['path']).read_bytes())
        for page in manifest['pages']:
            with Image.open(folder / page['file']) as exported:
                self.assertLessEqual(max(exported.size), 2048)
            self.assertLess(page['bytes'], 20 * 1024 * 1024)
        self.assertEqual((manifest['frames'][-1]['width'], manifest['frames'][-1]['height']), (1920, 1080))
        self.assertNotIn('thumbnail_path', manifest['frames'][0])

    def test_paginated_export_cancellation_removes_partial_folder(self):
        frame = self.engine.capture(self.asset['id'], 1)
        target = self.root / 'cancelled-export'
        event = threading.Event()
        def progress(value, _):
            if value >= .45:
                event.set()
        with self.assertRaises(Cancelled):
            self.engine.export([frame['id']], str(target), progress=progress, cancel=event)
        self.assertFalse(any(target.iterdir()))

    def test_invalid_inputs_and_cancellation(self):
        for value in ['-1', '1:70', 'not a time', 'Infinity']:
            with self.assertRaises(FramegrabError): parse_time(value)
        with self.assertRaises(FramegrabError): self.engine.sample(self.asset['id'], {'every': .0001})
        with self.assertRaises(FramegrabError): self.engine.capture(self.asset['id'], 99)
        with self.assertRaises(FramegrabError): self.engine.capture(self.asset['id'], 1, {'crop': [.8, 0, .5, 1]})
        event = threading.Event(); event.set()
        with self.assertRaises(Cancelled): self.engine.sample(self.asset['id'], {'count': 2}, cancel=event)

    def test_download_embeds_captions(self):
        result = self.engine.download(f'http://127.0.0.1:{self.http.server_port}/index.html', str(self.root / 'downloads'))
        self.assertTrue(Path(result['path']).is_file())
        self.assertTrue(result['asset']['subtitles'], result)
        captions = self.engine.subtitles(result['asset']['id'])
        self.assertIn('Downloaded caption', captions['cues'][0]['text'])

    def test_media_server_authorization_ranges_and_jobs(self):
        application = Application(str(self.video), str(self.root / 'gui-exports'))
        url = application.serve()
        base = url.split('/?')[0]
        try:
            asset = application.current
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + '/media/' + asset['id'])
            self.assertEqual(error.exception.code, 403)
            request = urllib.request.Request(base + '/media/' + asset['id'] + '?key=' + application.key, headers={'Range': 'bytes=0-99'})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(len(response.read()), 100)
            result = application.dispatch('capture', {'asset_id': asset['id'], 'at': 1})
            identifier = result['result']['job_id']
            for _ in range(100):
                job = application.dispatch('job', {'id': identifier})['result']
                if job['status'] != 'running': break
                time.sleep(.1)
            self.assertEqual(job['status'], 'complete', job)
            self.assertIn('caption', job['result'])
            for route, expected_format in [('thumb', 'JPEG'), ('frame', 'PNG')]:
                with urllib.request.urlopen(base + '/' + route + '/' + job['result']['id'] + '?key=' + application.key) as response:
                    import io
                    with Image.open(io.BytesIO(response.read())) as image:
                        self.assertEqual(image.format, expected_format)
                        if route == 'thumb':
                            self.assertLessEqual(image.width, 300)
                        else:
                            self.assertEqual(image.width, 640)
        finally:
            application.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
