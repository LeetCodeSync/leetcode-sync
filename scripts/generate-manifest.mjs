import fs from "node:fs";
import pkg from "../package.json" with { type: "json" };

const template = fs.readFileSync("public/manifest.template.json", "utf8");
const manifest = template.replace("__APP_VERSION__", pkg.version);

fs.writeFileSync("public/manifest.json", manifest);
