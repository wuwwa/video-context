"""Collect local redistributables and license notices; never change upstream binaries."""
from pathlib import Path
import importlib.metadata as metadata
import shutil
import subprocess
import urllib.request
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
tools = root / 'tools'; tools.mkdir(exist_ok=True)
licenses = root / 'licenses'; licenses.mkdir(exist_ok=True)
for name in ('ffmpeg', 'ffprobe', 'node'):
    source = shutil.which(name)
    if not source:
        raise SystemExit(name + ' must be on PATH to build')
    shutil.copyfile(source, tools / (name + '.exe'))

ffmpeg_root = Path(shutil.which('ffmpeg')).parent.parent
shutil.copyfile(ffmpeg_root / 'LICENSE', licenses / 'FFmpeg-GPL-LICENSE.txt')
configuration = subprocess.run([shutil.which('ffmpeg'), '-version'], capture_output=True, text=True).stdout
(licenses / 'FFmpeg-SOURCE.txt').write_text('Unmodified Gyan FFmpeg 7.1.1 essentials build.\nBuild distributor: https://www.gyan.dev/ffmpeg/builds/\nRelease and original binary: https://github.com/GyanD/codexffmpeg/releases/tag/7.1.1\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n7.1.1\nBuild scripts and dependency source links: https://github.com/rdp/ffmpeg-windows-build-helpers\nSource release: https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz\n\n' + configuration, encoding='utf-8')
node_version = subprocess.run([shutil.which('node'), '--version'], capture_output=True, text=True).stdout.strip()
license_url = f'https://raw.githubusercontent.com/nodejs/node/{node_version}/LICENSE'
(licenses / 'Node-LICENSE.txt').write_bytes(urllib.request.urlopen(license_url, timeout=30).read())
(licenses / 'Node-SOURCE.txt').write_text(f'Unmodified Node {node_version}.\nhttps://nodejs.org/dist/{node_version}/\nSource: https://github.com/nodejs/node/tree/{node_version}\n', encoding='utf-8')
python_license = Path(__import__('sys').base_prefix) / 'LICENSE.txt'
if python_license.is_file(): shutil.copyfile(python_license, licenses / 'Python-LICENSE.txt')
for package in ('pywebview', 'yt-dlp', 'yt-dlp-ejs', 'Pillow', 'pythonnet', 'clr-loader', 'bottle', 'proxy-tools', 'typing_extensions', 'pyinstaller', 'requests', 'urllib3', 'certifi', 'websockets', 'mutagen', 'brotli', 'pycryptodomex', 'curl-cffi', 'cffi'):
    try: distribution = metadata.distribution(package)
    except metadata.PackageNotFoundError: continue
    for entry in distribution.files or []:
        if any(word in str(entry).lower() for word in ('license', 'copying', 'notice')) and Path(distribution.locate_file(entry)).is_file():
            shutil.copyfile(distribution.locate_file(entry), licenses / (package + '-' + Path(entry).name))
modules = root / 'ui' / 'node_modules'
for manifest in modules.rglob('package.json'):
    try:
        import json
        package = json.loads(manifest.read_text(encoding='utf-8'))
        name = package.get('name', 'unknown').replace('/', '-')
        for entry in manifest.parent.iterdir():
            if entry.is_file() and entry.name.lower().startswith(('license', 'copying', 'notice', 'ofl')):
                shutil.copyfile(entry, licenses / (name + '-' + entry.name))
    except (OSError, ValueError): pass
icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((0, 0, 255, 255), 57, fill='#365cf5')
for points in [((61,100),(61,61),(100,61)), ((156,61),(195,61),(195,100)), ((195,156),(195,195),(156,195)), ((100,195),(61,195),(61,156))]:
    draw.line(points, fill='white', width=12, joint='curve')
draw.ellipse((111,111,145,145), fill='white')
icon.save(root / 'framegrab.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Runtime tools, licenses, and icon prepared')
