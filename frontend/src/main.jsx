import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyDocLang } from "./i18n";

// Direction/lang follow the saved language (English = LTR, Hebrew = RTL),
// applied before the first render so there is no flash of the wrong layout.
applyDocLang();
document.body.style.direction = "";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
