const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const {test}=require('node:test');
const {resolve}=require('node:path');
const origin='https://test.example';
const source=fs.readFileSync(resolve(__dirname,'../public/route.js'),'utf8');
function browser(start, oldState=null){
 const listeners={}, location=new URL(start,origin);
 const window={addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),dispatchEvent:event=>listeners[event.type]?.forEach(fn=>fn(event))};
 window.top=window;
 const change=(state,_unused,url)=>{history.state=state;location.href=new URL(url,origin).href;};
 const history={state:oldState,replaceState:change,pushState:change};
 vm.runInNewContext(source,{window,history,location,URL,Event});
 return {window,history,location,route:window.DripRoute};
}
test('Visible URL stays at root while each history entry keeps its route', () => {
  const staff=browser('/fundamental/?account=1&open=1&settings=1');
  assert.equal(staff.location.href,origin+'/');
  assert.equal(staff.route.pathname,'/fundamental/');
  assert.match(staff.route.search,/settings=1/);
  const before=staff.history.state;
  let changes=0;
  staff.window.addEventListener('hashchange',()=>changes++);
  staff.route.hash='p-test';
  assert.equal(staff.location.href,origin+'/');
  assert.equal(staff.route.hash,'#p-test');
  staff.history.state=before;
  staff.window.dispatchEvent(new Event('popstate'));
  assert.equal(staff.route.hash,'');
  assert.equal(changes,2);
  const customer=browser('/customer/p-test.0123456789abcdef');
  const reloaded=browser('/',customer.history.state);
  assert.equal(reloaded.route.pathname,'/customer/p-test.0123456789abcdef');
  assert.equal(reloaded.location.href,origin+'/');
  assert.equal(browser('/').route.pathname,'/');
  const invite=browser('/?account=1#setup-account=token');
  invite.route.replace('/?account=1');
  assert.equal(invite.route.hash,'');
  assert.equal(invite.history.state.dripRoute,'/?account=1');
});
