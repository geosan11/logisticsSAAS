import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = '/workspace/logisticsSAAS_research/print-buttons-shots';
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

let serverProcess = null;
let serverReady = false;
try {
  const res = await fetch('http://127.0.0.1:3456/');
  if (res.ok) serverReady = true;
} catch {}

if (!serverReady) {
  console.log('Starting production server on port 3456...');
  serverProcess = spawn('node', ['dist/server.cjs'], {
    cwd: '/workspace/logisticsSAAS-main',
    env: { ...process.env, PORT: '3456', NODE_ENV: 'production' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:3456/');
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {}
    await sleep(500);
  }
}

if (!serverReady) {
  console.error('Failed to start server');
  process.exit(1);
}
console.log('Server ready on http://127.0.0.1:3456 !');

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'print-buttons-chrome-'));
const ch = spawn('google-chrome', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  `--user-data-dir=${prof}`,
  '--remote-debugging-port=0',
  'about:blank'
], { stdio: 'ignore' });

let port;
for (let i = 0; i < 50 && !port; i++) {
  try {
    port = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  } catch {
    await sleep(100);
  }
}

const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0;
const pend = {};
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) {
    pend[m.id](m);
    delete pend[m.id];
  }
};

const send = (method, params = {}) => new Promise(r => {
  const i = ++id;
  pend[i] = r;
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function capture(filename, width, height) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, Buffer.from(shot.result.data, 'base64'));
  const size = fs.statSync(filePath).size;
  console.log(`Saved screenshot: ${filename} (${size} bytes)`);
}

async function evalInPage(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result?.result?.value;
}

try {
  console.log('Navigating to http://127.0.0.1:3456/ ...');
  await setViewport(1024, 768);
  await send('Page.navigate', { url: 'http://127.0.0.1:3456/' });
  await sleep(2500);

  // Set theme to dark
  await evalInPage(`
    localStorage.setItem('ehi-theme', 'dark');
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  `);

  console.log('Logging in as Super Admin...');
  await evalInPage(`
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Super Admin'));
    if (btn) btn.click();
  `);
  await sleep(2500);

  // Helper function to go to ledger
  async function openLedger() {
    await evalInPage(`(() => {
      window.history.pushState({}, '', '/more/ledger');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    await sleep(2000);
  }

  // 1. Capture Air Cargo detail at 1024x768
  console.log('--- Step 1: Air Cargo Detail (1024x768) ---');
  await openLedger();
  await evalInPage(`(() => {
    const trs = Array.from(document.querySelectorAll('tbody tr'));
    const cargoTr = trs.find(tr => tr.innerText.includes('Dangote') || tr.innerText.includes('HWY-LOS-CG'));
    if (cargoTr) {
      const td = cargoTr.querySelectorAll('td')[2] || cargoTr;
      td.click();
    }
  })()`);
  await sleep(1500);

  const cargoModal = await evalInPage(`(() => {
    const printHeading = Array.from(document.querySelectorAll('div, h4')).find(d => d.textContent && d.textContent.trim() === 'Printing & documents');
    if (printHeading) {
      const modalScrollable = printHeading.closest('.overflow-y-auto');
      if (modalScrollable) {
        modalScrollable.scrollTop = modalScrollable.scrollHeight;
      }
      const buttons = Array.from(printHeading.parentElement.querySelectorAll('button')).map(b => b.innerText.trim());
      const tagId = document.querySelector('h3')?.innerText;
      return { found: true, buttons, tagId };
    }
    return { found: false };
  })()`);
  console.log('Cargo modal info:', cargoModal);
  await sleep(800);
  console.log('Capturing: 01-air-cargo-detail-1024x768.png');
  await capture('01-air-cargo-detail-1024x768.png', 1024, 768);

  // 2. Fresh reload to ledger for Package Detail
  console.log('--- Step 2: Package Detail (1024x768) ---');
  await send('Page.navigate', { url: 'http://127.0.0.1:3456/more/ledger' });
  await sleep(2500);

  // Check if login needed or already in ledger
  await evalInPage(`
    localStorage.setItem('ehi-theme', 'dark');
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    const adminBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Super Admin'));
    if (adminBtn) adminBtn.click();
  `);
  await sleep(2000);

  // Ensure on ledger
  await evalInPage(`(() => {
    if (!window.location.pathname.includes('/more/ledger')) {
      window.history.pushState({}, '', '/more/ledger');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  })()`);
  await sleep(2000);

  // Click Chukwuma Electronics (Package) row
  const pkgClicked = await evalInPage(`(() => {
    const trs = Array.from(document.querySelectorAll('tbody tr'));
    const pkgTr = trs.find(tr => tr.innerText.includes('Chukwuma') || tr.innerText.includes('000512') || tr.innerText.includes('PKG'));
    if (pkgTr) {
      const td = pkgTr.querySelectorAll('td')[2] || pkgTr;
      td.click();
      return true;
    }
    return false;
  })()`);
  console.log('Package row clicked:', pkgClicked);
  await sleep(1500);

  const pkgModal = await evalInPage(`(() => {
    const printHeading = Array.from(document.querySelectorAll('div, h4')).find(d => d.textContent && d.textContent.trim() === 'Printing & documents');
    if (printHeading) {
      const modalScrollable = printHeading.closest('.overflow-y-auto');
      if (modalScrollable) {
        modalScrollable.scrollTop = modalScrollable.scrollHeight;
      }
      const buttons = Array.from(printHeading.parentElement.querySelectorAll('button')).map(b => b.innerText.trim());
      const tagId = document.querySelector('h3')?.innerText;
      return { found: true, buttons, tagId };
    }
    return { found: false };
  })()`);
  console.log('Package modal info:', pkgModal);
  await sleep(800);
  console.log('Capturing: 02-package-detail-1024x768.png');
  await capture('02-package-detail-1024x768.png', 1024, 768);

  // 3. Switch to mobile 390x844
  console.log('--- Step 3: Package Detail (390x844 Mobile) ---');
  await setViewport(390, 844);
  await sleep(800);

  // Scroll "Printing & documents" into view on mobile
  await evalInPage(`(() => {
    const printHeading = Array.from(document.querySelectorAll('div, h4')).find(d => d.textContent && d.textContent.trim() === 'Printing & documents');
    if (printHeading) {
      const modalScrollable = printHeading.closest('.overflow-y-auto');
      if (modalScrollable) {
        modalScrollable.scrollTop = modalScrollable.scrollHeight;
      }
    }
  })()`);
  await sleep(800);

  console.log('Capturing: 03-package-detail-390x844.png');
  await capture('03-package-detail-390x844.png', 390, 844);

} catch (err) {
  console.error('Capture error:', err);
} finally {
  ch.kill();
  if (serverProcess) serverProcess.kill();
  try {
    fs.rmSync(prof, { recursive: true, force: true });
  } catch {}
  console.log('Finished captures successfully.');
  process.exit(0);
}
