const {connect}=require('./lib.js');
const DESC=process.argv[2]||'';
const SUB=process.argv[3]||'';
(async()=>{
  const {ws,send,ev}=await connect();
  const r=await ev(`(function(){
    var res={};
    var eds=[], inputs=[];
    (function walk(root){
      root.querySelectorAll('*').forEach(function(e){
        if(e.shadowRoot){ walk(e.shadowRoot); }
        if(e.getAttribute && (e.getAttribute('contenteditable')==='true'||e.isContentEditable)) eds.push(e);
        if(e.tagName==='INPUT'||e.tagName==='TEXTAREA') inputs.push(e);
      });
    })(document);
    // 描述：优先 contenteditable，其次带“描述”placeholder 的输入
    var desc = eds.find(function(e){var t=e.getAttribute('data-placeholder')||e.getAttribute('placeholder')||'';return /描述/.test(t);}) || eds[0];
    if(desc){
      desc.focus();
      var sel=window.getSelection(), r=document.createRange();
      r.selectNodeContents(desc); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertText', false, ${JSON.stringify(DESC)});
      res.desc=(desc.innerText||'').slice(0,40);
    } else res.desc='无描述框';
    // 短标题
    var sub=inputs.find(function(e){var t=e.placeholder||'';return /短标题|标题/.test(t);});
    if(sub){
      var proto=sub.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(sub, ${JSON.stringify(SUB)});
      sub.dispatchEvent(new Event('input',{bubbles:true}));
      sub.dispatchEvent(new Event('change',{bubbles:true}));
      res.sub=sub.value;
    } else res.sub='无短标题框';
    return JSON.stringify(res);
  })()`);
  console.log(r);
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
