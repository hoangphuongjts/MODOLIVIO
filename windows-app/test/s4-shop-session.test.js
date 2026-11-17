"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readProductFromWebContents,extractProductSnapshot}=require("../p3/product-dom-reader.js");
const url="https://shopee.vn/test-toner-i.123.456";
test("S4 rejects a missing authenticated WebContentsView before timeout, never starts external browser",async()=>{
 await assert.rejects(readProductFromWebContents(null,url),/LOGIN_REQUIRED|WEBVIEW_UNAVAILABLE/);
 let loads=0;const view={webContents:{getURL:()=>"about:blank",loadURL:async()=>{loads++},executeJavaScript:async()=>({ok:false})}};
 await assert.rejects(readProductFromWebContents(view,url),/LOGIN_REQUIRED/);assert.equal(loads,0);
});
test("S4 explicit sessionReady=false returns LOGIN_REQUIRED immediately",async()=>{
 let loads=0;const view={webContents:{getURL:()=>url,loadURL:async()=>{loads++},executeJavaScript:async()=>({ok:true,images:["a","b","c","d"],description:"info"})}};
 await assert.rejects(readProductFromWebContents(view,url,{sessionReady:false}),/LOGIN_REQUIRED/);assert.equal(loads,0);
});
test("S4 CAPTCHA_REQUIRED is surfaced without retries",async()=>{
 let reads=0;const view={webContents:{getURL:()=>url,loadURL:async()=>{},executeJavaScript:async()=>{reads++;return{ok:false,reason:"CAPTCHA_REQUIRED",message:"Xác minh thủ công"}}}};
 await assert.rejects(readProductFromWebContents(view,url),/CAPTCHA_REQUIRED/);assert.equal(reads,1);
});
test("S4 TIMEOUT is reported when page data does not finish",async()=>{
 const view={webContents:{getURL:()=>url,loadURL:async()=>{},executeJavaScript:async()=>({ok:false,reason:"PRODUCT_NOT_FOUND",message:"not ready"})}};
 await assert.rejects(readProductFromWebContents(view,url,{timeoutMs:5,pause:async()=>new Promise(r=>setTimeout(r,6))}),/TIMEOUT/);
});