$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  python prepare_build.py
  if ($LASTEXITCODE -ne 0) { throw 'Build preparation failed' }
  Push-Location ui
  try { npm ci --no-audit --no-fund; npm run build; if ($LASTEXITCODE -ne 0) { throw 'UI build failed' } }
  finally { Pop-Location }
  $fgWeb = (Resolve-Path 'web').Path
  $fgTools = (Resolve-Path 'tools').Path
  $fgLicenses = (Resolve-Path 'licenses').Path
  $fgIcon = (Resolve-Path 'framegrab.ico').Path
  python -m PyInstaller --noconfirm --clean --onefile --windowed --name Framegrab --icon $fgIcon --paths backend --collect-submodules yt_dlp --collect-all yt_dlp_ejs --add-data "$fgWeb;web" --add-data "$fgLicenses;licenses" --add-binary "$fgTools\ffmpeg.exe;tools" --add-binary "$fgTools\ffprobe.exe;tools" --add-binary "$fgTools\node.exe;tools" --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module PySide2 --exclude-module PySide6 --exclude-module gi --exclude-module matplotlib --exclude-module scipy --exclude-module pandas --distpath dist --workpath build --specpath . backend\app.py
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
  python -m PyInstaller --noconfirm --clean --onefile --console --name framegrab-cli --icon $fgIcon --distpath dist --workpath build-cli --specpath . backend\launcher_cli.py
  if ($LASTEXITCODE -ne 0) { throw 'Console build failed' }
}
finally { Pop-Location }
