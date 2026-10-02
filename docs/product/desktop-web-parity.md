# Desktop ↔ web feature backlog

> Superseded by the [web backlog](web-backlog.md) and [desktop backlog](desktop-backlog.md). The table below records the earlier comparison and should not be updated as a second queue.

This is the running backlog for desktop capabilities that still need web parity. Update it whenever the desktop client changes. Verify each entry against the current web implementation before closing it.

| Desktop capability | Web gap | Next web work |
| --- | --- | --- |
| Item types: login, bank account, payment card, Wi-Fi network, router, SSH/device, and password only, with encrypted type metadata and named preset fields | Web item form still assumes a login | Read the type marker, offer grouped type selection and first-party field layouts. |
| Multiple typed sections on one item, including payment card and security questions | Web has only a flat custom-field list | Decode section markers and render each group with its stable internal field IDs. |
| Wi-Fi join QR code in item details | No Wi-Fi QR display | Generate the QR locally from SSID, security and password. |
| Wider conflict comparison with explicit checked field choices and one action that saves the selected result | Web has the earlier narrow merge dialog and a second save step | Port the comparison layout and immediate resolution save. |
| Refresh verified replica after an accepted item save to keep the next edit on the current catalogue revision | Web save flow needs the same revision check | Verify and refresh the web client after save, including conflict resolution. |
| Installed desktop offline unlock, encrypted local replica and durable offline edit queue | Web relies on browser session and server reachability | Design browser storage and unlock policy before implementation. |
| Desktop device enrollment flow with approval polling | Web currently handles enrollment requests for CLI devices | Add a browser appropriate device flow if the web app gains local replica support. |
| Drag a username, password or custom field into another desktop app | Browser page cannot provide OS level outbound drag behavior | Decide whether browser drag to other tabs is useful and document platform limits. |
| Manual lock, sync status, explicit sync and server version restore in the desktop shell | Web controls and status differ | Align labels, confirmation and recovery behavior. |

The existing web app already has basic password reveal, timed clipboard clearing, custom fields and a conflict dialog; those are parity improvements rather than missing features. The desktop item type marker is an encrypted custom field with ID `__127vaults_item_type`; absent markers mean `login`. Additional section markers use `__127vaults_section:<uuid>` and section fields use `__127vaults_field:<uuid>:<name>`. Keep these formats readable while the web migration is built.
