import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const figures = {
  "interaction-trace": { file: "prototype-inspection.pdf", width: 1440 },
  "dialogue-patterns": { file: "dialogue-patterns.pdf", width: 1120 },
};
const [figure = "interaction-trace", ...extraArgs] = process.argv.slice(2);
if (!Object.hasOwn(figures, figure) || extraArgs.length > 0) {
  throw new Error("Usage: pnpm paper:figure [interaction-trace|dialogue-patterns]");
}
const output = resolve(root, "paper/figures", figures[figure].file);
const figureUrl =
  process.env.PAPER_FIGURE_URL ??
  `http://127.0.0.1:4310/figure/${figure}`;

const chrome = findChrome();
if (!chrome) {
  throw new Error(
    "Chrome or Chromium is required to export the paper figure as vector PDF.",
  );
}

let server = null;
let startedServer = false;
const profile = await mkdtemp(join(tmpdir(), "proactive-ai-figure-"));
const pendingOutput = join(profile, "figure.pdf");

try {
  if (!(await responds(figureUrl))) {
    server = spawn(
      "pnpm",
      [
        "--filter",
        "@proactive-ai/demo",
        "dev",
        "--hostname",
        "127.0.0.1",
        "-p",
        "4310",
      ],
      {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    startedServer = true;
    await waitForPage(figureUrl, server);
  }

  await mkdir(dirname(output), { recursive: true });
  await exportWithChrome();

  const exported = await stat(pendingOutput);
  if (exported.size === 0) {
    throw new Error("Chrome produced an empty figure PDF.");
  }
  // Preserve the last exported artifact unless a replacement was produced.
  await rename(pendingOutput, output);

  console.log(output);
} finally {
  if (startedServer && server && server.exitCode === null) {
    server.kill("SIGTERM");
  }
  await rm(profile, { recursive: true, force: true });
}

async function exportWithChrome() {
  const browser = spawn(
    chrome,
    [
      "--headless",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
      "--no-proxy-server",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  browser.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });

  let cdp;
  try {
    const port = await waitForBrowser(browser, () => stderr);
    const targets = await getLocalJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page?.webSocketDebuggerUrl) throw new Error("Chrome did not create a page target.");
    cdp = await connectToPage(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: figures[figure].width, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
    const navigation = await cdp.send("Page.navigate", { url: figureUrl });
    if (navigation.errorText) throw new Error(navigation.errorText);

    const selector = `[data-paper-figure="${figure}"]`;
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      ready = await evaluate(cdp, `document.readyState === "complete" && !!document.querySelector(${JSON.stringify(selector)})`);
      if (ready) break;
      await delay(250);
    }
    if (!ready) throw new Error("Timed out waiting for the figure page to finish loading.");

    // Measure after font loading in print media, not from a fixed paper height.
    const size = await evaluate(cdp, `(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const figure = document.querySelector(${JSON.stringify(selector)});
      const rect = figure.getBoundingClientRect();
      const width = Math.ceil(Math.max(rect.width, figure.scrollWidth));
      const height = Math.ceil(Math.max(rect.height, figure.scrollHeight)) + 2;
      if (!(width > 0 && height > 0)) throw new Error("Invalid figure dimensions.");
      const style = document.createElement("style");
      style.textContent = "@page { size: " + width + "px " + height + "px; margin: 0; }";
      document.head.appendChild(style);
      return { width, height };
    })()`);
    const pdf = await cdp.send("Page.printToPDF", {
      printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true,
      paperWidth: size.width / 96, paperHeight: size.height / 96,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale: 1,
    });
    await writeFile(pendingOutput, Buffer.from(pdf.data, "base64"));
    console.log(`Content-sized figure: ${size.width} x ${size.height} CSS px`);
  } finally {
    cdp?.close();
    await stopProcess(browser);
  }
}

async function waitForBrowser(browser, readStderr) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome has not opened its local debugging endpoint yet.
    }
    if (browser.exitCode !== null) {
      throw new Error(readStderr() || `Chrome exited with ${browser.exitCode}.`);
    }
    await delay(250);
  }
  throw new Error("Timed out starting Chrome for PDF export.");
}

async function connectToPage(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome.")), 10_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Cannot connect to Chrome.")); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Chrome disconnected during PDF export."));
    }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const callId = ++id;
        const timer = setTimeout(() => {
          pending.delete(callId);
          reject(new Error(`Chrome timed out: ${method}`));
        }, 30_000);
        pending.set(callId, { resolve: resolveCall, reject, timer });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

function getLocalJson(url) {
  return new Promise((resolveJson, reject) => {
    const request = httpGet(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolveJson(JSON.parse(body)); } catch (error) { reject(error); }
      });
      response.on("error", reject);
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Chrome endpoint timed out.")));
    request.on("error", reject);
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const candidate of candidates) {
    if (spawnSync("test", ["-x", candidate]).status === 0) return candidate;
  }

  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [command], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }

  return null;
}

async function responds(url) {
  const parsed = new URL(url);
  const request = parsed.protocol === "https:" ? httpsGet : httpGet;

  return new Promise((resolveResponse) => {
    const call = request(parsed, (response) => {
      response.resume();
      resolveResponse(
        response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 400,
      );
    });
    call.setTimeout(2_000, () => call.destroy());
    call.on("error", () => resolveResponse(false));
  });
}

async function waitForPage(url, child) {
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await responds(url)) return;
    if (child.exitCode !== null) {
      throw new Error(stderr || `Demo server exited with ${child.exitCode}.`);
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}.\n${stderr}`);
}
