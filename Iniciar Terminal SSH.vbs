Set WshShell = CreateObject("WScript.Shell")
folder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.Run """" & folder & "Iniciar Terminal SSH.bat""", 0, False
