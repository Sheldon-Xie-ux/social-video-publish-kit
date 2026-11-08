#!/usr/bin/env node
/** 发布前硬校验。任一失败退出非零；通过则写 manifest 与首帧裁切证据。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2), opt = {};
for (let i=0;i<args.length;i++) if(args[i].startsWith('--')) {
  const k=args[i].slice(2), v=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true; opt[k]=v;
}
const fail = [];
const need = (ok,msg) => { if(!ok) fail.push(msg); };
const exists = p => p && fs.existsSync(p) && fs.statSync(p).size>0;
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run = (cmd,args) => execFileSync(cmd,args,{encoding:'utf8'});
const probe = p => JSON.parse(run('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height:format=duration','-of','json',p]));
const outDir = path.join(__dirname,'evidence'); fs.mkdirSync(outDir,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');

['platform','video','title'].forEach(k=>need(opt[k],`缺少 --${k}`));
need(exists(opt.video),'视频不存在或为空');
const limits={douyin:30,xhs:20,bili:80};
if(limits[opt.platform]) need([...String(opt.title)].length<=limits[opt.platform],`标题超过 ${limits[opt.platform]} 字`);
if(opt.platform==='channels') need([...String(opt.short||'')].length<=16,'视频号短标题超过 16 字');

let meta={};
if(exists(opt.video)) {
  meta=probe(opt.video);
  const v=(meta.streams||[]).find(s=>s.codec_type==='video');
  need(v,'没有视频流'); need((meta.streams||[]).some(s=>s.codec_type==='audio'),'没有音频流');
  need(Number(meta.format.duration)>0,'时长无效');
}
['cover','coverH','cover43','cover169','firstFrameCover'].forEach(k=>{ if(opt[k]) need(exists(opt[k]),`${k} 文件不存在或为空`); });

if(opt.firstFrameCover && exists(opt.firstFrameCover) && exists(opt.video)) {
  const a=path.join(outDir,`${stamp}-first.png`), b=path.join(outDir,`${stamp}-cover.png`);
  run('ffmpeg',['-v','error','-y','-ss','0.2','-i',opt.video,'-frames:v','1','-vf','scale=64:114,format=rgb24','-f','rawvideo',a]);
  run('ffmpeg',['-v','error','-y','-i',opt.firstFrameCover,'-frames:v','1','-vf','scale=64:114,format=rgb24','-f','rawvideo',b]);
  const ba=fs.readFileSync(a),bb=fs.readFileSync(b);
  need(ba.length===bb.length && ba.length>0,'首帧/封面尺寸比较失败');
  if(ba.length===bb.length){let diff=0;for(let i=0;i<ba.length;i++)diff+=Math.abs(ba[i]-bb[i]);
    const mean=diff/ba.length; need(mean<22,`首帧与封面差异过大（${mean.toFixed(1)}）`); meta.firstFrameMeanDiff=Number(mean.toFixed(2));
  }
  const sim=path.join(outDir,`${stamp}-crop-3x4.jpg`);
  run('ffmpeg',['-v','error','-y','-i',opt.firstFrameCover,'-vf','crop=iw:iw*4/3:0:(ih-iw*4/3)/2,scale=540:720','-frames:v','1',sim]);
  meta.cropEvidence=sim;
}
if(opt.titleTop!==undefined || opt.titleBottom!==undefined){
  const top=Number(opt.titleTop),bot=Number(opt.titleBottom);
  need(top>=0.125 && bot<=0.875 && bot>top,'标题区超出中心裁切安全区（12.5%–87.5%）');
  meta.titleSafe={top,bottom:bot};
}
const manifest={time:new Date().toISOString(),platform:opt.platform,title:opt.title,
  video:opt.video?path.resolve(opt.video):null, videoSha256:exists(opt.video)?hash(opt.video):null,
  firstFrameCover:opt.firstFrameCover?path.resolve(opt.firstFrameCover):null, ...meta, passed:fail.length===0, failures:fail};
const mf=path.join(outDir,`${stamp}-${opt.platform||'unknown'}-manifest.json`);
fs.writeFileSync(mf,JSON.stringify(manifest,null,2));
if(fail.length){console.error('PREFLIGHT FAIL\n- '+fail.join('\n- '));console.error(mf);process.exit(1);}
console.log(`PREFLIGHT PASS | ${opt.platform} | ${Number(meta.format.duration).toFixed(1)}s | ${manifest.videoSha256.slice(0,12)}`);
console.log(mf);
