#!/usr/bin/env node
/**
 * B站投稿自动化（2026-10-30 实测跑通）
 * 特点：封面要 4:3 + 16:9 两张；创作声明必填；投稿按钮在首屏之外
 * 用法: node publish-bili.js --video a.mp4 --cover43 b.jpg --cover169 c.jpg --title ".." --desc ".." [--publish]
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
const TAGS = (opt.tags || 'OPC,企业AI,FDE,创业,人工智能,AI落地').split(',');

async function click(send, x, y) {
  for (const t of ['mouseMoved','mousePressed','mouseReleased'])
    await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 });
}
async function findPos(ev, re, exact) {
  return ev(`(function(){
    var o='';
    document.querySelectorAll('div,span,button,a,input').forEach(function(e){
      var t=(e.textContent||'').trim(); var b=e.getBoundingClientRect();
      if(b.width>0 && b.height>0 && ${exact?`t===${JSON.stringify(re)}`:`${re}.test(t)`}) o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);
    });
    return o||'无';
  })()`);
}

(async () => {
  execFileSync(process.execPath,[require('path').join(__dirname,'preflight.js'),
    '--platform','bili','--video',opt.video,'--title',opt.title],{stdio:'inherit'});
  const { ws, send, ev } = await connect();
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'https://member.bilibili.com/platform/upload/video/frame' });
  await sleep(9000);

  console.log('① 上传视频');
  let doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  let q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { files: [opt.video], nodeId: q.result.nodeIds[0] });
  await waitUpload(ev, 'bili');

  console.log('② 标题 + 简介');
  console.log('  ', await ev(`(function(){
    var ti=[...document.querySelectorAll('input')].filter(e=>e.offsetParent).find(e=>/稿件标题/.test(e.placeholder||''));
    if(ti){ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(ti, ${JSON.stringify(opt.title)});
      ti.dispatchEvent(new Event('input',{bubbles:true})); }
    var de=[...document.querySelectorAll('[contenteditable=true]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height>80)[0];
    if(de){ de.focus(); var s=getSelection(),rr=document.createRange(); rr.selectNodeContents(de); s.removeAllRanges(); s.addRange(rr);
      document.execCommand('insertText', false, ${JSON.stringify(opt.desc||'')}); }
    var out={title:ti?ti.value:null, desc:de?(de.innerText||'').length:0};
    return JSON.stringify(out);
  })()`));
  need(await ev(`(function(){var ti=[...document.querySelectorAll('input')].filter(e=>e.offsetParent).find(e=>/稿件标题/.test(e.placeholder||''));return ti&&ti.value===${JSON.stringify(opt.title)};})()`),'B站标题写入不一致');

  console.log('③ 标签');
  for (const t of TAGS) {
    await ev(`(function(){
      var el=[...document.querySelectorAll('input')].filter(e=>e.offsetParent).find(e=>/标签/.test(e.placeholder||''));
      if(!el) return 'no';
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(t)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,bubbles:true}));
      return 'ok';
    })()`);
    await sleep(600);
  }
  console.log('   标签数:', await ev(`document.querySelectorAll('[class*=tag] [class*=close], .tag-item').length`));

  console.log('④ 封面（4:3 + 16:9）');
  await ev(`(function(){var e=[...document.querySelectorAll('div,span,button')].filter(x=>x.offsetParent&&x.textContent.trim()==='添加封面');if(e.length)e[e.length-1].click();return 1;})()`);
  await sleep(3000);
  doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { files: [opt.cover43], nodeId: q.result.nodeIds[1] });
  await sleep(5000);
  doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  if ((q.result.nodeIds||[]).length >= 2) { await send('DOM.setFileInputFiles', { files: [opt.cover169], nodeId: q.result.nodeIds[1] }); await sleep(4000); }
  let done = await findPos(ev, '完成', true);
  if (done !== '无') { const [x,y] = done.split(',').map(Number); await click(send, x, y); await sleep(2500); }
  console.log('   封面已设');

  console.log('⑤ 创作声明');
  await ev(`(function(){var el=[...document.querySelectorAll('input')].filter(e=>/创作声明/.test(e.placeholder||''))[0];if(el)el.scrollIntoView({block:'center'});return 1;})()`);
  await sleep(1200);
  const declPos = await ev(`(function(){var el=[...document.querySelectorAll('input')].filter(e=>/创作声明/.test(e.placeholder||''))[0];if(!el)return '无';var b=el.getBoundingClientRect();return Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);})()`);
  if (declPos !== '无') {
    const [x,y] = declPos.split(',').map(Number); await click(send, x, y); await sleep(1800);
    const optPos = await ev(`(function(){var o='';document.querySelectorAll('*').forEach(function(e){if(e.children.length)return;var t=e.textContent.trim();var b=e.getBoundingClientRect();if(b.width>0&&b.height<70&&t===${JSON.stringify(opt.declare||'个人观点，仅供参考')})o=Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2);});return o||'无';})()`);
    if (optPos !== '无') { const [dx,dy] = optPos.split(',').map(Number); await click(send, dx, dy); await sleep(1500); }
  }
  console.log('   已选:', await ev(`(function(){var el=[...document.querySelectorAll('input')].filter(e=>/创作声明/.test(e.placeholder||''))[0];return el?el.value:'无';})()`));

  if (opt.publish) {
    console.log('⑥ 立即投稿');
    const p = await findPos(ev, '立即投稿', true);
    need(p !== '无', '找不到B站立即投稿按钮');
    if (p !== '无') {
      const [x,y] = p.split(',').map(Number);
      await click(send, x, y);
      await sleep(12000);
      console.log('   结果:', await ev(`(function(){var o=[];document.querySelectorAll('*').forEach(function(e){if(e.children.length===0&&e.innerText&&/成功|审核/.test(e.innerText)&&e.innerText.length<40)o.push(e.innerText.trim());});return [...new Set(o)].join(' | ')||'无';})()`));
      await verifyPublished(send, ev, 'bili', opt.title);
    }
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
