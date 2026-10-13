; Current-user connector registrations are created by the bundled setup script.
; Preserve registrations pointing at another client installation or CLI package.
!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri marks the old uninstaller with /UPDATE when replacing this package.
  ; Preserve the extension IDs/manifest for that same stable installation path.
  ${If} $UpdateMode <> 1
  Push $R0
  ReadRegStr $R0 HKCU "Software\Google\Chrome\NativeMessagingHosts\com.127vaults.connector" ""
  StrCmp $R0 "$INSTDIR\com.127vaults.connector.json" 0 +2
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.127vaults.connector"
  ReadRegStr $R0 HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.127vaults.connector" ""
  StrCmp $R0 "$INSTDIR\com.127vaults.connector.json" 0 +2
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.127vaults.connector"
  Delete "$INSTDIR\com.127vaults.connector.json"
  Pop $R0
  ${EndIf}
!macroend
