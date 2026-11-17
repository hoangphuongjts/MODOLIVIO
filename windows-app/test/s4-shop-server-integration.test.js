"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const { createServer }=require("../server.js");
const URL='https://shopee.vn/toner-i.123.456';

test("App /actions Annie link reads via supplied authenticated shop importer and stores 4+ original images",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mo-shop-import-"));
  let called=0;
  let activeStore;
  const {storeImportedShopProduct}=require("../p3/shop-import.js");
  const {server,store}=createServer({dataDir:dir,rendererDir:path.resolve(__dirname,'../renderer'),shopImporter:async url=>{
    called++;assert.equal(url,URL);
    return storeImportedShopProduct(activeStore,{ok:true,platform:'shopee',title:'Toner sạch',description:'Mô tả thật',url:URL,
      images:[1,2,3,4].map(i=>`https://cdn.shopee.vn/file/product${i}.jpg`),imageCount:4});
  }});
  activeStore=store;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const port=server.address().port,endpoint=`http://127.0.0.1:${port}/actions`;
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${port}`},body:JSON.stringify({action:'annieSendMessage',args:{text:URL}})});
  const data=await r.json();
  assert.equal(called,1);assert.ok(data.data.productId);assert.match(data.data.reply,/4 ảnh/);
  assert.equal(store.all('products')[0].imageUrls.length,4);assert.equal(store.all('annieTasks')[0].status,'done');
  const bad=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',origin:'https://attacker.test'},body:JSON.stringify({action:'annieSendMessage',args:{text:URL}})});
  assert.equal(bad.status,403);assert.equal(called,1);
});

test("Annie link importer absent or login missing fails closed without falsely marking task done",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mo-shop-nologin-"));
  const {server,store}=createServer({dataDir:dir,rendererDir:path.resolve(__dirname,'../renderer'),shopImporter:async()=>{throw new Error('LOGIN_REQUIRED: xác nhận phiên') }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const port=server.address().port;
  const r=await fetch(`http://127.0.0.1:${port}/actions`,{method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${port}`},body:JSON.stringify({action:'annieSendMessage',args:{text:URL}})});
  const data=await r.json();
  assert.match(data.error,/LOGIN_REQUIRED/);
  assert.equal(store.all('products').length,0);
  assert.equal(store.all('annieTasks').length,0);
});