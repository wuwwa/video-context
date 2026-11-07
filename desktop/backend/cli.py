"""Stable JSON commands for agents and terminal users."""
import argparse
import json
import sys
from pathlib import Path

from core import Engine, FramegrabError, VERSION


def parser():
    root = argparse.ArgumentParser(prog='framegrab', description='Open, download, and reference videos. Successful commands emit JSON.')
    root.add_argument('--version', action='version', version=f'Framegrab {VERSION}')
    commands = root.add_subparsers(dest='command', required=True)
    info = commands.add_parser('info', help='Read video metadata and list embedded subtitle tracks')
    info.add_argument('video')
    transcript = commands.add_parser('transcript', help='Read or search timed subtitle text')
    transcript.add_argument('video')
    transcript.add_argument('--track', default='auto', help='Subtitle stream index or auto')
    transcript.add_argument('--query', default='')
    transcript.add_argument('--out', help='Also write the JSON result to this file')
    frames = commands.add_parser('frames', help='Capture images and export a reference pack')
    frames.add_argument('video')
    timing = frames.add_mutually_exclusive_group()
    timing.add_argument('--at', nargs='+', help='Timestamps in seconds or hh:mm:ss; comma-separated values also work')
    timing.add_argument('--every', type=float, help='Seconds between frames (default 2)')
    timing.add_argument('--count', type=int, help='Evenly spaced frame count instead of an interval')
    frames.add_argument('--start', default='0')
    frames.add_argument('--end')
    frames.add_argument('--width', type=int, default=0, choices=[0, 320, 480, 640, 960, 1280, 1920], help='Maximum width; 0 preserves the source (default)')
    frames.add_argument('--format', choices=['jpg', 'png'], default='png')
    frames.add_argument('--quality', type=int, default=95)
    frames.add_argument('--subtitles', default='auto', help='auto, off, or subtitle stream index')
    frames.add_argument('--crop', nargs=4, type=float, metavar=('X', 'Y', 'WIDTH', 'HEIGHT'), help='Fractions of the source frame')
    frames.add_argument('--kind', choices=['reference', 'frames', 'sheet'], default='reference')
    frames.add_argument('--out', required=True, help='Parent folder for a new export folder')
    download = commands.add_parser('download', help='Download one video with built-in yt-dlp')
    download.add_argument('url')
    download.add_argument('--out', required=True, help='Download folder')
    download.add_argument('--quality', choices=['480', '720', '1080', 'best'], default='1080')
    download.add_argument('--lang', default='en')
    download.add_argument('--subtitles', choices=['auto', 'manual', 'none'], default='auto')
    download.add_argument('--no-embed', action='store_true', help='Keep subtitle sidecars without embedding them')
    return root


def main(argv=None) -> int:
    arguments = parser().parse_args(argv)
    engine = Engine()
    try:
        if arguments.command == 'download':
            result = engine.download(arguments.url, arguments.out, arguments.quality, arguments.lang, arguments.subtitles, not arguments.no_embed)
        else:
            asset = engine.inspect(arguments.video)
            if arguments.command == 'info':
                result = asset
            elif arguments.command == 'transcript':
                result = engine.transcript(asset['id'], arguments.track, arguments.query)
                if arguments.out:
                    Path(arguments.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            else:
                options = {'start': arguments.start, 'count': arguments.count}
                if arguments.end is not None:
                    options['end'] = arguments.end
                if arguments.every is not None:
                    options['every'] = arguments.every
                if arguments.at:
                    options['at'] = [v for part in arguments.at for v in part.split(',') if v]
                settings = {'width': arguments.width, 'format': arguments.format, 'quality': arguments.quality,
                            'subtitles': arguments.subtitles, 'crop': arguments.crop}
                frames = engine.sample(asset['id'], options, settings)
                result = engine.export([f['id'] for f in frames], arguments.out, arguments.kind)
                result['manifest'] = str(Path(result['folder']) / 'manifest.json') if arguments.kind == 'reference' else None
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False, indent=2))
        return 0
    except (FramegrabError, OSError, ValueError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 1
    finally:
        engine.close()


if __name__ == '__main__':
    raise SystemExit(main())
