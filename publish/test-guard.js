const { need, waitFor, verifyPublished } = require('./publish-guard.js');
(async()=>{
  let threw=false; try{need(false,'x')}catch(e){threw=true}
  if(!threw) throw new Error('need 未拦截');
  let n=0;
  await waitFor(async()=>++n>=2,'模拟上传',{intervalMs:5,timeoutMs:1000});
  threw=false;
  try{await waitFor(async()=>false,'模拟超时',{intervalMs:5,timeoutMs:30})}catch(e){threw=true}
  if(!threw) throw new Error('超时未拦截');
  const sent=[];
  const send=async(method,params)=>{
    sent.push(method);
    if(method==='Page.captureScreenshot') return {result:{data:Buffer.from('fake').toString('base64')}};
    return {};
  };
  const ev=async()=>true;
  const file=await verifyPublished(send,ev,'douyin','老板的决策，AI 来做');
  if(!require('fs').existsSync(file)) throw new Error('未写证据');
  console.log('GUARD PASS: 断言拦截 / 条件等待 / 超时阻断 / 发布回查截图');
})().catch(e=>{console.error(e);process.exit(1)});
