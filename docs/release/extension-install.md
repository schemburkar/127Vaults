# Chrome / Edge private test extension

Extract this ZIP and keep the `127vaults-extension` directory at a stable path.
Open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose
Load unpacked, and select that directory. This is a Chromium Manifest V3 build;
Firefox and a browser-store installation are not included.

For the web source, keep your enrolled web vault open and unlocked and configure
its HTTPS address in the popup. For desktop or CLI sources, install the matching
client package and register its bundled `127vaults-extension-host` executable
using the client package's script and the extension ID shown by your browser.
Use the Windows PowerShell script or Linux shell script in that client package.

Test with a sample login on an HTTPS site you control. Unlock the source,
open the popup, choose the matching login and request fill. The form is not
submitted automatically. The passkey provider is opt-in and experimental.
There is no store signature or automatic update; compare package checksums with
the sender and reload the extension after replacing its files.
