#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import { promises as dns } from "node:dns";
import { ProxyAgent } from "undici";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT=path.dirname(fileURLToPath(import.meta.url)), DIST=path.join(ROOT,"dist"), DEFAULT_PORT=4178, MAX_BODY=1048576;
const USER={id:"local-workspace",email:"local@smart-calendar",emailVerifiedAt:"local"};

function parseArgs(args){
 const o={port:Number(process.env.SMART_CALENDAR_PORT||DEFAULT_PORT),open:true,dataDir:process.env.SMART_CALENDAR_HOME||path.join(os.homedir(),".smart-calendar")};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==="--no-open")o.open=false;
  else if(a==="--port"){o.port=Number(args[++i]);if(!Number.isInteger(o.port)||o.port<1024||o.port>65535)throw Error("--port must be between 1024 and 65535.");}
  else if(a==="--data-dir"){if(!args[i+1])throw Error("--data-dir needs a folder path.");o.dataDir=path.resolve(args[++i]);}
  else if(a==="--help"||a==="-h")o.help=true;
  else if(a==="--version"||a==="-v")o.version=true;
  else throw Error("Unknown option: "+a);
 }return o;
}
function help(){console.log("Smart Calendar - local calendar and AI assistant\n\nUsage: smart-calendar [options]\n\n  --port <number>    Local web port (default 4178)\n  --data-dir <path>  Folder for calendar data and encrypted AI key\n  --no-open          Do not open a browser automatically\n  --help             Show this help\n  --version          Show package version");}
function privateDir(d){fs.mkdirSync(d,{recursive:true,mode:0o700});try{fs.chmodSync(d,0o700)}catch{}}
function getKey(d){
 const p=path.join(d,"encryption.key");
 try{const k=fs.readFileSync(p);if(k.length!==32)throw Error("Local encryption key has an invalid size.");return k}
 catch(e){if(e.code!=="ENOENT")throw e;const k=crypto.randomBytes(32);fs.writeFileSync(p,k,{flag:"wx",mode:0o600});try{fs.chmodSync(p,0o600)}catch{}return k}
}
function blank(){return{version:2,events:[],memoryFiles:{},ai:{baseUrl:"https://api.openai.com/v1",model:"",apiKeyCiphertext:"",apiKeyIv:"",apiKeyTag:"",providers:[]}}}
function loadStore(p){
 try{const x=JSON.parse(fs.readFileSync(p,"utf8"));if(!x||!Array.isArray(x.events)||!x.ai)return blank();if(!x.ai.providers)x.ai.providers=[];if(!x.memoryFiles)x.memoryFiles={};return x}
 catch(e){if(e.code==="ENOENT")return blank();throw Error("Could not read local data at "+p+". Back up the file before repairing it.")}
}
function saveStore(p,x){const t=p+".tmp";fs.writeFileSync(t,JSON.stringify(x,null,2)+"\n",{mode:0o600});try{fs.chmodSync(t,0o600)}catch{}fs.renameSync(t,p);try{fs.chmodSync(p,0o600)}catch{}}
function encrypt(k,s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",k,iv),v=Buffer.concat([c.update(s,"utf8"),c.final()]);return{ciphertext:v.toString("base64"),iv:iv.toString("base64"),tag:c.getAuthTag().toString("base64")}}
function decrypt(k,a){if(!a?.apiKeyCiphertext)return"";const d=crypto.createDecipheriv("aes-256-gcm",k,Buffer.from(a.apiKeyIv,"base64"));d.setAuthTag(Buffer.from(a.apiKeyTag,"base64"));return Buffer.concat([d.update(Buffer.from(a.apiKeyCiphertext,"base64")),d.final()]).toString("utf8")}
function json(res,status,obj){const s=JSON.stringify(obj);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(s),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(s)}
async function getBody(req){const arr=[];let n=0;for await(const c of req){n+=c.length;if(n>MAX_BODY)throw Object.assign(Error("Request body is too large."),{statusCode:413});arr.push(c)}if(!n)return{};let x;try{x=JSON.parse(Buffer.concat(arr).toString("utf8"))}catch{throw Object.assign(Error("Send valid JSON."),{statusCode:400})}if(!x||typeof x!=="object"||Array.isArray(x))throw Object.assign(Error("Send a JSON object."),{statusCode:400});return x}
function privateIp(ip){
 if(net.isIPv4(ip)){const[a,b,c]=ip.split(".").map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113)||(a===255&&b===255&&c===255)}
 if(net.isIPv6(ip)){const s=ip.toLowerCase();return s==="::"||s==="::1"||s.startsWith("fc")||s.startsWith("fd")||s.startsWith("fe8")||s.startsWith("fe9")||s.startsWith("fea")||s.startsWith("feb")||s.startsWith("::ffff:")||!/^(2|3)/.test(s)}return true;
}
async function validateBase(input){
 let u;
 try{u=new URL(String(input||"").trim())}
 catch{throw Object.assign(Error("Enter a valid AI provider Base URL, such as https://api.openai.com/v1."),{statusCode:400})}
 if(!u.hostname)throw Object.assign(Error("The AI provider Base URL must include a hostname."),{statusCode:400});
 if(u.username||u.password)throw Object.assign(Error("The Base URL must not include a username or password. Enter only the provider endpoint."),{statusCode:400});
 if(u.search||u.hash)throw Object.assign(Error("The Base URL must not include query parameters or a fragment. Remove the ?query or #fragment from the URL."),{statusCode:400});
 const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,"").replace(/\.$/,"");
 const isLoopback=host==="localhost"||host==="127.0.0.1"||host==="::1";
 if(u.protocol!=="https:"&&!(u.protocol==="http:"&&isLoopback))throw Object.assign(Error("Use HTTPS for remote AI providers. HTTP is allowed only for localhost, 127.0.0.1, or ::1. A proxy is not required."),{statusCode:400});
 if(isLoopback)return u.toString().replace(/\/+$/,"");
 if(!host.includes(".")||host.endsWith(".local")||host.endsWith(".localhost")||host.endsWith(".internal")||host==="metadata.google.internal"||net.isIP(host))throw Object.assign(Error("Private, local, or IP-address endpoints are not allowed here. Use a public HTTPS provider hostname, or use HTTP only on localhost."),{statusCode:400});
 try{const ips=await dns.lookup(host,{all:true,verbatim:true});if(!ips.length||ips.some(x=>privateIp(x.address)))throw Object.assign(Error("The AI provider hostname resolves to a private or reserved address."),{statusCode:400})}
 catch(e){if(e.statusCode)throw e;throw Object.assign(Error("Could not verify the AI provider hostname. Check the Base URL and your DNS connection."),{statusCode:400})}
 return u.toString().replace(/\/+$/,"");
}
function providerViews(s){
 let list=Array.isArray(s.ai.providers)?s.ai.providers:[];
 if(!list.length&&s.ai.apiKeyCiphertext)list=[{id:"primary",name:"Primary",baseUrl:s.ai.baseUrl||"https://api.openai.com/v1",model:s.ai.model||"",proxyUrl:"",enabled:true,apiKeyCiphertext:s.ai.apiKeyCiphertext,apiKeyIv:s.ai.apiKeyIv,apiKeyTag:s.ai.apiKeyTag}];
 return list.map((p,i)=>({id:String(p.id||"provider-"+i),name:String(p.name||`Provider ${i+1}`),baseUrl:p.baseUrl||"",model:p.model||"",proxyUrl:p.proxyUrl||"",enabled:p.enabled!==false,apiKeyConfigured:Boolean(p.apiKeyCiphertext)}));
}
function settingsOut(s){const providers=providerViews(s);const primary=providers[0]||{};return{baseUrl:primary.baseUrl||s.ai.baseUrl||"https://api.openai.com/v1",model:primary.model||s.ai.model||"",apiKeyConfigured:Boolean(primary.apiKeyConfigured||s.ai.apiKeyCiphertext),providers,fallbackEnabled:true};}
async function validateProxy(input){
 const raw=String(input||"").trim();if(!raw)return "";
 let u;try{u=new URL(raw)}catch{throw Object.assign(Error("Enter a valid HTTP or HTTPS proxy URL."),{statusCode:400})}
 if(!["http:","https:"].includes(u.protocol)||!u.hostname||u.search||u.hash)throw Object.assign(Error("Proxy URL must use HTTP or HTTPS and must not include query parameters or fragments."),{statusCode:400});
 if(u.username||u.password)throw Object.assign(Error("Do not put proxy credentials in the URL; use a proxy without embedded credentials."),{statusCode:400});
 return u.toString().replace(/\/$/,"");
}
async function resolveProviders(s,k,o={},allowNew=false){
 const incoming=Array.isArray(o.providers)?o.providers:null;
 let desired=incoming&&incoming.length?incoming:[{id:"primary",name:"Primary",baseUrl:o.baseUrl||s.ai.baseUrl,model:o.model||s.ai.model,apiKey:o.apiKey||"",proxyUrl:o.proxyUrl||"",enabled:true}];
 const stored=Array.isArray(s.ai.providers)?s.ai.providers:[];
 const out=[];
 for(let i=0;i<desired.length;i++){
  const p=desired[i]||{};if(p.enabled===false)continue;
  const id=String(p.id||"provider-"+i).slice(0,100);
  const old=stored.find(x=>String(x.id)===id)||stored.find(x=>x.baseUrl===p.baseUrl&&x.name===p.name);
  const legacy=(i===0&&!stored.length)?s.ai:null;
  const baseUrl=await validateBase(p.baseUrl||legacy?.baseUrl||"");
  const model=String(p.model||legacy?.model||"").trim();
  const newKey=allowNew?String(p.apiKey||"").trim():"";
  let apiKey=newKey;
  if(!apiKey&&old?.apiKeyCiphertext)apiKey=decrypt(k,old);
  if(!apiKey&&legacy?.apiKeyCiphertext)apiKey=decrypt(k,legacy);
  if(!model||model.length>200||!apiKey||apiKey.length>4096)throw Object.assign(Error("Every enabled AI provider needs a valid Base URL, model, and API key."),{statusCode:400});
  const proxyUrl=await validateProxy(p.proxyUrl||old?.proxyUrl||"");
  out.push({id,name:String(p.name||`Provider ${i+1}`).slice(0,100),baseUrl,model,apiKey,proxyUrl,enabled:true});
 }
 if(!out.length)throw Object.assign(Error("Add at least one enabled AI provider."),{statusCode:400});
 return out;
}
function saveProviders(s,k,providers){
 s.ai.providers=providers.map(p=>{const c=encrypt(k,p.apiKey);return{id:p.id,name:p.name,baseUrl:p.baseUrl,model:p.model,proxyUrl:p.proxyUrl,enabled:true,apiKeyCiphertext:c.ciphertext,apiKeyIv:c.iv,apiKeyTag:c.tag}});
 const p=providers[0];s.ai.baseUrl=p.baseUrl;s.ai.model=p.model;
 const c=encrypt(k,p.apiKey);s.ai.apiKeyCiphertext=c.ciphertext;s.ai.apiKeyIv=c.iv;s.ai.apiKeyTag=c.tag;
}
async function askAI(providers,messages){
 const failures=[];
 for(const p of providers){
  let dispatcher;
  try{
   const url=/\/chat\/completions$/i.test(p.baseUrl)?p.baseUrl:p.baseUrl+"/chat/completions";
   if(p.proxyUrl)dispatcher=new ProxyAgent(p.proxyUrl);
   const r=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(35000),headers:{"Content-Type":"application/json",Authorization:"Bearer "+p.apiKey},body:JSON.stringify({model:p.model,messages,temperature:0.7}),...(dispatcher?{dispatcher}:{})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(String(d?.error?.message||d?.message||("AI provider returned HTTP "+r.status)).slice(0,350));
   if(!d?.choices?.[0]?.message?.content)throw Error("The provider returned no assistant message.");
   return {data:d,providerName:p.name,providerId:p.id};
  }catch(e){failures.push(p.name+": "+String(e.message||"connection failed").slice(0,300));}
  finally{if(dispatcher)await dispatcher.close().catch(()=>{});}
 }
 throw Object.assign(Error("All AI providers failed. "+failures.join(" | ")),{statusCode:502});
}
function cleanEvent(e){
 const title=String(e?.title||"").trim().slice(0,240),start=new Date(e?.start),end=new Date(e?.end);
 if(!e?.id||String(e.id).length>100||!title||Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)throw Object.assign(Error("One or more events have invalid fields or times."),{statusCode:400});
 return{id:String(e.id),title,start:start.toISOString(),end:end.toISOString(),color:/^#[0-9a-f]{6}$/i.test(String(e.color||""))?String(e.color):"#6d72d9",place:String(e.place||"").slice(0,2000),location:String(e.location||"").slice(0,1000),allDay:Boolean(e.allDay),reminderMinutes:e.reminderMinutes==null||e.reminderMinutes===""?null:Math.max(0,Math.min(40320,Number(e.reminderMinutes)||0)),recurrence:["none","daily","weekly","monthly"].includes(String(e.recurrence||"none"))?String(e.recurrence||"none"):"none",source:"local"};
}
function mime(p){return({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon",".woff2":"font/woff2",".woff":"font/woff"})[path.extname(p).toLowerCase()]||"application/octet-stream"}
function openBrowser(url){const[cmd,args]=process.platform==="win32"?["cmd.exe",["/c","start","",url]]:process.platform==="darwin"?["open",[url]]:["xdg-open",[url]];const c=spawn(cmd,args,{detached:true,stdio:"ignore",windowsHide:true});c.on("error",()=>console.log("Open this address in your browser: "+url));c.unref()}

export async function start(args=process.argv.slice(2)){
 let opt;try{opt=parseArgs(args)}catch(e){console.error(e.message);process.exitCode=1;return}
 if(opt.help){help();return}if(opt.version){console.log(JSON.parse(fs.readFileSync(path.join(ROOT,"package.json"),"utf8")).version);return}
 if(!fs.existsSync(path.join(DIST,"index.html"))){console.error("Web files are missing. Reinstall the package or rebuild it with npm pack.");process.exitCode=1;return}
 privateDir(opt.dataDir);const key=getKey(opt.dataDir),dataPath=path.join(opt.dataDir,"data.json"),store=loadStore(dataPath);saveStore(dataPath,store);
 const server=http.createServer(async(req,res)=>{
  try{
   const host=String(req.headers.host||"");if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))return json(res,403,{error:"Smart Calendar only accepts requests from this computer."});
   const origin=String(req.headers.origin||"");if(origin&&origin!=="http://"+host)return json(res,403,{error:"Cross-origin requests are not allowed."});
   const url=new URL(req.url||"/","http://"+host),method=String(req.method||"GET").toUpperCase(),p=decodeURIComponent(url.pathname);
   if(p==="/api/health"&&method==="GET")return json(res,200,{ok:true,service:"smart-calendar-local"});
   if(p.startsWith("/api/")){
    if(["POST","PUT","PATCH","DELETE"].includes(method)&&req.headers["content-type"]&&!String(req.headers["content-type"]).toLowerCase().includes("application/json"))return json(res,415,{error:"This endpoint accepts JSON requests only."});
    const b=["POST","PUT","PATCH"].includes(method)?await getBody(req):{};
    if(method==="GET"&&p==="/api/auth/me")return json(res,200,{user:USER});
    if(method==="POST"&&p==="/api/auth/logout")return json(res,200,{message:"Local workspace remains available on this computer."});
    if(method==="GET"&&p==="/api/events")return json(res,200,{events:store.events});
    if(method==="PUT"&&p==="/api/events"){if(!Array.isArray(b.events)||b.events.length>1000)return json(res,400,{error:"Events must be an array of no more than 1,000 items."});store.events=b.events.map(cleanEvent);saveStore(dataPath,store);return json(res,200,{saved:store.events.length})}
    if(method==="GET"&&p==="/api/ai/settings")return json(res,200,settingsOut(store));
    if(method==="PUT"&&p==="/api/ai/settings"){
     const providers=await resolveProviders(store,key,b,true);
     saveProviders(store,key,providers);saveStore(dataPath,store);
     return json(res,200,{...settingsOut(store),message:"AI settings saved and encrypted on this computer."});
    }
    if(method==="POST"&&p==="/api/ai/test"){
     const providers=await resolveProviders(store,key,b,true);
     const result=await askAI(providers,[{role:"user",content:"Reply with only: Connected"}]);
     return json(res,200,{ok:true,providerId:result.providerId,providerName:result.providerName,message:"Connection successful. "+result.providerName+" replied to the test request."});
    }
    if(method==="POST"&&p==="/api/ai/chat"){
     if(!Array.isArray(b.messages)||b.messages.length<1||b.messages.length>60)return json(res,400,{error:"Send between 1 and 60 chat messages."});
     const messages=[];for(const m of b.messages){if(!["system","user","assistant"].includes(m?.role)||typeof m?.content!=="string"||m.content.length>20000)return json(res,400,{error:"One or more chat messages are invalid."});messages.push({role:m.role,content:m.content})}
     const providers=await resolveProviders(store,key,{},false),result=await askAI(providers,messages),answer=result.data?.choices?.[0]?.message?.content;
     return json(res,200,{content:typeof answer==="string"?answer:JSON.stringify(answer),providerName:result.providerName});
    }
    if(method==="GET"&&p==="/api/memory")return json(res,200,{files:store.memoryFiles||{}});
    if(method==="PUT"&&p==="/api/memory"){
     const allowed=new Set(["profile.md","goals.md","preferences.md","routines.md","planning.md"]),files=b.files;
     if(!files||typeof files!=="object"||Array.isArray(files))return json(res,400,{error:"Send a Markdown files object."});
     store.memoryFiles=store.memoryFiles||{};
     for(const [name,content] of Object.entries(files)){
      if(!allowed.has(name)||typeof content!=="string"||content.length>30000)return json(res,400,{error:"Invalid memory filename or content."});
      store.memoryFiles[name]=content;
      const dir=path.join(opt.dataDir,"memory");privateDir(dir);const fp=path.join(dir,name);fs.writeFileSync(fp,content.endsWith("\n")?content:content+"\n",{mode:0o600});try{fs.chmodSync(fp,0o600)}catch{}
     }
     saveStore(dataPath,store);return json(res,200,{saved:Object.keys(files),message:"Memory Markdown files saved locally."});
    }
    return json(res,404,{error:"API endpoint not found."});
   }
   if(!["GET","HEAD"].includes(method))return json(res,405,{error:"Method not allowed."});
   const rel=p==="/"?"/index.html":p,file=path.resolve(DIST,"."+rel);if(!file.startsWith(DIST+path.sep))return json(res,400,{error:"Invalid file path."});
   let target=file;try{if(!(await fs.promises.stat(target)).isFile())target=path.join(DIST,"index.html")}catch{if(p.startsWith("/assets/")){res.writeHead(404);return res.end("Not found")}target=path.join(DIST,"index.html")}
   const buf=await fs.promises.readFile(target);res.writeHead(200,{"Content-Type":mime(target),"Content-Length":buf.length,"Cache-Control":target.endsWith("index.html")?"no-cache":"public, max-age=3600","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});res.end(method==="HEAD"?undefined:buf);
  }catch(e){if(res.headersSent)return res.destroy();const status=Number(e.statusCode)||500;const detail=String(e?.message||"The request failed.");if(status>=500)console.error("[Smart Calendar]",detail);const providerFailure=status===502&&detail.startsWith("All AI providers failed.");return json(res,status,{error:providerFailure?detail:(status>=500?"The local app could not complete the request. Check the terminal output.":detail)})}
 });
 server.on("error",e=>{console.error(e.code==="EADDRINUSE"?"Port "+opt.port+" is already in use. Try: smart-calendar --port "+(opt.port+1):"Could not start Smart Calendar: "+e.message);process.exitCode=1});
 server.listen(opt.port,"127.0.0.1",()=>{const address="http://127.0.0.1:"+opt.port;console.log("Smart Calendar is running locally: "+address+"\nData folder: "+opt.dataDir+"\nPress Ctrl+C to stop. Your data remains on this computer.");if(opt.open)openBrowser(address)});
 const stop=()=>server.close(()=>process.exit(0));process.once("SIGINT",stop);process.once("SIGTERM",stop);
}
