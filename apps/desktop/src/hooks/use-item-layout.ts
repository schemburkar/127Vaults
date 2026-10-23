import { useEffect, useState } from "react";
import { type BrowseMode } from "@127vaults/domain/item-browser";
import { type ItemType } from "@127vaults/domain/item-types";

export function useItemLayout() {
  const [itemLayout, setItemLayout] = useState<"list" | "grid">(() => {
    try { return localStorage.getItem("127vaults:desktop-item-layout") === "grid" ? "grid" : "list"; }
    catch { return "list"; }
  });
  const [browseMode, setBrowseMode] = useState<BrowseMode>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1440px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const updateWidth = () => setWide(media.matches);
    media.addEventListener("change", updateWidth);
    return () => media.removeEventListener("change", updateWidth);
  }, []);
  const changeItemLayout = (next: "list" | "grid") => {
    setItemLayout(next);
    try { localStorage.setItem("127vaults:desktop-item-layout", next); } catch { /* Storage may be disabled. */ }
  };
  return { itemLayout, changeItemLayout, browseMode, setBrowseMode, typeFilter, setTypeFilter, wide };
}
