' Drawing to STEP desk, started hidden at Windows login (copy in the Startup folder).
' Runs Documents\Drawing to STEP\run-desk.cmd with no window, so it cannot be closed or Ctrl-C'd by accident.
' The .cmd keeps the desk alive (restarts it if it stops) and refreshes the code from GitHub on each start.
' To stop auto-start: delete "Drawing to STEP desk.vbs" from the Startup folder.
Set sh = CreateObject("WScript.Shell")
cmdPath = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\Drawing to STEP\run-desk.cmd"
sh.Run """" & cmdPath & """", 0, False
