import { calculateAddition, calculateMultiplication, formatDecimal, normalizeDigits, roundDecimal } from './math.js';

const $ = id => document.getElementById(id);
const views = ['home', 'addition', 'multiplication', 'cards', 'member'];
let currentRole = 'owner';
const oneDecimal = value => formatFaDecimal(roundDecimal(value, 1));
let lastSum = null, lastMultiply = null;
const fa = n => new Intl.NumberFormat('fa-IR').format(n);
const toFaDigits = value => String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const formatFaDecimal = value => toFaDigits(formatDecimal(value));
const formatCard = value => { const digits = String(value).replace(/[^0-9۰-۹٠-٩]/g, '').replace(/[0-9]/g, d => d).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); return toFaDigits(digits.replace(/(.{4})/g, '$1-').replace(/-$/, '')); };
let selectedRole = 'owner', authUser = null, needsSetup = false, registerMode = false;
function showView(view) {
  views.forEach(v => $(`${v}-view`).classList.toggle('hidden', v !== view));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('page-title').textContent = ({home:'نمای کلی',addition:'جمع اعداد',multiplication:'ضرب در ضریب',cards:'مدیریت شماره کارت‌ها',member:'ثبت شماره کارت و کانال‌ها'})[view];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => showView(b.dataset.open)));
function displayError(box, errors, empty) {
  box.classList.toggle('hidden', !errors.length && !empty);
  if (empty) { box.innerHTML = 'هیچ عدد معتبری برای محاسبه وارد نشده است.'; return; }
  if (!errors.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<strong>ورودی نامعتبر است. لطفاً موارد زیر را اصلاح کن:</strong><ul>${errors.map(e => `<li>${e.line ? `خط ${fa(e.line)} — ` : ''}<b>${escapeHtml(e.raw)}</b>: ${escapeHtml(e.message)}</li>`).join('')}</ul>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function statusHtml(verified, message, details) { return `<div class="verify-status ${verified?'':'fail'}"><span class="status-icon">${verified?'✓':'!'}</span><div><strong>${escapeHtml(message)}</strong><br><span>${escapeHtml(details || '')}</span></div></div>`; }
function actionButtons(prefix) { return `<div class="result-actions"><button class="secondary-button" data-copy="${prefix}">کپی نتیجه</button><button class="secondary-button" data-copy-report="${prefix}">کپی گزارش</button><button class="secondary-button" data-export="${prefix}">دریافت فایل متنی</button></div>`; }
function saveHistory(item) {
  try {
    const history = JSON.parse(localStorage.getItem('lifebot-history') || '[]');
    history.unshift(item); localStorage.setItem('lifebot-history', JSON.stringify(history.slice(0, 30)));
    renderHistory();
  } catch { /* Storage can be disabled; calculations still work. */ }
}
function renderHistory() {
  const list = $('history-list');
  let history = [];
  try { history = JSON.parse(localStorage.getItem('lifebot-history') || '[]'); } catch {}
  if (!history.length) { list.innerHTML = '<div class="empty-state">هنوز محاسبه‌ای ثبت نشده است.</div>'; return; }
  list.innerHTML = history.map((h,i) => `<div class="history-item"><div><strong>${h.type === 'sum'?'جمع اعداد':'ضرب در ضریب'} · ${escapeHtml(h.result)}</strong><small>${escapeHtml(h.date)} · ${fa(h.count)} ورودی</small></div><div class="history-actions"><button class="mini-button" data-history="${i}">بازکردن</button><button class="mini-button" data-history-copy="${i}">کپی</button></div></div>`).join('');
}
function getHistory() { try { return JSON.parse(localStorage.getItem('lifebot-history') || '[]'); } catch { return []; } }
function makeReportSum(r, raw) {
  return `LifeBot — گزارش جمع اعداد\nورودی‌ها:\n${raw}\n\nنتیجه نهایی: ${formatFaDecimal(r.result)}\nتعداد ورودی‌ها: ${r.values.length}\nوضعیت بررسی: ${r.verified?'تأیید شد':'تأیید نشد'}\n${r.verification}\n${r.verificationDetails || ''}`;
}
function makeReportMultiply(r, raw) {
  const lines = r.products.map(p => `${p.index}. ${formatFaDecimal(p.value)} × ${formatFaDecimal(r.multiplier)} = ${oneDecimal(p.product)}`).join('\n');
  return `LifeBot — گزارش ضرب در ضریب\nورودی‌ها:\n${raw}\nضریب: ${formatFaDecimal(r.multiplier)}\n\n${lines}\n\nجمع نتایج (نمایش تا یک رقم اعشار): ${oneDecimal(r.total)}\nتعداد ورودی‌ها: ${r.products.length}\nوضعیت بررسی: ${r.verified?'تأیید شد':'تأیید نشد'}\n${r.verification}\n${r.verificationDetails || ''}`;
}
function bindResultActions(prefix, getReport, getCopy) {
  const root = $(`${prefix}-output`);
  root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyText(getCopy())));
  root.querySelectorAll('[data-copy-report]').forEach(b => b.addEventListener('click', () => copyText(getReport())));
  root.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportText(getReport())));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('متن با موفقیت کپی شد.'); }
  catch { const t = document.createElement('textarea'); t.value=text; document.body.appendChild(t); t.select(); const ok=document.execCommand('copy'); t.remove(); toast(ok?'متن با موفقیت کپی شد.':'کپی انجام نشد؛ متن را دستی انتخاب کن.'); }
}
function exportText(text) {
  const blob = new Blob(['\ufeff', text], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`lifebot-report-${new Date().toISOString().slice(0,10)}.txt`; a.click(); URL.revokeObjectURL(url);
}
let toastTimer;
function toast(message) {
  let el=$('toast'); if(!el){el=document.createElement('div');el.id='toast';el.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#17233a;color:white;padding:12px 18px;border-radius:10px;font-size:12px;z-index:20;box-shadow:0 8px 24px #0003';document.body.appendChild(el);}
  el.textContent=message; el.style.opacity='1'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.style.opacity='0',2200);
}
function updateLineCount(inputId, outputId) {
  const count = $(inputId).value.split(/\r\n?|\n/).filter(s=>s.trim()).length;
  $(outputId).textContent = `${fa(count)} ورودی`;
}
$('sum-input').addEventListener('input',()=>updateLineCount('sum-input','sum-line-count'));
$('multiply-input').addEventListener('input',()=>updateLineCount('multiply-input','multiply-line-count'));
$('calculate-sum').addEventListener('click', () => {
  const raw=$('sum-input').value, r=calculateAddition(raw); lastSum=r;
  displayError($('sum-errors'),r.errors,r.empty);
  if (!r.result) { $('sum-result').classList.remove('hidden'); $('sum-output').classList.add('hidden'); return; }
  $('sum-result').classList.add('hidden'); $('sum-output').classList.remove('hidden');
  const report=makeReportSum(r,raw);
  $('sum-output').innerHTML=`<div class="result-caption">نتیجه نهایی</div><div class="result-number">${escapeHtml(formatFaDecimal(r.result))}</div><div class="result-caption">جمع دقیق ${fa(r.values.length)} عدد</div><div class="stats-grid"><div class="stat-box"><span>تعداد ورودی‌ها</span><strong>${fa(r.values.length)}</strong></div><div class="stat-box"><span>اعداد پردازش‌شده</span><strong>${fa(r.values.length)} از ${fa(r.values.length)}</strong></div></div>${statusHtml(r.verified,r.verification,r.verificationDetails)}<div class="breakdown"><h4>خلاصه محاسبه</h4><div class="breakdown-line">${r.values.map(v=>formatFaDecimal(v.value)).join(' + ')}</div><div class="breakdown-line">= ${formatFaDecimal(r.result)}</div></div>${actionButtons('sum')}`;
  bindResultActions('sum',()=>report,()=>formatFaDecimal(r.result));
  saveHistory({type:'sum',raw,result:formatFaDecimal(r.result),count:r.values.length,date:new Date().toLocaleString('fa-IR'),report,copy:formatFaDecimal(r.result)});
});
$('calculate-multiply').addEventListener('click', () => {
  const raw=$('multiply-input').value, multiplierRaw=$('multiplier-input').value, r=calculateMultiplication(raw,multiplierRaw); lastMultiply=r;
  displayError($('multiply-errors'),r.errors,r.empty);
  if (!r.total) { $('multiply-result').classList.remove('hidden'); $('multiply-output').classList.add('hidden'); return; }
  $('multiply-result').classList.add('hidden'); $('multiply-output').classList.remove('hidden');
  const report=makeReportMultiply(r,raw);
  const rows=r.products.map(p=>`<div class="product-row"><span class="product-index">${fa(p.index)}</span><div class="product-equation">${escapeHtml(formatFaDecimal(p.value))} × ${escapeHtml(formatFaDecimal(r.multiplier))} = <strong>${escapeHtml(oneDecimal(p.product))}</strong></div></div>`).join('');
  $('multiply-output').innerHTML=`<div class="result-caption">ضریب انتخاب‌شده: ${escapeHtml(formatFaDecimal(r.multiplier))}</div><div class="stats-grid"><div class="stat-box"><span>تعداد نتایج</span><strong>${fa(r.products.length)}</strong></div><div class="stat-box"><span>وضعیت شماره‌گذاری</span><strong>۱ تا ${fa(r.products.length)}</strong></div></div>${statusHtml(r.verified,r.verification,r.verificationDetails)}<section class="product-output-section"><div class="product-output-heading"><h4>خروجی اول: شرح کامل محاسبات</h4><span>عدد × ضریب = حاصل</span></div><div class="product-list">${rows}</div></section><section class="product-output-section product-values-section"><div class="product-output-heading"><h4>خروجی دوم: فهرست نتایج</h4><button type="button" class="secondary-button" id="copy-product-values">کپی فهرست نتایج</button></div><p class="result-list-hint">فقط حاصل هر ضرب، با شماره‌گذاری مرتب از ۱ تا ${fa(r.products.length)}.</p><ol class="product-values-list">${r.products.map(p=>`<li><span class="value-index">${fa(p.index)}</span><strong>${escapeHtml(oneDecimal(p.product))}</strong></li>`).join('')}</ol></section><div class="total-box"><span>جمع تمام نتایج ضرب</span><strong>${escapeHtml(oneDecimal(r.total))}</strong><small class="rounding-note">نمایش گرد‌شده تا یک رقم اعشار؛ بررسی با مقدار دقیق انجام شده است.</small></div>${actionButtons('multiply')}`;
  bindResultActions('multiply',()=>report,()=>r.products.map(p=>`${p.index}. ${oneDecimal(p.product)}`).join('\n')+`\nجمع نتایج: ${oneDecimal(r.total)}`);
  $('copy-product-values').addEventListener('click',()=>copyText(r.products.map(p=>`${p.index}. ${oneDecimal(p.product)}`).join('\n')));
  saveHistory({type:'multiply',raw,multiplier:formatFaDecimal(r.multiplier),result:formatFaDecimal(r.total),count:r.products.length,date:new Date().toLocaleString('fa-IR'),report,copy:r.products.map(p=>`${p.index}. ${oneDecimal(p.product)}`).join('\n')+`\nجمع نتایج: ${oneDecimal(r.total)}`});
});
$('reset-sum').addEventListener('click',()=>{$('sum-input').value='';$('sum-errors').classList.add('hidden');$('sum-output').classList.add('hidden');$('sum-result').classList.remove('hidden');updateLineCount('sum-input','sum-line-count');lastSum=null;});
$('reset-multiply').addEventListener('click',()=>{$('multiply-input').value='';$('multiplier-input').value='0.035';$('multiply-errors').classList.add('hidden');$('multiply-output').classList.add('hidden');$('multiply-result').classList.remove('hidden');updateLineCount('multiply-input','multiply-line-count');lastMultiply=null;});
document.querySelectorAll('[data-sample]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.sample==='sum')$('sum-input').value='300\n3000\n529\n150\n75\n1200\n45\n800';else{$('multiply-input').value='3500\n2100\n1100\n680\n1500';$('multiplier-input').value='0.035';}updateLineCount(b.dataset.sample==='sum'?'sum-input':'multiply-input',b.dataset.sample==='sum'?'sum-line-count':'multiply-line-count');}));
$('clear-history').addEventListener('click',()=>{if(confirm('تمام سوابق محاسباتی این مرورگر پاک شود؟')){localStorage.removeItem('lifebot-history');renderHistory();}});
$('history-list').addEventListener('click',e=>{
 const open=e.target.closest('[data-history]'), cp=e.target.closest('[data-history-copy]'), h=getHistory();
 if(open){const item=h[Number(open.dataset.history)];if(!item)return;if(item.type==='sum'){$('sum-input').value=item.raw;updateLineCount('sum-input','sum-line-count');showView('addition');$('calculate-sum').click();}else{$('multiply-input').value=item.raw;$('multiplier-input').value=item.multiplier;updateLineCount('multiply-input','multiply-line-count');showView('multiplication');$('calculate-multiply').click();}}
 if(cp){const item=h[Number(cp.dataset.history)];if(item)copyText(item.copy);}
});
$('theme-toggle').addEventListener('click',()=>{document.body.classList.toggle('dark');const dark=document.body.classList.contains('dark');localStorage.setItem('lifebot-theme',dark?'dark':'light');$('theme-toggle').textContent=dark?'☀':'☾';});
try{if(localStorage.getItem('lifebot-theme')==='dark'){document.body.classList.add('dark');$('theme-toggle').textContent='☀';}}catch{}
renderHistory();


// ورود مرحله‌ای، نقش‌ها و آرشیو شماره کارت‌ها
const welcome = $('welcome-screen'), roleScreen = $('role-screen'), mainApp = $('main-app');
$('plant-enter').addEventListener('click',()=>{welcome.classList.add('planting');setTimeout(()=>{welcome.classList.add('hidden');roleScreen.classList.remove('hidden');roleScreen.classList.add('role-arrive');},650);});
$('back-to-welcome').addEventListener('click',()=>{roleScreen.classList.add('hidden');welcome.classList.remove('hidden','planting');});
function setRole(role){currentRole=role;roleScreen.classList.add('hidden');welcome.classList.add('hidden');mainApp.classList.remove('hidden');document.querySelectorAll('[data-owner-only]').forEach(el=>el.classList.toggle('hidden',role!=='owner'));document.querySelectorAll('[data-member-only]').forEach(el=>el.classList.toggle('hidden',role!=='member'));$('role-banner-title').textContent=role==='owner'?'پنل مالک مجموعه':'فضای زیرمجموعه';$('role-banner-copy').textContent=role==='owner'?'نمای کلی ابزارها و مدیریت ثبت‌های مجموعه':'ثبت و پیگیری اطلاعات شماره کارت و کانال‌ها';$('role-chip').textContent=role==='owner'?'مالک مجموعه':'زیرمجموعه';$('page-title').textContent=role==='owner'?'نمای کلی':'ثبت اطلاعات';showView(role==='owner'?'home':'member');if(role==='owner'){loadCards();loadMemberAccounts();}renderPersianDate();}
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>openLogin(b.dataset.role)));
$('switch-role').addEventListener('click',async()=>{await logout();mainApp.classList.add('hidden');roleScreen.classList.remove('hidden');});
async function openLogin(role){
  selectedRole=role; registerMode=false; roleScreen.classList.add('hidden'); $('login-screen').classList.remove('hidden');
  $('login-form').reset(); $('login-message').classList.add('hidden'); $('display-name-wrap').classList.add('hidden'); $('register-display-name').required=false;
  $('login-title').textContent=role==='owner'?'ورود مالک مجموعه':'ورود زیرمجموعه';
  $('login-description').textContent=role==='owner'?'برای ورود یا ساخت نخستین حساب مالک، اطلاعات خود را وارد کنید.':'وارد حساب شوید یا حساب زیرمجموعه بسازید.';
  try {
    const res=await fetch('/api/auth/status'); if(!res.ok) throw new Error('status'); const status=await res.json(); needsSetup=!!status.needsSetup;
    const ownerSetup=needsSetup&&role==='owner';
    $('setup-notice').classList.toggle('hidden',!ownerSetup);
    $('confirm-password-wrap').classList.toggle('hidden',!ownerSetup);
    $('register-toggle').classList.toggle('hidden',role==='owner' ? !ownerSetup : false);
    $('register-toggle').textContent=role==='owner'?'ثبت‌نام مالک مجموعه':'حساب ندارید؟ ثبت‌نام زیرمجموعه';
    $('login-submit').innerHTML=ownerSetup?'ثبت‌نام مالک و ایجاد حساب <b>←</b>':'ورود امن <b>←</b>';
  } catch { showLoginMessage('سرور در دسترس نیست؛ لطفاً برنامه را با npm start اجرا کن.','error-message'); }
}

function showLoginMessage(message,cls){const el=$('login-message');el.textContent=message;el.className='form-message '+cls;}
async function logout(){try{await fetch('/api/auth/logout',{method:'POST'});}catch{}authUser=null;}
$('login-back').addEventListener('click',()=>{$('login-screen').classList.add('hidden');roleScreen.classList.remove('hidden');});
$('register-toggle').addEventListener('click',()=>{
  if(selectedRole==='owner') { registerMode=true; $('login-title').textContent='ثبت‌نام مالک مجموعه'; $('login-description').textContent='حساب مالک اصلی را با نام کاربری و رمز امن ایجاد کنید.'; $('register-toggle').classList.add('hidden'); $('login-submit').innerHTML='ایجاد حساب مالک <b>←</b>'; $('confirm-password-wrap').classList.remove('hidden'); $('setup-notice').classList.remove('hidden'); return; }
  registerMode=!registerMode; $('login-message').classList.add('hidden'); $('display-name-wrap').classList.toggle('hidden',!registerMode); $('confirm-password-wrap').classList.toggle('hidden',!registerMode); $('register-display-name').required=registerMode;
  $('login-password').setAttribute('autocomplete',registerMode?'new-password':'current-password'); $('login-title').textContent=registerMode?'ثبت‌نام زیرمجموعه':'ورود زیرمجموعه'; $('login-description').textContent=registerMode?'برای ساخت حساب زیرمجموعه، فرم را کامل کنید.':'اطلاعات حساب زیرمجموعه را وارد کنید.';
  $('login-submit').innerHTML=registerMode?'ثبت‌نام زیرمجموعه <b>←</b>':'ورود امن <b>←</b>'; $('register-toggle').textContent=registerMode?'قبلاً حساب دارید؟ ورود':'زیرمجموعه تازه هستید؟ ثبت‌نام';
});
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$('login-message'); msg.classList.add('hidden');
  const payload={username:$('login-username').value.trim(),password:$('login-password').value};
  let endpoint='/api/auth/login';
  const isMemberRegistration=registerMode&&selectedRole==='member';
  if(needsSetup&&selectedRole==='owner'){
    endpoint='/api/auth/setup'; payload.confirmPassword=$('login-password-confirm').value; payload.displayName='مالک مجموعه';
  } else if(isMemberRegistration){
    endpoint='/api/auth/register-member'; payload.confirmPassword=$('login-password-confirm').value; payload.displayName=$('register-display-name').value.trim();
  }
  try{
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await res.json(); if(!res.ok) throw new Error(data.error||'عملیات انجام نشد.');
    if(isMemberRegistration){
      // ثبت‌نام فقط حساب می‌سازد؛ ورود باید جداگانه با نام کاربری و رمز انجام شود.
      registerMode=false; $('display-name-wrap').classList.add('hidden'); $('register-display-name').required=false;
      $('confirm-password-wrap').classList.add('hidden'); $('login-password-confirm').value=''; $('login-password').value='';
      $('login-password').setAttribute('autocomplete','current-password');
      $('login-title').textContent='ورود زیرمجموعه'; $('login-description').textContent='حساب ساخته شد؛ حالا با نام کاربری و رمز عبورت وارد شو.';
      $('login-submit').innerHTML='ورود امن <b>←</b>';
      $('register-toggle').textContent='زیرمجموعه تازه هستید؟ ثبت‌نام';
      $('login-message').textContent='ثبت‌نام با موفقیت انجام شد. حالا با همان نام کاربری و رمز عبور وارد شوید.';
      $('login-message').className='form-message success-message'; $('login-password').focus();
      return;
    }
    if(!data.user||data.user.role!==selectedRole) throw new Error('این حساب برای نقش انتخاب‌شده مجاز نیست.');
    authUser=data.user; $('login-screen').classList.add('hidden'); setRole(data.user.role); toast('خوش آمدی، '+data.user.displayName);
  }catch(err){showLoginMessage(err.message||'ارتباط با سرور برقرار نشد.','error-message');}
});
$('logout-button').addEventListener('click',async()=>{await logout();mainApp.classList.add('hidden');roleScreen.classList.remove('hidden');toast('با موفقیت خارج شدی.');});
function channelRow(){return `<div class="channel-row"><label>تگ کانال<input required name="channelTag" placeholder="مثلاً @channel" maxlength="100"/></label><label>نام فارسی کانال<input required name="channelName" placeholder="نام کانال" maxlength="100"/></label><button type="button" class="remove-channel" aria-label="حذف کانال">−</button></div>`;}
function updateChannelControls(){const rows=[...document.querySelectorAll('.channel-row')];$('channel-count').textContent=`${fa(rows.length)} کانال`;rows.forEach(row=>{const btn=row.querySelector('.remove-channel');btn.disabled=rows.length===1;btn.onclick=()=>{row.remove();updateChannelControls();};});}
$('add-channel').addEventListener('click',()=>{if(document.querySelectorAll('.channel-row').length>=50){toast('حداکثر ۵۰ کانال قابل ثبت است.');return;}$('channel-fields').insertAdjacentHTML('beforeend',channelRow());updateChannelControls();});
updateChannelControls();
$('card-number').addEventListener('input',e=>{const pos=e.target.selectionStart;const formatted=formatCard(e.target.value);e.target.value=formatted;e.target.setSelectionRange(formatted.length,formatted.length);});
$('member-form').addEventListener('submit',async e=>{e.preventDefault();const msg=$('member-message');msg.classList.remove('hidden','error-message');msg.textContent='در حال ثبت اطلاعات…';const channels=[...document.querySelectorAll('.channel-row')].map(row=>({tag:row.querySelector('[name="channelTag"]').value.trim(),name:row.querySelector('[name="channelName"]').value.trim()}));try{const response=await fetch('/api/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:$('card-owner').value.trim(),cardNumber:$('card-number').value,channels})});const data=await response.json();if(!response.ok)throw new Error(data.error||'ثبت اطلاعات انجام نشد.');msg.textContent='اطلاعات با موفقیت ثبت شد.';msg.classList.add('success-message');$('member-form').reset();$('channel-fields').innerHTML=channelRow();updateChannelControls();}catch(err){msg.textContent=err.message||'ارتباط با سرور برقرار نشد.';msg.classList.add('error-message');}});
async function loadCards(){const list=$('card-archive-list');list.innerHTML='<div class="empty-state">در حال دریافت آرشیو…</div>';try{const res=await fetch('/api/cards');const data=await res.json();if(!res.ok)throw new Error(data.error);renderCards(data.cards||[]);}catch{list.innerHTML='<div class="empty-state">دریافت آرشیو ناموفق بود؛ اتصال سرور را بررسی کن.</div>';}}
function renderCards(cards){const query=($('card-search').value||'').trim().toLowerCase();const filtered=cards.filter(c=>[c.owner,c.cardNumber,...(c.channels||[]).flatMap(x=>[x.tag,x.name])].join(' ').toLowerCase().includes(query));const list=$('card-archive-list');if(!filtered.length){list.innerHTML='<div class="empty-state">موردی برای نمایش پیدا نشد.</div>';return;}list.innerHTML=filtered.map(c=>`<article class="archive-card"><div class="archive-card-head"><div><span class="archive-label">صاحب کارت</span><h3>${escapeHtml(c.owner)}</h3><span class="archive-date">ثبت: ${escapeHtml(new Date(c.createdAt).toLocaleString('fa-IR'))}</span></div><button class="danger-button" data-delete-card="${escapeHtml(c.id)}">حذف</button></div><div class="card-number-line"><span>شماره کارت</span><strong dir="ltr">${escapeHtml(formatCard(c.cardNumber))}</strong></div><div class="archive-channels"><strong>کانال‌ها · ${fa((c.channels||[]).length)}</strong>${(c.channels||[]).map(ch=>`<div class="archive-channel"><span class="channel-tag">${escapeHtml(ch.tag)}</span><span>${escapeHtml(ch.name)}</span></div>`).join('')}</div></article>`).join('');list.querySelectorAll('[data-delete-card]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('این رکورد از آرشیو حذف شود؟'))return;try{const res=await fetch(`/api/cards/${encodeURIComponent(btn.dataset.deleteCard)}`,{method:'DELETE'});if(!res.ok)throw new Error();await loadCards();toast('رکورد حذف شد.');}catch{toast('حذف رکورد ناموفق بود.');}}));}
$('refresh-cards').addEventListener('click',loadCards);$('card-search').addEventListener('input',loadCards);

function renderPersianDate(){const now=new Date();const el=$('persian-date');if(el)el.textContent=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(now);renderPersianCalendar(now);}
function renderPersianCalendar(now=new Date()){const grid=$('calendar-grid'),monthTitle=$('calendar-month');if(!grid||!monthTitle)return;const fmt=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'numeric',day:'numeric'});const parts=d=>Object.fromEntries(fmt.formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));const todayParts=parts(now);let first=new Date(now);first.setHours(12,0,0,0);while(parts(first).day!==1){first.setDate(first.getDate()-1);}const nextMonth=new Date(first);do{nextMonth.setDate(nextMonth.getDate()+1);}while(parts(nextMonth).month===todayParts.month&&parts(nextMonth).year===todayParts.year);const daysInMonth=Math.round((nextMonth-first)/86400000);monthTitle.textContent=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{month:'long',year:'numeric'}).format(now);const weekdayLabels=['ش','ی','د','س','چ','پ','ج'];const offset=(first.getDay()+1)%7;let cells=weekdayLabels.map(d=>`<span class="calendar-weekday">${d}</span>`).join('');for(let i=0;i<offset;i++)cells+='<span class="calendar-empty"></span>';for(let day=1;day<=daysInMonth;day++){const date=new Date(first);date.setDate(first.getDate()+day-1);const isToday=day===todayParts.day;cells+=`<span class="calendar-day${isToday?' today':''}">${fa(day)}</span>`;}grid.innerHTML=cells;}
async function loadMemberAccounts(){const list=$('member-accounts-list');if(!list)return;try{const res=await fetch('/api/users');const data=await res.json();if(!res.ok)throw new Error(data.error);list.innerHTML=(data.users||[]).length?(data.users||[]).map(u=>`<div class="member-account-row"><span class="account-avatar">${escapeHtml((u.displayName||'ز').slice(0,1))}</span><span><strong>${escapeHtml(u.displayName)}</strong><small dir="ltr">@${escapeHtml(u.username)}</small></span><span class="account-role">زیرمجموعه</span></div>`).join(''):'<div class="empty-state">هنوز حساب زیرمجموعه‌ای ساخته نشده است.</div>';}catch{list.innerHTML='<div class="empty-state">دریافت حساب‌ها ممکن نشد.</div>';}}
$('create-member-form')?.addEventListener('submit',async e=>{e.preventDefault();const msg=$('account-message');msg.className='form-message';msg.textContent='در حال ساخت حساب…';try{const res=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:$('new-member-name').value.trim(),username:$('new-member-username').value.trim(),password:$('new-member-password').value})});const data=await res.json();if(!res.ok)throw new Error(data.error);msg.className='form-message success-message';msg.textContent='حساب زیرمجموعه با موفقیت ساخته شد.';$('create-member-form').reset();loadMemberAccounts();}catch(err){msg.className='form-message error-message';msg.textContent=err.message||'ساخت حساب ناموفق بود.';}});
