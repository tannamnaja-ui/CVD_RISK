' CVD Risk Calculator - starts the local server hidden (no command prompt) and opens the app in its own window.
' Installed next to: runtime\cvdrisk-server.exe (Node.js), server.cjs, web\ (built app), cvd.ico.
' Settings (config.json) and the server log live in %APPDATA%\CVD Risk Calculator, so reinstalling keeps them.
Option Explicit

Const PORT = 4009
Dim sh, fso, appDir, dataDir, url
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = sh.ExpandEnvironmentStrings("%APPDATA%") & "\CVD Risk Calculator"
url = "http://localhost:" & PORT & "/"
If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", url & "api/health", False
  http.send
  If Err.Number = 0 Then ServerUp = (http.status = 200)
  On Error GoTo 0
End Function

If Not ServerUp() Then
  Dim env, i
  Set env = sh.Environment("PROCESS")
  env("CV_CONFIG") = dataDir & "\config.json"
  sh.CurrentDirectory = appDir
  ' window style 0 = hidden; the server keeps running after the window is closed (stopped by the uninstaller)
  sh.Run "cmd /c """"" & appDir & "\runtime\cvdrisk-server.exe"" ""server.cjs"" --serve-static --static-dir web --port " & PORT & _
         " >> """ & dataDir & "\server.log"" 2>&1""", 0, False
  For i = 1 To 60
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
  If Not ServerUp() Then
    MsgBox "เปิดโปรแกรมไม่สำเร็จ — ดูรายละเอียดใน " & dataDir & "\server.log", vbExclamation, "CVD Risk Calculator"
    WScript.Quit 1
  End If
End If

' its own window (Edge app mode); any other browser if Edge is missing
On Error Resume Next
sh.Run "msedge --app=" & url, 1, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run url, 1, False
End If
