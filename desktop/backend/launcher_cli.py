"""Small console companion; shares all operations with the graphical executable."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    executable = Path(sys.executable).parent / 'Framegrab.exe'
    if not executable.is_file():
        print(json.dumps({'ok': False, 'error': 'Place framegrab-cli.exe beside Framegrab.exe.'}))
        return 1
    with tempfile.TemporaryDirectory(prefix='framegrab-command-') as directory:
        result_file = Path(directory) / 'result.json'
        process = subprocess.Popen([str(executable), '--headless', *sys.argv[1:], '--result-file', str(result_file)])
        try:
            code = process.wait()
        except KeyboardInterrupt:
            process.terminate()
            process.wait()
            return 130
        if not result_file.is_file():
            print(json.dumps({'ok': False, 'error': 'Framegrab exited before returning a result.'}))
            return code or 1
        result = json.loads(result_file.read_text(encoding='utf-8'))
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
        print(result['stdout'], end='')
        print(result['stderr'], file=sys.stderr, end='')
        return result['code']


if __name__ == '__main__':
    raise SystemExit(main())
