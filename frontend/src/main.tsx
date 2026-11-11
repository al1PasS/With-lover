import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import SilkCursorTrail from "./SilkCursorTrail";
import "./style.css";
function StartupReady() {
  React.useEffect(() => {
    document.getElementById("root")?.setAttribute("data-app-ready", "true");
  }, []);
  return null;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <SilkCursorTrail />
    <StartupReady />
  </React.StrictMode>,
);
