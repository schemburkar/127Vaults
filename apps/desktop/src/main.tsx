import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DetachedItem } from "./detached-item";
import { App } from "./app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode>{new URLSearchParams(location.search).has("detail") ? <DetachedItem /> : <App />}</StrictMode>);
