#!/usr/bin/env node
/**
 * 把本地视频注入页面的 <input type=file>（可穿透 Shadow DOM）
 * 用法: node inject-file.js <页面里的文件名> <本地文件路径>
 */
const { connect } = require('./lib.js');
const fs = require('fs');

const NAME = process.argv[2];
const FILE = process.argv[3];
const CHUNK = 3 * 1024 * 1024;

(async () => {
  const buf = fs.readFileSync(FILE);
  const b64 = buf.toString('base64');
  console.log('文件大小', (buf.length / 1048576).toFixed(1), 'MB → base64', (b64.length / 1048576).toFixed(1), 'MB');

  const { ws, send, ev } = await connect();
  await send('Runtime.enable');

  await ev("window.__b64 = ''; 'init'");
  const total = Math.ceil(b64.length / CHUNK);
  for (let i = 0; i < total; i++) {
    const part = b64.slice(i * CHUNK, (i + 1) * CHUNK);
    await ev(`window.__b64 += ${JSON.stringify(part)}; window.__b64.length`);
    if (i % 3 === 0) console.log('  注入', i + 1, '/', total);
  }
  console.log('base64 注入完成');

  const res = await ev(`(function(){
    try {
      var b = atob(window.__b64);
      var arr = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
      var file = new File([arr], ${JSON.stringify(NAME)}, {type:'video/mp4'});
      var input = null;
      (function walk(root){
        root.querySelectorAll('*').forEach(function(e){
          if(!input && e.tagName==='INPUT' && e.type==='file') input = e;
          if(e.shadowRoot) walk(e.shadowRoot);
        });
      })(document);
      if(!input) return 'no-input';
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      window.__b64 = '';
      return 'ok size=' + input.files.length + ' name=' + (input.files[0]||{}).name + ' bytes=' + (input.files[0]||{}).size;
    } catch(e) { return 'ERR ' + e.message; }
  })()`);
  console.log('注入结果:', res);

  await new Promise(r => setTimeout(r, 12000));
  console.log('页面状态:', await ev(`(function(){
    var s='';
    (function walk(r){
      r.querySelectorAll('*').forEach(function(e){
        if(e.shadowRoot){ walk(e.shadowRoot); return; }
        if(e.children.length===0 && e.innerText && e.innerText.length<40) s += e.innerText.trim()+' | ';
      });
    })(document);
    return s.slice(0,220);
  })()`));
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
