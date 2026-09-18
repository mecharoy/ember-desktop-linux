import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import CaptureBar from "./capture/CaptureBar";
// Bundled with the app, not fetched: Ember makes no network calls of its own.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/caveat/wght.css";
import "./index.css";

// One bundle serves both windows: the main one and the Ctrl+Shift+J capture bar.
const isCaptureBar = getCurrentWindow().label === "capture-bar";
if (isCaptureBar) document.documentElement.classList.add("capture-window");

// No StrictMode: its doubled effects in development push and pop the history
// entries useBackButton keeps, which closes pages in dev that stay open.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(isCaptureBar ? <CaptureBar /> : <App />);
