// SPDX-License-Identifier: LicenseRef-Proprietary

import { useBoxStore } from "@box/ui";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

// Dev-only: expose the store so CDP tooling can drive/inspect the page.
const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
if (dev) {
  (window as unknown as { __box: typeof useBoxStore }).__box = useBoxStore;
}

const el = document.getElementById("root");
if (el !== null) {
  createRoot(el).render(<App />);
}
