"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { ShopSessionController, SHOP_CONFIG, isShopNavigation } = require("../p3/shop-session-controller.js");
const { readProductFromWebContents, shopPlatformForUrl } = require("../p3/product-dom-reader.js");
const { extractProductSnapshot } = require("../extension/shopee_grab.js");

const PRODUCT_URL="https://shopee.vn/toner-i.123.456";
function fixtureDoc({ images=6, login=false, captcha=false }={}) {
  const imgs=Array.from({length:images},(_,i)=>({
    src:`https://down-vn.img.susercontent.com/file/toner${i}_tn.jpg`, currentSrc:`https://down-vn.img.susercontent.com/file/toner${i}_tn.jpg`,
    naturalWidth:100, naturalHeight:100, getAttribute:()=>null
  }));
  const map={
    'meta[property="og:title"]': {content:"Toner mỹ phẩm MODOLIVIO"},
    'meta[property="og:description"]': {content:"Toner làm sạch dịu nhẹ và cấp ẩm"}
  };
  return {
    title:login?"Shopee login":captcha?"Captcha xác minh": "Sản phẩm toner",
    querySelector: q=>q==='input[type="password"]'&&login?{}:q.includes('captcha')&&captcha?{}:map[q]||null,
    querySelectorAll: q=>q.includes('img')?imgs:[]
  };
}
function fakeElectron() {
  const created=[]; const partitions=[];
  class FakeWindow extends EventEmitter {
    constructor(opts){super();this.opts=opts;this.destroyed=false;this.contentView={addChildView(v){this.child=v;}};this.visible=true;}
    getContentBounds(){return {width:1000,height:700}}
    show(){this.visible=true;} focus(){} isDestroyed(){return this.destroyed}
    close(){this.destroyed=true;this.emit('closed')}
  }
  class FakeView {
    constructor({webPreferences}){
      created.push(this);this.webPreferences=webPreferences;
      let current=""; const self=this;
      this.webContents={
        getURL:()=>current,
        loadURL:async u=>{self.loads.push(u);current=u;},
        executeJavaScript:async script=>vm.runInNewContext(script,{document:fixtureDoc(),location:{href:current},URL}),
        setWindowOpenHandler(fn){self.popupHandler=fn},on(type,fn){self.listeners[type]=fn},close(){self.closed=true}
      };
      this.loads=[];this.listeners={};this.closed=false;
    }
    setBounds(bounds){this.bounds=bounds}
  }
  const session={fromPartition(name){partitions.push(name);return {id:name}}};
  return {BrowserWindow:FakeWindow,WebContentsView:FakeView,session,created,partitions};
}

test("Source extension normalizes _tn URLs, preserves original product, deduplicates and yields 4+ images",()=>{
  const p=extractProductSnapshot(fixtureDoc({images:7}),PRODUCT_URL);
  assert.equal(p.ok,true);assert.equal(p.images.length,7);
  assert.equal(p.title,"Toner mỹ phẩm MODOLIVIO");
  assert.ok(p.images.every(x=>!x.includes("_tn")));
  assert.equal(p.imageUrl,p.images[0]);
});

test("WebContentsView uses persistent isolated partition, visible session, no cookie access",async()=>{
  const mock=fakeElectron(); const controller=new ShopSessionController(mock);
  assert.deepEqual(SHOP_CONFIG.shopee.partition,"persist:shopee");
  await assert.rejects(controller.read(PRODUCT_URL),/LOGIN_REQUIRED/);
  const opened=controller.open("shopee");
  assert.equal(opened.partition,"persist:shopee");
  assert.equal(mock.created[0].webPreferences.session.id,"persist:shopee");
  assert.ok(mock.created[0].bounds.width>=900);
  assert.equal(mock.created[0].popupHandler({url:"https://evil.test/"}).action,"deny");
  assert.equal(mock.created[0].loads.length,1);
  await assert.rejects(controller.read(PRODUCT_URL),/LOGIN_REQUIRED/);
  controller.confirm("shopee");
  const product=await controller.read(PRODUCT_URL);
  assert.equal(product.images.length,6);
  assert.equal(mock.created[0].loads.at(-1),PRODUCT_URL);
  assert.equal(mock.created.length,1,"must reuse same WebContentsView, never create another reader browser");
  assert.equal(mock.created[0].webPreferences.nodeIntegration,false);
  assert.equal(mock.created[0].webPreferences.sandbox,true);
  assert.equal(mock.created[0].webPreferences.partition,"persist:shopee");
  assert.equal(mock.created[0].webContents.cookies,undefined);
  controller.open("tiktok");
  assert.deepEqual(mock.partitions,["persist:shopee","persist:tiktok"]);
  controller.close();
});

test("Reader detects LOGIN_REQUIRED and CAPTCHA_REQUIRED without waiting",async()=>{
  const make=doc=>({webContents:{getURL:()=>PRODUCT_URL,loadURL:async()=>{},executeJavaScript:async script=>vm.runInNewContext(script,{document:doc,location:{href:PRODUCT_URL},URL})}});
  await assert.rejects(readProductFromWebContents(make(fixtureDoc({login:true})),PRODUCT_URL,{sessionReady:true}),/LOGIN_REQUIRED/);
  await assert.rejects(readProductFromWebContents(make(fixtureDoc({captcha:true})),PRODUCT_URL,{sessionReady:true}),/CAPTCHA_REQUIRED/);
  await assert.rejects(readProductFromWebContents(null,PRODUCT_URL),/LOGIN_REQUIRED/);
});

test("Reader emits INSUFFICIENT_IMAGES, strict timeout, and rejects unsupported domain",async()=>{
  const low={webContents:{getURL:()=>PRODUCT_URL,loadURL:async()=>{},executeJavaScript:async script=>vm.runInNewContext(script,{document:fixtureDoc({images:3}),location:{href:PRODUCT_URL},URL})}};
  await assert.rejects(readProductFromWebContents(low,PRODUCT_URL,{partialGraceMs:0,timeoutMs:1200}),/INSUFFICIENT_IMAGES/);
  const hanging={webContents:{getURL:()=>"https://shopee.vn/",loadURL:()=>new Promise(()=>{}),executeJavaScript:async()=>({})}};
  await assert.rejects(readProductFromWebContents(hanging,PRODUCT_URL,{timeoutMs:20}),/TIMEOUT/);
  assert.equal(shopPlatformForUrl("https://shopee.vn.attacker.test/i"),null);
  assert.equal(isShopNavigation("shopee","https://evil.test"),false);
  assert.equal(isShopNavigation("shopee","https://accounts.shopee.vn/login"),true);
});

test("Shop import persists only the product's original images, title and description",()=>{
  const { storeImportedShopProduct, recordShopAnnieImport }=require("../p3/shop-import.js");
  const records={products:[],annieTasks:[],annieMessages:[]};
  const store={insert(kind,row){const obj={id:records[kind].length+1,...row};records[kind].push(obj);return obj;}};
  const result=storeImportedShopProduct(store,extractProductSnapshot(fixtureDoc(),PRODUCT_URL));
  assert.equal(result.productId,1);assert.equal(result.imageCount,6);
  assert.equal(records.products[0].status,"ready");
  assert.ok(records.products[0].imageUrls.every(x=>!x.includes('_tn')));
  assert.equal(records.products[0].cookie,undefined);
  const reply=recordShopAnnieImport(store,PRODUCT_URL,result);
  assert.equal(reply.productId,1);assert.match(reply.reply,/6 ảnh/);
  assert.equal(records.annieTasks[0].status,"done");
});