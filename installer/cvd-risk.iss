; CVD Risk Calculator - offline installer (Inno Setup 6). Built by installer\build-setup.ps1, which passes:
;   /DStage=<folder with runtime\, server.cjs, web\, launcher.vbs, cvd.ico>  /DOutDir=<output folder>  /DAppVersion=x.y.z
; Everything the program needs (Node.js runtime, server, web app, fonts) is inside the setup - no internet at install time.
; Per-user install (no administrator rights). An older installed version is removed automatically first.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "CVD Risk Calculator"
#define AppGuid "6F2C8E41-3B7D-4A95-9C1E-5D8B0A2F7C63"
#define ServerExe "cvdrisk-server.exe"

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=IM
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=CVD_Risk_Calculator-Setup-Full
SetupIconFile={#Stage}\cvd.ico
UninstallDisplayIcon={app}\cvd.ico
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; wscript runs the launcher without a console window
Name: "{autoprograms}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\cvd.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\cvd.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM {#ServerExe}"; Flags: runhidden; RunOnceId: "StopServer"

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1';

{ Stop the running server and silently uninstall a previously installed version before installing this one. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Uninstaller: String;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM {#ServerExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', Uninstaller) or
     RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', Uninstaller) then
  begin
    Uninstaller := RemoveQuotes(Uninstaller);
    if FileExists(Uninstaller) then
      Exec(Uninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Result := '';
end;
