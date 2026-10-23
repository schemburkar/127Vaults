import { PasskeyDetails, AuthenticatorCode, TOTP_ID, IconButton, cn } from "@127vaults/ui";
import { Copy, Eye, EyeOff, GripVertical } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ITEM_TYPES, itemType, primaryFields, ordinaryFields, sections } from "@127vaults/domain/item-types";
type Item = { title: string; website: string; username: string; password: string; customFields: { id: string; label: string; type: string; value: string }[] };
export function ReadonlyItem({ item, revealed, toggleReveal, copyValue, dragValue, endDrag, actions, openWebsite, copyField, requireRevealForDrag = false }: {
item: Item; revealed: Set<string>; toggleReveal: (key: string) => void; copyValue: (value: string) => Promise<void>;
dragValue: (event: React.DragEvent, label: string, value: string) => void; endDrag: () => void;
requireRevealForDrag?: boolean; copyField?: (key: string, value: string, secret: boolean) => Promise<void>; actions?: React.ReactNode; openWebsite: (url: string) => void;
}) { return <>
                <div className="ui-page-header desktop-detail-heading mb-7">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold tracking-[.16em] text-slate-500">
                      {ITEM_TYPES[itemType(item.customFields)].label.toUpperCase()}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
{actions}
                    </div>
                  </div>
                  <div>
                    <h2 className="mt-1 text-3xl font-bold">
                      {item.title || "Untitled"}
                    </h2>
                    {item.website && (
                      <button
                        className="mt-1 block text-sm text-[#E0BB95] hover:underline"
                        onClick={() => openWebsite(item.website)}
                      >
                        {item.website}
                      </button>
                    )}
                  </div>
                </div>
                <PasskeyDetails fields={item.customFields} />
                {item.customFields.find(f => f.id === TOTP_ID)?.value && <AuthenticatorCode value={item.customFields.find(f => f.id === TOTP_ID)!.value} copy={copyValue} />}
                <section hidden={itemType(item.customFields) === "passkey" && !primaryFields(item.customFields).length && !ordinaryFields(item.customFields).length}>
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    {ITEM_TYPES[itemType(item.customFields)].label.toUpperCase()}
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/3">
                    {[
                      ...(ITEM_TYPES[itemType(item.customFields)].username ? [{
                        key: "username",
                        label: "Username",
                        value: item.username,
                        secret: false,
                      }] : []),
                      ...(ITEM_TYPES[itemType(item.customFields)].password ? [{
                        key: "password",
                        label: "Password",
                        value: item.password,
                        secret: true,
                      }] : []),
                      ...[...primaryFields(item.customFields), ...ordinaryFields(item.customFields)].map((field) => ({
                        key: field.id,
                        label: field.label,
                        value: field.value,
                        secret: field.type === "password",
                      })),
                    ].map((field, index) => (
                      <div
                        key={field.key}
                        className={cn(
                          "desktop-field-row grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 px-4",
                          index > 0 && "border-t border-white/7",
                        )}
                      >
                        <span className="text-xs text-slate-500">
                          {field.label}
                        </span>
                        <strong
                          className={cn(
                            "min-w-0 truncate text-sm",
                            field.secret && "font-mono",
                          )}
                        >
                          {field.secret && !revealed.has(field.key)
                            ? "••••••••••••"
                            : field.value || "—"}
                        </strong>
                        <div className="flex gap-1">
                          {field.secret && (
                            <IconButton
                              label={`${revealed.has(field.key) ? "Hide" : "Reveal"} ${field.label}`}
                              aria-pressed={revealed.has(field.key)}
                              onClick={() => toggleReveal(field.key)}
                            >
                              {revealed.has(field.key) ? (
                                <EyeOff size={15} />
                              ) : (
                                <Eye size={15} />
                              )}
                            </IconButton>
                          )}
                          <IconButton
                            label={`Copy ${field.label}`}
                            onClick={() => void (copyField ? copyField(field.key, field.value, field.secret) : copyValue(field.value))}
                          >
                            <Copy size={15} />
                          </IconButton>
                          <IconButton
                            label={`Drag ${field.label}`}
                            disabled={requireRevealForDrag && field.secret && !revealed.has(field.key)}
                            draggable={!requireRevealForDrag || !field.secret || revealed.has(field.key)}
                            onDragStart={(event) =>
                              dragValue(event, field.label, field.value)
                            }
                            onDragEnd={() => endDrag()}
                            title={`Drag ${field.label}`}
                          >
                            <GripVertical size={15} />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                  </div>
                  {sections(item.customFields).map((section) => <section key={section.id} className="mt-6 overflow-hidden rounded-2xl border border-white/8 bg-white/3">
                    <h3 className="border-b border-white/8 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#E0BB95]">{section.label}</h3>
                    {section.fields.map((field) => <div key={field.id} className="desktop-field-row grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 border-b border-white/7 px-4 last:border-0">
                      <span className="text-xs text-slate-500">{field.label}</span>
                      <strong className="min-w-0 truncate text-sm">{field.type === "password" && !revealed.has(field.id) ? "••••••••••••" : field.value || "—"}</strong>
                      <div className="flex gap-1">
                        {field.type === "password" && <IconButton label={`${revealed.has(field.id) ? "Hide" : "Reveal"} ${field.label || "secret"}`} variant="ghost" aria-pressed={revealed.has(field.id)} onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton>}
                        <IconButton label={`Copy ${field.label}`} onClick={() => void (copyField ? copyField(field.id, field.value, field.type === "password") : copyValue(field.value))}><Copy size={16} aria-hidden="true" /></IconButton>
                        <IconButton label={`Drag ${field.label}`} disabled={requireRevealForDrag && field.type === "password" && !revealed.has(field.id)} draggable={!requireRevealForDrag || field.type !== "password" || revealed.has(field.id)} onDragStart={(event) => dragValue(event, field.label, field.value)} onDragEnd={() => endDrag()}><GripVertical size={16} aria-hidden="true" /></IconButton>
                      </div>
                    </div>)}
                  </section>)}
                  {(!requireRevealForDrag || revealed.has("password")) && itemType(item.customFields) === "wifi" && item.customFields.find((field) => field.id === "ssid")?.value && <div className="mt-6 inline-grid gap-3 rounded-xl bg-white p-4 text-slate-900">
                    <QRCodeSVG size={180} value={`WIFI:T:${item.customFields.find((field) => field.id === "wifi_security")?.value || "WPA"};S:${item.customFields.find((field) => field.id === "ssid")?.value.replace(/([\\;,:\"])/g, "\\$1")};P:${item.password.replace(/([\\;,:\"])/g, "\\$1")};;`} />
                    <span className="text-center text-xs font-semibold">Scan to join Wi-Fi</span>
                  </div>}
                </section>
</>; }
