import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { loadConfig } from "./lib/app.svelte";

await loadConfig();
mount(App, { target: document.getElementById("app")! });
