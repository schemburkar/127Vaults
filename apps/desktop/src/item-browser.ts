import { ITEM_TYPES, type ItemType } from "./item-types";

export type BrowseMode = "all" | "updated" | "created" | "type";
export type BrowseMeta = { itemType?: string | null; createdAt?: number | null; updatedAt?: number | null };
export type BrowseGroup<T> = { key: string; label: string; items: T[] };

export function browseColumnLabel(mode: BrowseMode) {
  return mode === "updated" ? "Updated" : mode === "created" ? "Created" : mode === "type" ? "Type" : "Open";
}

export function browseColumnValue(mode: BrowseMode, meta: BrowseMeta) {
  if (mode === "all") return "›";
  if (mode === "type") return meta.itemType && meta.itemType in ITEM_TYPES ? ITEM_TYPES[meta.itemType as ItemType].label : "—";
  const value = mode === "created" ? meta.createdAt : meta.updatedAt;
  return validTime(value) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

const typeOrder = Object.keys(ITEM_TYPES) as ItemType[];
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function dateBucket(value: unknown, now: Date) {
  if (!validTime(value)) return { key: "unknown", label: "Date unavailable", order: 6 };
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return { key: "unknown", label: "Date unavailable", order: 6 };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (value >= now.getTime() - 60 * 60_000 && value <= now.getTime()) return { key: "now", label: "Now · last hour", order: 0 };
  if (value >= today) return { key: "today", label: "Today", order: 1 };
  if (value >= yesterday) return { key: "yesterday", label: "Yesterday", order: 2 };
  if (value >= now.getTime() - 7 * 86_400_000) return { key: "week", label: "Last 7 days", order: 3 };
  if (value >= now.getTime() - 30 * 86_400_000) return { key: "month", label: "Last 30 days", order: 4 };
  return { key: "older", label: "Older", order: 5 };
}

export function browseGroups<T>(items: T[], mode: BrowseMode, meta: (item: T) => BrowseMeta, now = new Date()): BrowseGroup<T>[] {
  if (mode === "all") return [{ key: "all", label: "All items", items }];
  const groups = new Map<string, BrowseGroup<T> & { order: number }>();
  const field = mode === "created" ? "createdAt" : "updatedAt";
  const sorted = mode === "type" ? items : [...items].sort((a, b) => (meta(b)[field] ?? -1) - (meta(a)[field] ?? -1));
  for (const item of sorted) {
    const details = meta(item);
    const type = details.itemType;
    const bucket = mode === "type"
      ? type && type in ITEM_TYPES
        ? { key: type, label: ITEM_TYPES[type as ItemType].label, order: typeOrder.indexOf(type as ItemType) }
        : { key: "unknown", label: "Type unavailable", order: typeOrder.length }
      : dateBucket(details[field], now);
    if (!groups.has(bucket.key)) groups.set(bucket.key, { key: bucket.key, label: bucket.label, order: bucket.order, items: [] });
    groups.get(bucket.key)!.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
