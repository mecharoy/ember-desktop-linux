import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import CaptureBar from "./capture/CaptureBar";
// Bundled with the app, never fetched: Elytra makes no network calls of its own.
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource-variable/epilogue/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/caveat/wght.css";
import "./index.css";
import { startTheme } from "./theme";

// One bundle serves both windows: the main one and the Ctrl+Shift+J capture bar.
const isCaptureBar = getCurrentWindow().label === "capture-bar";
if (isCaptureBar) document.documentElement.classList.add("capture-window");

// Before the first render, so nothing ever paints in the wrong theme — both
// windows, since the capture bar sits on the same palette.
void startTheme();

// No StrictMode: its doubled effects in development push and pop the history
// entries useBackButton keeps, which closes pages in dev that stay open.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(isCaptureBar ? <CaptureBar /> : <App />);
