import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AdminApp from "./AdminApp";

const root = document.getElementById("root");
const hasRoot = root !== null;
if (hasRoot) {
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
