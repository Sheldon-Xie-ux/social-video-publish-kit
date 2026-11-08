#!/usr/bin/env node
/**
 * 多平台视频发布器（CDP 驱动）
 *
 * 用法：
 *   node publish.js --platform douyin --video <path> --cover <path> \
 *                   --title "标题" --desc "正文" [--dry]
 *
 * 只做「填到发布前」和「点发布」两档：不加 --publish 就只填表不点发布。
 */
const { connect } = require('./lib.js');
const { need, waitUpload, verifyPublished } = require('./publish-guard.js');
const fs = require('fs');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    opt[k] = v;
  }
}
const PLATFORM = opt.platform || 'douyin';
const DO_PUBLISH = !!opt.publish;
const DRY = !!opt.dry;

const PLATFORMS = {
  douyin: { upload: 'https://creator.douyin.com/creator-micro/content/upload', name: '抖音' },
  xhs: { upload: 'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video', name: '小红书' },
  channels: { upload: 'https://channels.weixin.qq.com/platform/post/create', name: '视频号' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickText(ev, texts, exact = true) {
  const arr = JSON.stringify(texts);
  return ev(`(function(){
    var want=${arr}, exact=${exact};
    var els=[...document.querySelectorAll('button,div,span,a')].filter(e=>{
      var t=(e.textContent||'').trim();
      return exact ? want.includes(t) : want.some(w=>t.includes(w));
    });
    if(!els.length) return 'none';
    var e=els[els.length-1];
    e.click(); return 'clicked:'+e.textContent.trim().slice(0,12);
  })()`);
}

async function setFileByIndex(send, index, filePath) {
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  const ids = q.result.nodeIds;
  if (!ids || ids.length <= index) return `无第 ${index} 个文件框（共 ${(ids || []).length}）`;
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId: ids[index] });
  return 'ok';
}

async function findVideoInputIndex(ev) {
  // 抖音 accept 带 video/*；小红书 accept 是后缀名列表，统一按后缀或 video 判定
  return ev(`(function(){
    var ins=[...document.querySelectorAll('input[type=file]')];
    var i=ins.findIndex(e=>/video|mp4|mov|mkv|flv/i.test(e.accept||''));
    if(i<0) i=ins.findIndex(e=>!/image/i.test(e.accept||''));
    return i;
  })()`);
}

async function fillTitle(ev, title) {
  return ev(`(function(){
    var el=document.querySelector('input.semi-input[placeholder*="作品标题"]') ||
           document.querySelector('input[placeholder*="标题"]') ||
           document.querySelector('input.semi-input');
    if(!el) return 'no-title';
    var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(el, ${JSON.stringify(title)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value.slice(0,40);
  })()`);
}

async function fillDesc(ev, desc) {
  return ev(`(function(){
    var el=document.querySelector('div.zone-container[contenteditable="true"]') ||
           document.querySelector('div[contenteditable="true"]');
    if(!el) return 'no-desc';
    el.focus();
    var sel=window.getSelection(), r=document.createRange();
    r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertText', false, ${JSON.stringify(desc)});
    return (el.innerText||'').slice(0,50);
  })()`);
}

async function setCover(send, ev, coverFile) {
  const opened = await clickText(ev, ['选择封面']);
  if (opened === 'none') return '无封面按钮';
  await sleep(2500);
  const idx = await ev(`(function(){
    var lab=[...document.querySelectorAll('div,span,p')].find(e=>e.textContent.trim()==='点击上传文件或拖拽文件到这里');
    if(!lab) return -1;
    var box=lab;
    for(var i=0;i<6&&box;i++){
      var inp=box.querySelector&&box.querySelector('input[type=file]');
      if(inp) return [...document.querySelectorAll('input[type=file]')].indexOf(inp);
      box=box.parentElement;
    }
    return -2;
  })()`);
  if (idx < 0) return '找不到封面上传框 ' + idx;
  need(await setFileByIndex(send, idx, coverFile) === 'ok', '竖封面上传失败');
  await sleep(4000);
  // 横封面
  await clickText(ev, ['设置横封面']);
  await sleep(2000);
  const idx2 = await ev(`(function(){
    var lab=[...document.querySelectorAll('div,span,p')].find(e=>e.textContent.trim()==='点击上传文件或拖拽文件到这里');
    if(!lab) return -1;
    var box=lab;
    for(var i=0;i<6&&box;i++){
      var inp=box.querySelector&&box.querySelector('input[type=file]');
      if(inp) return [...document.querySelectorAll('input[type=file]')].indexOf(inp);
      box=box.parentElement;
    }
    return -2;
  })()`);
  if (idx2 >= 0 && opt.coverH) {
    need(await setFileByIndex(send, idx2, opt.coverH) === 'ok', '横封面上传失败');
    await sleep(3500);
  }
  await clickText(ev, ['完成']);
  await sleep(2000);
  return '封面已设置';
}

(async () => {
  for (const k of ['video', 'title']) {
    if (!opt[k] && !DRY) { console.error('缺少 --' + k); process.exit(2); }
  }
  const P = PLATFORMS[PLATFORM];
  if (!P) { console.error('未知平台: ' + PLATFORM); process.exit(2); }

  if (!DRY) {
    const pf=[require('path').join(__dirname,'preflight.js'),'--platform',PLATFORM,'--video',opt.video,'--title',opt.title];
    execFileSync(process.execPath,pf,{stdio:'inherit'});
  }

  const { ws, send, ev } = await connect();

  if (!DRY) {
    await send('Page.navigate', { url: P.upload });
    await sleep(8000);
    console.log('[' + P.name + '] 已打开上传页:', await ev('location.href'));

    const vi = await findVideoInputIndex(ev);
    console.log('[' + P.name + '] 视频输入框 index =', vi);
    if (vi < 0) { console.error('找不到视频上传框'); ws.close(); process.exit(3); }
    console.log('[' + P.name + '] 设置文件:', await setFileByIndex(send, vi, opt.video));
    await waitUpload(ev, PLATFORM);
    console.log('[' + P.name + '] 当前页:', await ev('location.href'));
  }

  if (opt.title) {
    const actual = await fillTitle(ev, opt.title);
    need(actual === opt.title, '标题写入不一致');
    console.log('[' + P.name + '] 标题 →', actual);
  }
  if (opt.desc) {
    const actual = await fillDesc(ev, opt.desc);
    need(actual && actual.length > 0, '正文写入失败');
    console.log('[' + P.name + '] 正文 →', actual);
  }
  await sleep(1500);

  if (opt.cover && PLATFORM === 'douyin') {
    console.log('[' + P.name + '] 封面 →', await setCover(send, ev, opt.cover));
  }

  const state = await ev(`(function(){
    var t=document.body.innerText;
    return JSON.stringify({url:location.href, hasPublish:!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='发布'),
      chars:(t.match(/\\d+\\/30/)||[''])[0]});
  })()`);
  console.log('[' + P.name + '] 状态:', state);

  if (DO_PUBLISH) {
    const r = await clickText(ev, ['发布']);
    need(r !== 'none', '找不到发布按钮');
    console.log('[' + P.name + '] 点击发布:', r);
    await verifyPublished(send, ev, PLATFORM, opt.title);
  } else {
    console.log('[' + P.name + '] 未点发布（加 --publish 才发布）');
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
