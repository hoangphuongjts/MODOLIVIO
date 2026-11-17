"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parse,scenario,canonicalProductUrl,ttsWav} = require("../tools/s5-vertical-slice.js");
test("S5 fails closed without exactly one mode",()=>{
 assert.throws(()=>parse([]),/Chọn đúng một/);assert.throws(()=>parse(["--assemble","--ci-mock"]),/Chọn đúng một/);
});
test("S5 refuses domain spoofing and URL mismatch",()=>{
 const snap={ok:true,url:"https://shopee.vn/product-i.123.456",platform:"shopee",title:"Toner",images:["https://cdn.shopee.vn/p.png"]};
 assert.throws(()=>canonicalProductUrl("https://shopee.vn.evil.com/x"),/Chỉ nhận/);
 assert.throws(()=>scenario(snap,"https://shopee.vn/other"),/MISMATCH/);
});
test("S5 prepares three 10s storyboards, 9:16, external caption without price",()=>{
 const snap={ok:true,url:"https://shopee.vn/product-i.123.456",platform:"shopee",title:"Toner dưỡng da",images:["https://cdn.shopee.vn/p.png"]};
 const plan=scenario(snap,snap.url);
 assert.equal(plan.scenes.length,3);assert.deepEqual(plan.scenes.map(x=>x.durationSec),[10,10,10]);
 assert.ok(plan.scenes.every(x=>x.aspectRatio==="9:16"));assert.match(plan.caption,/Toner/);
});
test("S5 rejects non-loopback TTS before any network access",async()=>{
 await assert.rejects(ttsWav("hello","https://example.com"),/loopback/);
});