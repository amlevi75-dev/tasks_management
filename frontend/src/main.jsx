import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Force LTR at the very first moment — before any React render
// Prevents Windows Hebrew locale or AD Hebrew names from flipping the page
document.documentElement.setAttribute("dir", "ltr");
document.documentElement.setAttribute("lang", "en");
document.body.style.direction = "ltr";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
