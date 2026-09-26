import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/onest";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Dev only: expose the data layer for quick seeding / debugging in the console.
if (import.meta.env.DEV) {
  void import("./lib/db").then((db) => { (window as unknown as { __sateach: typeof db }).__sateach = db; });
}
