import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "katex/dist/katex.min.css";
import "@xyflow/react/dist/style.css";
import App from "./App";
import "./styles/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The Lemma application root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
