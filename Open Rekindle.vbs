Option Explicit
Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & root & "\scripts\Start-Rekindle.ps1" & Chr(34)
result = shell.Run(command, 0, True)
If result <> 0 Then MsgBox "Rekindle could not start. Run Setup-Rekindle.cmd or check data\server.stderr.log.", 48, "Rekindle"
