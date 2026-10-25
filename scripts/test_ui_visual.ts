import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testUserScroll() {
  const cdpPort = 9228;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-scroll-verify-"));
  const chromeProc: ChildProcess = spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
    ],
    { stdio: "ignore" }
  );

  const cleanup = () => {
    try { chromeProc.kill(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  };
  process.on("exit", cleanup);

  try {
    let versionData: any = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (res.ok) { versionData = await res.json(); break; }
      } catch {}
      await sleep(200);
    }

    const pagesRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const pages = await pagesRes.json();
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl);

    let msgId = 1;
    const pendingPromises = new Map<number, (res: any) => void>();

    function sendCmd(method: string, params: any = {}): Promise<any> {
      return new Promise((resolve) => {
        const id = msgId++;
        pendingPromises.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onmessage = (event: any) => {
      const data = JSON.parse(event.data);
      if (data.id && pendingPromises.has(data.id)) {
        const resolve = pendingPromises.get(data.id)!;
        pendingPromises.delete(data.id);
        resolve(data.result);
      }
    };

    await new Promise(resolve => (ws.onopen = resolve));
    await sendCmd("Page.enable");
    await sendCmd("Runtime.enable");

    await sendCmd("Page.navigate", { url: "http://127.0.0.1:9119/" });
    await sleep(2000);

    // 1. Verify header has NO model picker
    const headerCheck = await sendCmd("Runtime.evaluate", {
      expression: `(() => {
        const header = document.querySelector('.polaris-main > div:first-child');
        const trigger = document.querySelector('[data-testid="bot-settings-trigger"]');
        const text = header?.innerText || '';
        return {
          headerFound: !!header,
          headerText: text,
          hasModelInHeader: text.includes('DeepSeek') || text.includes('Claude') || text.includes('GPT') || text.includes('ctx'),
          triggerText: trigger?.innerText || null,
        };
      })()`,
      returnByValue: true,
    });
    console.log("[Header Clean Check]:", headerCheck.result?.value);

    // 2. Test scrolling inside transcript
    const scrollActions = await sendCmd("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('[data-testid="transcript"]');
        if (!el) return { error: 'No transcript' };

        // Initial position
        const initialTop = el.scrollTop;
        const maxScroll = el.scrollHeight - el.clientHeight;

        // Scroll to top
        el.scrollTop = 0;
        const afterScrollToTop = el.scrollTop;

        // Scroll to bottom
        el.scrollTop = maxScroll;
        const afterScrollToBottom = el.scrollTop;

        return {
          initialTop,
          maxScroll,
          afterScrollToTop,
          afterScrollToBottom,
          canScrollUpDown: maxScroll > 0 && afterScrollToBottom > 0 && afterScrollToTop === 0,
        };
      })()`,
      returnByValue: true,
    });
    console.log("[Scroll Action Verification]:", scrollActions.result?.value);

    ws.close();
  } finally {
    cleanup();
  }
}

testUserScroll();
