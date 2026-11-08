#!/usr/bin/env node
/**
 * 视频号自动发布 v2 —— 每一步都校验，不校验不上一步
 * 背景：WUJIE 微前端会在导航/挂载时清空已注入的文件，v1 曾因此丢视频和封面。
 * 用法: node publish-channels.js --video a.mp4 --cover b.jpg --desc ".." --short "≤16字" --publish
 */
const { connect } = require('./lib.js');
const { need, waitUpload, verifyPublished } = require('./publish-guard.js');
const { execFileSync } = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true; opt[k] = v; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WALK = `function w(r,f){r.querySelectorAll('*').forEach(function(e){f(e);if(e.shadowRoot)w(e.shadowRoot,f);});}`;

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

async function injectFile(send, ev, filePath, isImage) {
  const buf = fs.readFileSync(filePath);
  const name = filePath.split('/').pop();
  const mime = isImage ? 'image/jpeg' : 'video/mp4';
  const CH = 8 * 1024 * 1024;
  const total = Math.ceil(buf.length / CH);
  await ev("window.__chunks=[];1");
  for (let i=0; i<total; i++) {
    const b64 = buf.subarray(i*CH,(i+1)*CH).toString('base64');
    await ev(`(function(){var b=atob(${JSON.stringify(b64)}),a=new Uint8Array(b.length);
      for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);window.__chunks.push(a);return window.__chunks.length;})()`);
  }
  return ev(`(function(){try{
    var f=new File(window.__chunks,${JSON.stringify(name)},{type:${JSON.stringify(mime)}});
    var input=null; ${WALK}
    w(document,function(e){
      if(!input && e.tagName==='INPUT' && e.type==='file' && ${isImage ? "/image/.test(e.accept||'')" : "!/image/.test(e.accept||'')"}) input=e;
    });
    if(!input) return 'no-input';
    var dt=new DataTransfer(); dt.items.add(f);
    input.files=dt.files;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    window.__chunks=[];
    return 'ok '+input.files[0].size;
  }catch(e){return 'ERR '+e.message;}})()`);
}

async function videoReady(ev) {
  // 上传区的“删除”按钮出现 = 视频已在编辑器里
  return ev(`(function(){var ok=false;${WALK}w(document,function(e){if(!ok&&(e.innerText||'').trim()==='删除')ok=true;});return ok;})()`);
}

(async () => {
  execFileSync(process.execPath,[require('path').join(__dirname,'preflight.js'),
    '--platform','channels','--video',opt.video,'--title',opt.short||opt.title||'视频号视频','--short',opt.short||''],{stdio:'inherit'});
  const { ws, send, ev } = await connect();
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: 'https://channels.weixin.qq.com/platform/post/create' });
  console.log('① 打开发表页…'); await sleep(14000);

  console.log('② 注入视频');
  const r1 = await injectFile(send, ev, opt.video, false);
  console.log('   ', r1);
  if (!String(r1).startsWith('ok')) die('视频注入失败');
  await waitUpload(ev, 'channels');

  console.log('③ 填描述 + 短标题');
  console.log('   ', await ev(`(function(){
    var eds=[],ins=[]; ${WALK}
    w(document,function(e){ if(e.isContentEditable)eds.push(e); if(e.tagName==='INPUT')ins.push(e); });
    var res={};
    var d=eds.find(function(e){return /描述/.test(e.getAttribute('data-placeholder')||'');})||eds[0];
    if(d){ d.focus(); var s=getSelection(),rr=document.createRange(); rr.selectNodeContents(d); s.removeAllRanges(); s.addRange(rr);
      document.execCommand('insertText', false, ${JSON.stringify(opt.desc||'')}); res.desc=(d.innerText||'').length; }
    var t=ins.find(function(e){return /短标题/.test(e.placeholder||'');});
    if(t){ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t, ${JSON.stringify(opt.short||'')});
      t.dispatchEvent(new Event('input',{bubbles:true})); res.short=t.value; }
    return JSON.stringify(res);
  })()`));

  if (opt.cover) {
    console.log('④ 上传封面');
    const edit = await ev(`(function(){var o='';${WALK}w(document,function(e){var t=(e.innerText||'').trim();var b=e.getBoundingClientRect();if(t==='编辑'&&b.width>0)o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);});return o||'无';})()`);
    if (edit === '无') die('找不到封面“编辑”按钮');
    let [x,y] = edit.split(',').map(Number);
    for (const t of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type:t,x,y,button:'left',clickCount:1});
    await sleep(3000);
    const up = await ev(`(function(){var o='';${WALK}w(document,function(e){var t=(e.innerText||'').trim();var b=e.getBoundingClientRect();if(t==='上传封面'&&b.width>0)o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);});return o||'无';})()`);
    if (up === '无') die('找不到“上传封面”');
    [x,y] = up.split(',').map(Number);
    for (const t of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type:t,x,y,button:'left',clickCount:1});
    await sleep(3000);
    const r2 = await injectFile(send, ev, opt.cover, true);
    console.log('   ', r2);
    if (!String(r2).startsWith('ok')) die('封面注入失败');
    await sleep(5000);
    const cfm = await ev(`(function(){var o='';${WALK}w(document,function(e){var t=(e.innerText||'').trim();var b=e.getBoundingClientRect();if(t==='确认'&&b.width>0)o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);});return o||'无';})()`);
    if (cfm === '无') die('找不到封面“确认”');
    [x,y] = cfm.split(',').map(Number);
    for (const t of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type:t,x,y,button:'left',clickCount:1});
    await sleep(3500);
    // 校验：封面预览区不应再显示“选择封面”占位
    const hasCover = await ev(`(function(){var t=document.body.innerText;return !/上传封面\\s*\\n?\\s*拖拽/.test(t);})()`);
    console.log('   封面已设置:', hasCover);
    if (!hasCover) die('封面未生效，终止');
  }

  const warn = await ev(`(function(){var t=document.body.innerText;return JSON.stringify({超16字:/超过16字/.test(t), 无视频:!/删除/.test(t)});})()`);
  console.log('⑤ 发布前检查:', warn);
  const w=JSON.parse(warn); need(!w.超16字 && !w.无视频,'视频号发布前检查未通过');

  if (opt.publish) {
    const btn = await ev(`(function(){var o='';${WALK}w(document,function(e){var t=(e.innerText||'').trim();var b=e.getBoundingClientRect();if(t==='发表'&&b.width>0&&b.bottom<innerHeight+5)o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);});return o||'无';})()`);
    if (btn === '无') die('找不到“发表”按钮');
    const [bx,by] = btn.split(',').map(Number);
    for (const t of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type:t,x:bx,y:by,button:'left',clickCount:1});
    await sleep(12000);
    const url = await ev('location.href');
    console.log('⑥ 结果:', url);
    if (!/post\/list/.test(url)) die('没有跳转到列表页，发布可能失败');
    await verifyPublished(send, ev, 'channels', opt.desc||opt.short||'');
    console.log('✓ 发布成功并完成列表回查');
  } else {
    console.log('⑤ 未发表（加 --publish）');
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
