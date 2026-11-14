; PDFnix additions to electron-builder's assisted NSIS installer
; (electron-builder.yml: nsis.include). electron-builder can only create the
; desktop shortcut always or never, so it is created here from a check box on
; the finish page, and removed here when uninstalling.

!macro customFinishPage
  Function StartApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  Function CreateDesktopShortcut
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH
!macroend

; electron-builder's fileAssociations entry registers the PDFnix.Document class
; and lists it under "Open with" for .pdf. Registering the app's capabilities
; as well makes it selectable in Settings > Apps > Default apps. Windows keeps
; the user's actual default (UserChoice); installing does not change it.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\PDFnix\Capabilities" "ApplicationName" "PDFnix"
  WriteRegStr SHELL_CONTEXT "Software\PDFnix\Capabilities" "ApplicationDescription" "Read, annotate, edit and convert PDF files."
  WriteRegStr SHELL_CONTEXT "Software\PDFnix\Capabilities\FileAssociations" ".pdf" "PDFnix.Document"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "PDFnix" "Software\PDFnix\Capabilities"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "PDFnix"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)"
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller silently with --updated: keep
  ; everything the user chose then.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "PDFnix"
    DeleteRegKey SHELL_CONTEXT "Software\PDFnix"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
    ; The association wrote PDFnix.Document as .pdf's class; leave .pdf to
    ; Windows' own default again if it still points at the removed class.
    ReadRegStr $1 SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${if} $1 == "PDFnix.Document"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${endIf}

    StrCpy $0 "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${if} ${FileExists} "$0"
      WinShell::UninstShortcut "$0"
      Delete "$0"
    ${endIf}

    ; Settings, signatures, recovery copies, downloaded OCR languages and
    ; logs stay unless the user asks for them to go. A silent uninstall keeps them.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also delete your PDFnix settings, saved signatures, recovery copies and downloaded OCR languages?$\r$\n$\r$\nChoose No to keep them for a later installation." \
      /SD IDNO IDNO pdfnix_keep_user_data
      ; Electron keeps app data per user, also for an all-users installation.
      SetShellVarContext current
      RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    pdfnix_keep_user_data:
  ${endIf}
!macroend
