const http=require('http'); const WebSocket=require('ws');
const get=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
async function connect(){
  const list=JSON.parse(await get('/json/list'));
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl,{perMessageDeflate:false, maxPayload: 200*1024*1024});
  let id=0; const pend={};
  ws.on('message',m=>{const o=JSON.parse(m); if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id];}});
  await new Promise(r=>ws.on('open',r));
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:(r.result||{}).value;};
  return {ws,send,ev};
}
module.exports={connect};
