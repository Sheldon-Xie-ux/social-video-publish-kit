const fs = require('fs');
const path = require('path');

class GateError extends Error {}
function need(ok, msg) { if (!ok) throw new GateError(msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(ev, expression, opt = {}) {
  const label = opt.label || '条件';
  const timeoutMs = opt.timeoutMs || 25 * 60 * 1000;
  const intervalMs = opt.intervalMs || 5000;
  const start = Date.now();
  let last = false;
  while (Date.now() - start < timeoutMs) {
    last = await ev(expression);
    if (last) return last;
    if ((Date.now() - start) % 30000 < intervalMs)
      console.log(`  等待${label}… ${Math.round((Date.now()-start)/1000)}s`);
    await sleep(intervalMs);
  }
  throw new GateError(`等待超时：${label}（${Math.round(timeoutMs/60000)} 分钟）`);
}

async function waitUpload(ev, platform) {
  const map = {
    douyin: [/上传完成/, '抖音视频上传完成'],
    xhs: [/检测为高清|上传完成/, '小红书视频上传完成'],
    bili: [/上传完成/, 'B站视频上传完成'],
  };
  if (platform === 'channels') {
    return waitFor(ev, `(function(){var ok=false;function w(r){r.querySelectorAll('*').forEach(function(e){if(!ok&&(e.innerText||'').trim()==='删除')ok=true;if(e.shadowRoot)w(e.shadowRoot);});}w(document);return ok;})()`,
      { label: '视频号视频进入编辑器', timeoutMs: 8 * 60 * 1000, intervalMs: 4000 });
  }
  const [re, label] = map[platform] || [];
  need(re, `未知平台上传信号：${platform}`);
  return waitFor(ev, `${re}.test(document.body.innerText)`, { label, timeoutMs: 25 * 60 * 1000 });
}

function evidencePath(platform) {
  const dir = path.join(__dirname, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${new Date().toISOString().replace(/[:.]/g,'-')}-${platform}.png`);
}

async function screenshot(send, file) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
}

async function verifyPublished(send, ev, platform, title) {
  const listUrls = {
    douyin: 'https://creator.douyin.com/creator-micro/content/manage',
    xhs: 'https://creator.xiaohongshu.com/new/note-manager',
    channels: 'https://channels.weixin.qq.com/platform/post/list',
    bili: 'https://member.bilibili.com/platform/upload-manager/article',
  };
  const url = listUrls[platform];
  need(url, `未知平台回查地址：${platform}`);
  await send('Page.navigate', { url });
  await sleep(11000);
  await send('Page.reload', {});
  await sleep(9000);
  const probe = title.replace(/[，。？！｜|：:].*$/, '').trim().slice(0, 8);
  const found = await ev(`document.body.innerText.includes(${JSON.stringify(probe)})`);
  need(found, `发布后列表未找到作品：${probe}`);
  const file = await screenshot(send, evidencePath(platform));
  console.log(`  列表回查通过：${probe}`);
  console.log(`  证据截图：${file}`);
  return file;
}

module.exports = { GateError, need, sleep, waitFor, waitUpload, verifyPublished, screenshot };
