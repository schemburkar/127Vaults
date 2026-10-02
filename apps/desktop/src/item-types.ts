export type ItemType = "login" | "bank" | "card" | "wifi" | "router" | "ssh" | "password";
export type ItemField = { id: string; label: string; type: string; value: string };

// Stored inside the encrypted item body alongside custom fields, so older clients
// retain the classification even before they understand item types.
export const TYPE_FIELD_ID = "__127vaults_item_type";
export const SECTION_PREFIX = "__127vaults_section:";
export const SECTION_FIELD_PREFIX = "__127vaults_field:";
export const ITEM_TYPES: Record<ItemType, { label: string; fields: Omit<ItemField, "value">[]; username?: boolean; password?: boolean; website?: boolean }> = {
  login: { label: "Login", username: true, password: true, website: true, fields: [] },
  bank: { label: "Bank account", username: true, password: true, website: true, fields: [
    { id: "bank_name", label: "Bank name", type: "text" },
    { id: "account_number", label: "Account number", type: "password" },
    { id: "bank_pin", label: "PIN", type: "password" },
  ] },
  card: { label: "Payment card", fields: [
    { id: "card_number", label: "Card number", type: "password" },
    { id: "cardholder", label: "Cardholder", type: "text" },
    { id: "expiry", label: "Expiry date", type: "text" },
    { id: "cvv", label: "CVV", type: "password" },
    { id: "card_pin", label: "PIN", type: "password" },
  ] },
  wifi: { label: "Wi-Fi network", password: true, fields: [
    { id: "ssid", label: "SSID", type: "text" },
    { id: "wifi_security", label: "Security", type: "text" },
  ] },
  router: { label: "Router", username: true, password: true, website: true, fields: [
    { id: "router_address", label: "Router address", type: "text" },
    { id: "ssid", label: "SSID", type: "text" },
  ] },
  ssh: { label: "SSH / device", username: true, password: true, fields: [
    { id: "host", label: "Host", type: "text" },
    { id: "port", label: "Port", type: "number" },
  ] },
  password: { label: "Password only", password: true, fields: [] },
};

export const TYPE_GROUPS: { label: string; types: ItemType[] }[] = [
  { label: "Basics", types: ["login", "password"] },
  { label: "Financials", types: ["bank", "card"] },
  { label: "Devices and networks", types: ["wifi", "router", "ssh"] },
];
export type SectionType = ItemType | "security";
export const SECTION_TYPES: Record<SectionType, { label: string; fields: Omit<ItemField, "value">[] }> = {
  ...ITEM_TYPES,
  security: { label: "Security info", fields: [
    { id: "question", label: "Security question", type: "text" },
    { id: "answer", label: "Answer", type: "password" },
  ] },
};
export type ItemSection = { id: string; type: SectionType; label: string; fields: ItemField[] };

export function sections(fields: ItemField[]): ItemSection[] {
  return fields.filter((field) => field.id.startsWith(SECTION_PREFIX) && field.type === "metadata")
    .map((marker) => {
      const [typeValue, label] = marker.value.split("|", 2);
      const type = typeValue in SECTION_TYPES ? typeValue as SectionType : "security";
      const id = marker.id.slice(SECTION_PREFIX.length);
      return { id, type, label: label || SECTION_TYPES[type].label,
        fields: fields.filter((field) => field.id.startsWith(`${SECTION_FIELD_PREFIX}${id}:`)) };
    });
}

export function addSection(fields: ItemField[], type: SectionType): ItemField[] {
  const id = crypto.randomUUID();
  return [...fields,
    { id: `${SECTION_PREFIX}${id}`, label: "Section", type: "metadata", value: `${type}|${SECTION_TYPES[type].label}` },
    ...SECTION_TYPES[type].fields.map((field) => ({ ...field, id: `${SECTION_FIELD_PREFIX}${id}:${field.id}`, value: "" })),
  ];
}

export function removeSection(fields: ItemField[], id: string): ItemField[] {
  return fields.filter((field) => field.id !== `${SECTION_PREFIX}${id}` && !field.id.startsWith(`${SECTION_FIELD_PREFIX}${id}:`));
}

export function primaryFields(fields: ItemField[]): ItemField[] {
  return fields.filter((field) => ITEM_TYPES[itemType(fields)].fields.some((template) => template.id === field.id));
}

export function ordinaryFields(fields: ItemField[]): ItemField[] {
  const primary = new Set(primaryFields(fields).map((field) => field.id));
  return fields.filter((field) => field.id !== TYPE_FIELD_ID && !field.id.startsWith(SECTION_PREFIX) &&
    !field.id.startsWith(SECTION_FIELD_PREFIX) && !primary.has(field.id));
}

export function itemType(fields: ItemField[]): ItemType {
  const value = fields.find((field) => field.id === TYPE_FIELD_ID)?.value;
  return value && value in ITEM_TYPES ? value as ItemType : "login";
}

export function visibleFields(fields: ItemField[]): ItemField[] {
  return fields.filter((field) => field.id !== TYPE_FIELD_ID && !field.id.startsWith(SECTION_PREFIX));
}

export function setItemType(fields: ItemField[], type: ItemType): ItemField[] {
  const oldType = itemType(fields);
  const oldKnown = fields.filter((field) => ITEM_TYPES[oldType].fields.some((template) => template.id === field.id));
  const hasPreviousValues = oldType !== type && oldKnown.some((field) => field.value);
  const archived = hasPreviousValues ? addSection([], oldType) : [];
  const oldSectionId = archived[0]?.id.slice(SECTION_PREFIX.length);
  const archivedFields = archived.map((field) => {
    const name = field.id.slice(`${SECTION_FIELD_PREFIX}${oldSectionId}:`.length);
    const previous = oldKnown.find((known) => known.id === name);
    return previous ? { ...field, value: previous.value } : field;
  });
  const retained = fields.filter((field) => field.id !== TYPE_FIELD_ID && (
    !ITEM_TYPES[oldType].fields.some((template) => template.id === field.id) ||
    ITEM_TYPES[type].fields.some((template) => template.id === field.id)));
  const next = ITEM_TYPES[type].fields.filter((template) => !retained.some((field) => field.id === template.id))
    .map((field) => ({ ...field, value: "" }));
  return [{ id: TYPE_FIELD_ID, label: "Item type", type: "metadata", value: type }, ...retained, ...archivedFields, ...next];
}
