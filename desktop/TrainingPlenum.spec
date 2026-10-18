# PyInstaller: Training Plēnum as a Windows program folder; desktop/build-windows.ps1 builds the frontend first.
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH).parent
build = root / 'frontend' / 'build'
if not (build / 'index.html').exists():
    raise SystemExit('Frontend build missing: run npm run build in frontend first.')

a = Analysis(
    [str(root / 'backend' / 'desktop.py')],
    pathex=[str(root / 'backend')],
    datas=[(str(build), 'frontend')] + collect_data_files('webview') + collect_data_files('garmin_fit_sdk'),
    excludes=['tkinter'],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Training Plenum', icon=str(root / 'desktop' / 'trainhub.ico'),
          console=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name='Training Plenum', upx=False)
