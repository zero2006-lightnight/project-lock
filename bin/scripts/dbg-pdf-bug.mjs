import { execSync } from "node:child_process";
execSync("python scripts/dbg-make-pdf2.py", { stdio: "inherit" });
