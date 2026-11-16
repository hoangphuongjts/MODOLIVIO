"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractProductSnapshot, isAllowedProductUrl, readProductFromWebContents } = require("../p3/product-dom-reader.js");

function docFor({ title = "Toner dưỡng da", description = "Toner làm sạch dịu nhẹ", login = false, captcha = false } = {}) {
  const imageURLs = Array.from({length:9}, (_, i) => `https://cdn.shopee.vn/toner-${i+1}.jpg`);
  const metas = {
    'meta[property="og:title"]': {content:title},
    'meta[property="og:description"]': {content:description},
  };
  return {
    title,
    querySelector(selector) {
      if (selector === 'input[type="password"]') return login ? {} : null;
      if (selector.includes('captcha')) return captcha ? {} : null;
      return metas[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector.includes('application/ld+json')) return [];
      if (selector.startsWith('meta[')) return [];
      if (selector.includes('main img')) return imageURLs.map(src => ({src,naturalWidth:1000,naturalHeight:1000}));
      return [];
    },
  };
}

test("Shopee DOM reader collects unique 6–8 product photos with description", () => {
  const p = extractProductSnapshot(docFor(), "https://shopee.vn/toner-i.123.456");
  assert.equal(p.ok,true);
  assert.equal(p.imageCount,8);
  assert.equal(p.title,"Toner dưỡng da");
  assert.match(p.description,/dịu nhẹ/);
  assert.equal(Object.hasOwn(p,"cookie"),false);
  assert.equal(Object.hasOwn(p,"price"),false);
});

test("Login/captcha/domain restrictions give explicit errors", () => {
  assert.equal(extractProductSnapshot(docFor({login:true}),"https://shopee.vn/product").reason,"LOGIN_REQUIRED");
  assert.equal(extractProductSnapshot(docFor({captcha:true}),"https://shopee.vn/product").reason,"CAPTCHA");
  assert.equal(isAllowedProductUrl("https://shopee.vn.attacker.com/p"),false);
  assert.equal(isAllowedProductUrl("http://shopee.vn/p"),false);
});

test("Existing WebContentsView session is reused without navigating again", async () => {
  let pageReads = 0;
  const url="https://shopee.vn/toner-i.123.456";
  const contents = {
    getURL: () => url,
    loadURL: async () => { throw new Error("should not navigate"); },
    executeJavaScript: async (script) => {
      assert.match(script,/querySelectorAll/);
      pageReads++;
      return {ok:true,description:"Toner thật",images:["1","2","3","4"],title:"Toner"};
    }
  };
  assert.equal((await readProductFromWebContents({webContents:contents},url)).title,"Toner");
  assert.equal(pageReads,1);
});

test("WebContentsView stops at captcha instead of bypassing it", async () => {
  const url="https://shopee.vn/toner-i.123.456";
  const contents={getURL:()=>url,loadURL:async()=>{}, executeJavaScript:async()=>({ok:false,reason:"CAPTCHA",message:"Xác minh thủ công"})};
  await assert.rejects(readProductFromWebContents({webContents:contents},url),/CAPTCHA/);
});
