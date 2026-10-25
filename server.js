import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
const root = process.cwd();
const PORT = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookie = token => `lifebot_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${isProduction ? '; Secure' : ''}`;
const expiredCookie = `lifebot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`;
const dataDir = join(root, 'data');
const dbFile = join(dataDir, 'db.json');
const sessions = new Map();
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
let dbQueue = Promise.resolve();
async function readDb(){try{const db=JSON.parse(await readFile(dbFile,'utf8'));return {users:Array.isArray(db.users)?db.users:[],cards:Array.isArray(db.cards)?db.cards:[]};}catch{return {users:[],cards:[]};}}
async function writeDb(db){await mkdir(dataDir,{recursive:true});const tmp=dbFile+'.tmp';await writeFile(tmp,JSON.stringify(db,null,2),'utf8');await rename(tmp,dbFile);}
async function mutateDb(fn){let release;const previous=dbQueue;dbQueue=new Promise(r=>release=r);await previous;try{const db=await readDb();const result=await fn(db);await writeDb(db);return result;}finally{release();}}
function send(res,status,payload,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...extra});res.end(JSON.stringify(payload));}
async function bodyJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100_000)throw new Error('درخواست بیش از حد بزرگ است.');}return JSON.parse(raw||'{}');}
function cookie(req,name){const item=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return item?decodeURIComponent(item.slice(name.length+1)):'';}
function userFor(req){const token=cookie(req,'lifebot_session');const session=sessions.get(token);if(!session||session.expires<Date.now()){if(token)sessions.delete(token);return null;}return session.user;}
function requireRole(req,res,role){const user=userFor(req);if(!user){send(res,401,{error:'برای ادامه وارد حساب کاربری شوید.'});return null;}if(role&&user.role!==role){send(res,403,{error:'شما به این بخش دسترسی ندارید.'});return null;}return user;}
async function hashPassword(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `${salt}:${key.toString('hex')}`;}
async function verifyPassword(password,stored){try{const [salt,hex]=stored.split(':');const expected=Buffer.from(hex,'hex');const actual=await scrypt(password,salt,expected.length);return expected.length===actual.length&&timingSafeEqual(expected,actual);}catch{return false;}}
function cleanUser(user){return {id:user.id,username:user.username,displayName:user.displayName,role:user.role,createdAt:user.createdAt};}
function normalizeCardNumber(value){return String(value||'').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[\s-]/g,'');}
function formatCardNumber(number){return String(number).replace(/\D/g,'').replace(/(.{4})/g,'$1-').replace(/-$/,'');}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(req.method==='GET'&&url.pathname==='/api/auth/status'){const db=await readDb();const user=userFor(req);send(res,200,{needsSetup:!db.users.some(u=>u.role==='owner'),user:user?cleanUser(user):null});return;}
   if(req.method==='POST'&&url.pathname==='/api/auth/setup'){
    const input=await bodyJson(req);const username=String(input.username||'').trim().toLowerCase();const password=String(input.password||'');const confirm=String(input.confirmPassword||'');const displayName=String(input.displayName||'مالک مجموعه').trim().slice(0,100);
    if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length<8||password.length>128||password!==confirm){send(res,400,{error:'نام کاربری باید ۳ تا ۴۰ نویسه لاتین باشد؛ رمز حداقل ۸ نویسه و تکرارش یکسان باشد.'});return;}
    const user=await mutateDb(async db=>{if(db.users.some(u=>u.role==='owner'))throw new Error('حساب مالک قبلاً ایجاد شده است.');const u={id:randomUUID(),username,passwordHash:await hashPassword(password),displayName,role:'owner',createdAt:new Date().toISOString()};db.users.push(u);return u;});
    const token=randomBytes(32).toString('hex');sessions.set(token,{user:cleanUser(user),expires:Date.now()+12*60*60*1000});send(res,201,{user:cleanUser(user)},{'Set-Cookie':sessionCookie(token)});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/auth/register-member'){
    const input=await bodyJson(req);const username=String(input.username||'').trim().toLowerCase();const password=String(input.password||'');const confirm=String(input.confirmPassword||'');const displayName=String(input.displayName||'').trim().slice(0,100);
    if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length<8||password.length>128||password!==confirm||displayName.length<2){send(res,400,{error:'نام کامل، نام کاربری ۳ تا ۴۰ نویسه و رمز حداقل ۸ نویسه با تکرار یکسان لازم است.'});return;}
    try{const user=await mutateDb(async db=>{if(db.users.some(u=>u.username===username))throw new Error('این نام کاربری قبلاً استفاده شده است.');const u={id:randomUUID(),username,passwordHash:await hashPassword(password),displayName,role:'member',createdAt:new Date().toISOString()};db.users.push(u);return u;});send(res,201,{user:cleanUser(user),registered:true});}catch(e){send(res,409,{error:e.message});}return;
   }
   if(req.method==='POST'&&url.pathname==='/api/auth/login'){
    const input=await bodyJson(req);const username=String(input.username||'').trim().toLowerCase();const password=String(input.password||'');const db=await readDb();const user=db.users.find(u=>u.username===username);if(!user||!(await verifyPassword(password,user.passwordHash))){send(res,401,{error:'نام کاربری یا رمز عبور درست نیست.'});return;}
    const token=randomBytes(32).toString('hex');sessions.set(token,{user:cleanUser(user),expires:Date.now()+12*60*60*1000});send(res,200,{user:cleanUser(user)},{'Set-Cookie':sessionCookie(token)});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/auth/logout'){const token=cookie(req,'lifebot_session');sessions.delete(token);send(res,200,{ok:true},{'Set-Cookie':expiredCookie});return;}
   if(req.method==='GET'&&url.pathname==='/api/cards'){if(!requireRole(req,res,'owner'))return;const db=await readDb();send(res,200,{cards:db.cards.map(c=>({...c,cardNumber:formatCardNumber(c.cardNumber)}))});return;}
   if(req.method==='POST'&&url.pathname==='/api/cards'){
    const user=requireRole(req,res,'member');if(!user)return;const input=await bodyJson(req);const owner=String(input.owner||'').trim();const number=normalizeCardNumber(input.cardNumber);const channels=Array.isArray(input.channels)?input.channels:[];
    if(owner.length<2||owner.length>100||!/^\d{12,19}$/.test(number)||channels.length<1||channels.length>50){send(res,400,{error:'نام، شماره کارت ۱۲ تا ۱۹ رقمی و دست‌کم یک کانال معتبر وارد کن.'});return;}
    const cleanChannels=channels.map(c=>({tag:String(c.tag||'').trim().slice(0,100),name:String(c.name||'').trim().slice(0,100)}));if(cleanChannels.some(c=>!c.tag||!c.name)){send(res,400,{error:'تگ و نام فارسی تمام کانال‌ها الزامی است.'});return;}
    try{const item=await mutateDb(db=>{if(db.cards.some(c=>c.cardNumber===number))throw new Error('این شماره کارت قبلاً در آرشیو ثبت شده است.');const card={id:randomUUID(),owner,cardNumber:number,channels:cleanChannels,createdBy:user.id,createdAt:new Date().toISOString()};db.cards.unshift(card);return card;});send(res,201,{card:{...item,cardNumber:formatCardNumber(item.cardNumber)}});}catch(e){send(res,409,{error:e.message});}return;
   }
   if(req.method==='DELETE'&&url.pathname.startsWith('/api/cards/')){if(!requireRole(req,res,'owner'))return;const id=decodeURIComponent(url.pathname.split('/').pop());const result=await mutateDb(db=>{const before=db.cards.length;db.cards=db.cards.filter(c=>c.id!==id);return before!==db.cards.length;});if(!result){send(res,404,{error:'رکورد پیدا نشد.'});return;}send(res,200,{ok:true});return;}
   if(req.method==='GET'&&url.pathname==='/api/users'){if(!requireRole(req,res,'owner'))return;const db=await readDb();send(res,200,{users:db.users.filter(u=>u.role==='member').map(cleanUser)});return;}
   if(req.method==='POST'&&url.pathname==='/api/users'){if(!requireRole(req,res,'owner'))return;const input=await bodyJson(req);const username=String(input.username||'').trim().toLowerCase();const password=String(input.password||'');const displayName=String(input.displayName||'').trim().slice(0,100);if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length<8||password.length>128||displayName.length<2){send(res,400,{error:'نام نمایشی، نام کاربری لاتین ۳ تا ۴۰ نویسه و رمز حداقل ۸ نویسه لازم است.'});return;}try{const user=await mutateDb(async db=>{if(db.users.some(u=>u.username===username))throw new Error('این نام کاربری قبلاً استفاده شده است.');const u={id:randomUUID(),username,passwordHash:await hashPassword(password),displayName,role:'member',createdAt:new Date().toISOString()};db.users.push(u);return u;});send(res,201,{user:cleanUser(user)});}catch(e){send(res,409,{error:e.message});}return;}
   send(res,404,{error:'مسیر درخواست پیدا نشد.'});return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
  const pathname=decodeURIComponent(url.pathname);const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');const file=normalize(join(root,relative));if(!file.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});if(req.method==='HEAD')res.end();else res.end(data);
 }catch(err){send(res,400,{error:err.message||'درخواست نامعتبر است.'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`LifeBot running on port ${PORT}`));
