import { build } from "vite";
process.env.VITE_LOCAL_MODE = "true";
await build({ mode: "production" });
console.log("Built Smart Calendar for local use.");
