#!/usr/bin/env node
/**
 * 小红书自动发布
 * 特点：标题≤20字；发布按钮是自定义元素 <xhs-publish-btn>，只能按坐标点；封面不支持本地上传
 * 用法: node publish-xhs.js --video <mp4> --title "≤20字" --desc "..." [--publish]
 */
const { connect } = require('./lib.js');
const { need, waitUpload, verifyPublished } = require('./publish-guard.js');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true; opt[k] = v; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  execFileSync(process.execPath,[require('path').join(__dirname,'preflight.js'),
    '--platform','xhs','--video',opt.video,'--title',opt.title],{stdio:'inherit'});
  const { ws, send, ev } = await connect();
  await send('Page.bringToFront');
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await send('Page.navigate', { url: 'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video' });
  await sleep(9000);

  console.log('① 设置视频文件');
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  const ids = q.result.nodeIds || [];
  if (!ids.length) { console.error('找不到文件框'); ws.close(); process.exit(3); }
  await send('DOM.setFileInputFiles', { files: [opt.video], nodeId: ids[0] });
  await waitUpload(ev, 'xhs');

  console.log('② 填标题 + 正文');
  const r = await ev(`(function(){
    var t=[...document.querySelectorAll('input,textarea')].filter(e=>e.offsetParent).find(e=>/标题/.test(e.placeholder||'')) ||
          [...document.querySelectorAll('input')].filter(e=>e.offsetParent)[0];
    var res={};
    if(t){ var p=t.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(p,'value').set.call(t, ${JSON.stringify(opt.title||'')});
      t.dispatchEvent(new Event('input',{bubbles:true}));
      t.dispatchEvent(new Event('change',{bubbles:true})); res.title=t.value; }
    var d=document.querySelector('div[contenteditable="true"]');
    if(d){ d.focus(); var s=getSelection(), rr=document.createRange();
      rr.selectNodeContents(d); s.removeAllRanges(); s.addRange(rr);
      document.execCommand('insertText', false, ${JSON.stringify(opt.desc||'')});
      res.desc=(d.innerText||'').length; }
    return JSON.stringify(res);
  })()`);
  console.log('  ', r);
  const filled=JSON.parse(r);
  need(filled.title===opt.title,'标题写入不一致');
  need(filled.desc>0,'正文写入失败');
  await sleep(1500);

  const check = await ev(`(document.body.innerText.match(/(\\d+)\\s*\\/\\s*20/g)||['']).slice(0,2).join(',')`);
  console.log('③ 标题字数:', check || '(无限制提示)');

  if (opt.publish) {
    const geo = await ev(`(function(){
      var vw=innerWidth,vh=innerHeight;
      var x=Math.round(vw*0.54), y=Math.round(vh*0.943);
      var e=document.elementFromPoint(x,y);
      return JSON.stringify({x,y,tag:e?e.tagName:'-'});
    })()`);
    console.log('④ 发布按钮位置:', geo);
    const { x, y } = JSON.parse(geo);
    for (const type of ['mouseMoved','mousePressed','mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(9000);
    await verifyPublished(send, ev, 'xhs', opt.title);
  } else {
    console.log('④ 未发布（加 --publish）');
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
