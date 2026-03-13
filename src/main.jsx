import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App, { PinScreen, SESSION_KEY } from "./App";

function AppGate() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem(SESSION_KEY));
  if (!authed) return <PinScreen onAuth={() => setAuthed(true)} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppGate />
  </React.StrictMode>
);
