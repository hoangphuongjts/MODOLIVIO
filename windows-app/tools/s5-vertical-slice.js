"use strict";
/*
 * S5 vertical-slice handoff. Never connects to Muse, reads cookies, or drives CDP.
 * --ci-mock: local TTS stub + generated clips for Windows CI (no remote calls)
 * --prepare: create script/scene plan from a snapshot collected by an authenticated
 *            shop WebContentsView; no Muse requests
 * --assemble: given three user-generated Muse clips and live loopback TTS (8123),
 *             assemble a 30-second MP4 (9:16) plus external caption and hashtags.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

function call(bin, args) {
  try { return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 2 * 1024 * 1024 }); }
  catch (err) { throw new Error(`${bin} thất bại: ${String(err.stderr || err.message).slice(-1000)}`); }
}
function parse(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--ci-mock", "--prepare", "--assemble", "--url", "--snapshot", "--clips-dir", "--out", "--tts-url", "--ffmpeg", "--ffprobe"].includes(key)) throw new Error(`Unknown option ${key}`);
    if (key === "--ci-mock" || key === "--prepare" || key === "--assemble") opts[key.slice(2)] = true;
    else { if (!argv[i+1] || argv[i+1].startsWith("--")) throw new Error(`${key} thiếu giá trị`); opts[key.slice(2)] = argv[++i]; }
  }
  if (Number(!!opts["ci-mock"]) + Number(!!opts.prepare) + Number(!!opts.assemble) !== 1) throw new Error("Chọn đúng một --ci-mock, --prepare hoặc --assemble");
  return opts;
}
function canonicalProductUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error("URL Shopee không hợp lệ"); }
  if (u.protocol !== "https:" || !["shopee.vn", "www.shopee.vn"].includes(u.hostname.toLowerCase())) throw new Error("Chỉ nhận URL HTTPS Shopee đã xác minh; không truy cập URL trong CI");
  return `${u.origin}${u.pathname}`;
}
function safeName(v) { return String(v || "").replace(/[\r\n\t<>]/g, " ").trim().slice(0, 140); }
function scenario(snapshot, url) {
  const expected = canonicalProductUrl(url);
  if (canonicalProductUrl(snapshot.url) !== expected || snapshot.platform !== "shopee" || !safeName(snapshot.title)) throw new Error("PRODUCT_SNAPSHOT_MISMATCH: URL, nền tảng hoặc tiêu đề không khớp với ảnh chụp trong phiên sàn");
  if (snapshot.ok !== true || !Array.isArray(snapshot.images) || !snapshot.images.some(u => /^https:\/\//i.test(u))) throw new Error("PRODUCT_SNAPSHOT_INVALID: thiếu ảnh sản phẩm thật hoặc dữ liệu chưa được xác minh");
  const title = safeName(snapshot.title);
  const scenes = [
    { name: "Móc câu", dialogue: `Bạn đang tìm hiểu ${title}? Hãy xem ba điểm quan trọng trước khi chọn.`, visualPrompt: `Cảnh giới thiệu sản phẩm: ${title}; giữ nguyên ảnh sản phẩm gốc` },
    { name: "Thông tin", dialogue: `Điểm đầu tiên là đọc kỹ mô tả và kiểm tra nguồn gốc của ${title}.`, visualPrompt: `Cảnh thông tin sản phẩm: ${title}; không tự thêm công dụng chưa kiểm chứng` },
    { name: "Kết luận", dialogue: `Nếu phù hợp nhu cầu, hãy xem chi tiết sản phẩm và đánh giá từ người mua.`, visualPrompt: `Cảnh chốt: ${title}; giọng Việt tự nhiên, không nói giá số` },
  ].map((s,i)=>({ ...s, sceneIndex:i+1, durationSec:10, aspectRatio:"9:16", originalProductImage:snapshot.images[0], sourceProductUrl:expected }));
  return { version:1, state:"WAITING_FOR_VERIFIED_MUSE_CLIPS", originalUrl:expected, productTitle:title, scenes, caption:`${title} — tham khảo thông tin sản phẩm, kiểm tra mô tả và đánh giá trước khi mua.`, hashtags:["#MODOLIVIO", "#ReviewSanPham", "#MuaSamThongMinh"] };
}
function renderCaption(plan, out) {
  fs.writeFileSync(path.join(out, "caption-and-hashtags.txt"),`${plan.caption}\n\n${plan.hashtags.join(" ")}\n`, "utf8");
  const times=["00:00:00,000 --> 00:00:10,000","00:00:10,000 --> 00:00:20,000","00:00:20,000 --> 00:00:30,000"];
  fs.writeFileSync(path.join(out, "subtitles-external.srt"), plan.scenes.map((s,i)=>`${i+1}\n${times[i]}\n${s.dialogue}\n`).join("\n"), "utf8");
}
function verifyMedia(file, ffprobe) {
  const z = JSON.parse(call(ffprobe,["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",file]));
  const stream = (z.streams || []).find(s=>s.codec_type === "video");
  const duration = Number(z.format?.duration || 0);
  if (!stream || !Number.isFinite(duration) || duration < 9 || duration > 11) throw new Error(`SCENE_INVALID: clip phải dài khoảng 10s (${path.basename(file)})`);
  return { width:stream.width,height:stream.height,duration };
}
function probeResult(file, ffprobe) {
  const z=JSON.parse(call(ffprobe,["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",file]));
  const v=z.streams.find(s=>s.codec_type==="video"),a=z.streams.find(s=>s.codec_type==="audio");
  const d=Number(z.format.duration);
  if(!v || !a || !Number.isFinite(d) || d<29.5 || d>30.5 || v.width*16!==v.height*9) throw new Error(`FINAL_INVALID: mong đợi MP4 9:16, 30s, có audio, nhận ${JSON.stringify({v,a,d})}`);
  return {width:v.width,height:v.height,duration:d,audio:true};
}
async function ttsWav(text, baseUrl, voice="Ngọc Lan") {
  const u = new URL(baseUrl);
  if (u.protocol!=="http:" || !["127.0.0.1","localhost","[::1]"].includes(u.hostname)) throw new Error("TTS phải dùng HTTP loopback 127.0.0.1:8123, không được gửi thoại ra máy khác");
  const response = await fetch(new URL("/v1/audio/speech",u), {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:text,voice}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`VieNeu TTS HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<44 || bytes.toString("ascii",0,4)!=="RIFF" || bytes.toString("ascii",8,12)!=="WAVE")throw new Error("TTS trả dữ liệu không phải WAV");
  return bytes;
}
async function assemble(plan, {out,clipsDir,ttsUrl,ffmpeg="ffmpeg",ffprobe="ffprobe",resolution="1080x1920",fps=30}) {
  const [w,h] = resolution.split("x").map(Number);
  if (w*16!==h*9) throw new Error("Output cần đúng tỷ lệ 9:16");
  fs.mkdirSync(out,{recursive:true});
  const chunks=[];
  for(let i=0;i<3;i++){
    const clip=path.resolve(clipsDir,`scene-${String(i+1).padStart(2,"0")}.mp4`);
    if(!fs.existsSync(clip))throw new Error(`MUSE_CLIP_MISSING: ${path.basename(clip)}; không chạy Muse trong script này`);
    verifyMedia(clip,ffprobe);
    const wav=path.join(out,`narration-${i+1}.wav`);
    fs.writeFileSync(wav,await ttsWav(plan.scenes[i].dialogue,ttsUrl));
    const merged=path.join(out,`normalized-${i+1}.mp4`);
    call(ffmpeg,["-hide_banner","-loglevel","error","-y","-i",clip,"-i",wav,"-map","0:v:0","-map","1:a:0","-vf",`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1`,"-t","10","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-c:a","aac","-ar","44100","-ac","1","-b:a","96k","-movflags","+faststart",merged]);
    chunks.push(merged);
  }
  const list=path.join(out,"concat.txt");
  fs.writeFileSync(list,chunks.map(p=>`file '${p.replace(/'/g,"'\\''")}'`).join("\n"),"utf8");
  const final=path.join(out,"MODOLIVIO-3-scenes-30s-9x16.mp4");
  call(ffmpeg,["-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",final]);
  const verified=probeResult(final,ffprobe);
  renderCaption(plan,out);
  return {file:final,...verified};
}
async function ciMock(out, ffmpeg, ffprobe){
  const snapshot={ok:true,url:"https://shopee.vn/test-toner-i.123.456",platform:"shopee",title:"MOCK CI — toner thử nghiệm",images:["https://example.invalid/ci-product.png"]};
  const plan=scenario(snapshot,snapshot.url);
  const clipsDir=path.join(out,"ci-synthetic-clips");fs.mkdirSync(clipsDir,{recursive:true});
  for(let i=0;i<3;i++)call(ffmpeg,["-hide_banner","-loglevel","error","-y","-f","lavfi","-i",`color=c=${["red","blue","green"][i]}:s=360x640:r=12:d=10`,"-t","10","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p",path.join(clipsDir,`scene-${String(i+1).padStart(2,"0")}.mp4`)]);
  const wav=path.join(out,"ci-speech.wav");
  call(ffmpeg,["-hide_banner","-loglevel","error","-y","-f","lavfi","-i","sine=frequency=350:duration=10","-ar","16000","-ac","1","-c:a","pcm_s16le",wav]);
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url!=="/v1/audio/speech"||req.method!=="POST") {res.writeHead(404);return res.end();}
    let body="";for await(const c of req)body+=c;if(body.length>4000){res.writeHead(413);return res.end();}
    try{const payload=JSON.parse(body);assert.equal(typeof payload.input,"string");assert.equal(payload.voice,"Ngọc Lan");requests.push(payload);res.writeHead(200,{"content-type":"audio/wav"});res.end(fs.readFileSync(wav));}
    catch(err){res.writeHead(400);res.end(err.message);}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const result=await assemble(plan,{out,clipsDir,ttsUrl:`http://127.0.0.1:${server.address().port}`,ffmpeg,ffprobe,resolution:"360x640",fps:12});
    if(requests.length!==3)throw new Error(`Expected 3 TTS calls, observed ${requests.length}`);
    fs.writeFileSync(path.join(out,"ci-evidence.json"),JSON.stringify({mode:"OFFLINE_SYNTHETIC_ONLY",requestCount:requests.length,requests:requests.map(x=>({inputLength:x.input.length,voice:x.voice})),result},null,2));
    return {...result,ttsCalls:requests.length};
  } finally{await new Promise(resolve=>server.close(resolve));}
}
async function main(argv=process.argv.slice(2)) {
  const opt=parse(argv), out=path.resolve(opt.out || path.join(process.cwd(),"s5-output"));
  fs.mkdirSync(out,{recursive:true});
  const ffmpeg=opt.ffmpeg||"ffmpeg",ffprobe=opt.ffprobe||"ffprobe";
  if(opt["ci-mock"]){const result=await ciMock(out,ffmpeg,ffprobe);console.log("S5_OFFLINE_PASS "+JSON.stringify(result));return result;}
  if(!opt.url||!opt.snapshot)throw new Error("Cần --url và --snapshot từ WebContentsView đã đăng nhập sàn");
  const product=JSON.parse(fs.readFileSync(path.resolve(opt.snapshot),"utf8"));
  const plan=scenario(product,opt.url);
  fs.writeFileSync(path.join(out,"scenario.json"),JSON.stringify(plan,null,2),"utf8");renderCaption(plan,out);
  if(opt.prepare){console.log("S5_PREPARED_WAITING_FOR_MUSE: " + path.join(out,"scenario.json"));return plan;}
  if(!opt["clips-dir"])throw new Error("MUSE_CLIPS_REQUIRED: clip thật từ phiên Muse đã xác minh cần có trước khi assemble");
  const result=await assemble(plan,{out,clipsDir:path.resolve(opt["clips-dir"]),ttsUrl:opt["tts-url"]||"http://127.0.0.1:8123",ffmpeg,ffprobe});
  console.log("S5_LOCAL_ASSEMBLY_PASS "+JSON.stringify(result));return result;
}
if(require.main===module)main().catch(e=>{console.error(`S5_BLOCKED ${e.message}`);process.exitCode=1});
module.exports={parse,canonicalProductUrl,scenario,verifyMedia,probeResult,ttsWav,assemble,ciMock,main};