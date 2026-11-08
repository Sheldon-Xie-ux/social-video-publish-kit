const {connect}=require('./lib.js');
const fs=require('fs');
const NAME=process.argv[2], FILE=process.argv[3];
(async()=>{
  const buf=fs.readFileSync(FILE);
  const b64=buf.toString('base64');
  const {ws,send,ev}=await connect();
  await ev("window.__img=''; 'ok'");
  for(let i=0;i<b64.length;i+=2*1024*1024){
    await ev(`window.__img += ${JSON.stringify(b64.slice(i,i+2*1024*1024))}; 1`);
  }
  const r=await ev(`(function(){
    try{
      var b=atob(window.__img), a=new Uint8Array(b.length);
      for(var i=0;i<b.length;i++) a[i]=b.charCodeAt(i);
      var f=new File([a], ${JSON.stringify(NAME)}, {type:'image/jpeg'});
      var input=null;
      (function walk(root){root.querySelectorAll('*').forEach(function(e){
        if(!input && e.tagName==='INPUT' && e.type==='file' && /image/.test(e.accept||'')) input=e;
        if(e.shadowRoot) walk(e.shadowRoot);
      });})(document);
      if(!input) return 'no-image-input';
      var dt=new DataTransfer(); dt.items.add(f);
      input.files=dt.files;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      window.__img='';
      return 'ok '+input.files[0].name+' '+input.files[0].size;
    }catch(e){return 'ERR '+e.message;}
  })()`);
  console.log('封面注入:', r);
  await new Promise(r=>setTimeout(r,6000));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
