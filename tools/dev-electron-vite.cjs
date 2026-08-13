const { spawn } = require("node:child_process");
const { join } = require("node:path");

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => key && !key.startsWith("=") && value)
);
delete env.ELECTRON_RUN_AS_NODE;

const command = process.execPath;
const electronViteBin = join(
  __dirname,
  "..",
  "node_modules",
  "electron-vite",
  "bin",
  "electron-vite.js"
);

const child = spawn(command, [electronViteBin, "dev"], {
  cwd: join(__dirname, ".."),
  env,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
