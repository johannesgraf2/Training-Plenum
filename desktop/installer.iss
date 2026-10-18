; Inno Setup: installs the PyInstaller folder for the current user, without admin rights.
; Built by desktop/build-windows.ps1: iscc /DAppVersion=1.2.3 desktop\installer.iss
; The data in %LOCALAPPDATA%\Training Plenum stays on updates and uninstalling.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{DD256E28-E4B9-4026-BC49-F1C368CDC938}
AppName=Training Plēnum
AppVersion={#AppVersion}
AppPublisher=Training Plēnum
DefaultDirName={autopf}\Training Plenum
DefaultGroupName=Training Plēnum
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=TrainingPlenum-Setup-{#AppVersion}
SetupIconFile=trainhub.ico
UninstallDisplayIcon={app}\Training Plenum.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\Training Plenum\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Old library files of a previous version, so nothing outdated is loaded next to the new ones.
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{group}\Training Plēnum"; Filename: "{app}\Training Plenum.exe"
Name: "{autodesktop}\Training Plēnum"; Filename: "{app}\Training Plenum.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Training Plenum.exe"; Description: "{cm:LaunchProgram,Training Plēnum}"; Flags: nowait postinstall skipifsilent
