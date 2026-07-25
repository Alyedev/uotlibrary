Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd /c cd /d D:\library && npm start", 0, False
