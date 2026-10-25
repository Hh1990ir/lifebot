// Exact decimal arithmetic backed by BigInt; no binary floating-point is used.
export function normalizeDigits(value) {
  const map = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '٫':'.','٬':',','−':'-' };
  return [...String(value)].map(c => map[c] ?? c).join('').replace(/[\u200e\u200f\u061c]/g, '').trim();
}
export function parseDecimal(raw) {
  let s = normalizeDigits(raw);
  if (!s) throw new Error('مقدار خالی است');
  if (/\s/.test(s)) throw new Error('وجود فاصله در عدد مجاز نیست');
  if ((s.match(/,/g) || []).length) {
    // Commas are accepted only as conventional groups of three before an optional decimal point.
    const parts = s.split('.');
    if (parts.length > 2) throw new Error('قالب اعشاری نامعتبر است');
    const integer = parts[0].replace(/^[+-]/, '');
    if (!/^\d{1,3}(,\d{3})+$/.test(integer)) throw new Error('جداکننده هزارگان مبهم یا نامعتبر است');
    s = (parts[0].startsWith('-') ? '-' : parts[0].startsWith('+') ? '+' : '') +
      integer.replace(/,/g, '') + (parts.length === 2 ? `.${parts[1]}` : '');
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error('قالب عدد نامعتبر است');
  let sign = 1n;
  if (s[0] === '-') { sign = -1n; s = s.slice(1); }
  else if (s[0] === '+') s = s.slice(1);
  const [wholeRaw = '0', fracRaw = ''] = s.split('.');
  const whole = wholeRaw || '0';
  const digits = `${whole}${fracRaw}`.replace(/^0+(?=\d)/, '') || '0';
  let coefficient = BigInt(digits) * sign;
  let scale = fracRaw.length;
  return normalize({ coefficient, scale });
}
export function normalize(d) {
  let { coefficient, scale } = d;
  if (!Number.isInteger(scale) || scale < 0) throw new Error('دقت اعشاری نامعتبر است');
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 };
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
export function add(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const ac = a.coefficient * 10n ** BigInt(scale - a.scale);
  const bc = b.coefficient * 10n ** BigInt(scale - b.scale);
  return normalize({ coefficient: ac + bc, scale });
}
export function multiply(a, b) {
  return normalize({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale });
}
export function equal(a, b) {
  const x = normalize(a), y = normalize(b);
  return x.coefficient === y.coefficient && x.scale === y.scale;
}
export function formatDecimal(value, { grouping = true } = {}) {
  const d = normalize(value);
  const negative = d.coefficient < 0n;
  let digits = (negative ? -d.coefficient : d.coefficient).toString();
  if (d.scale > 0) {
    digits = digits.padStart(d.scale + 1, '0');
    digits = `${digits.slice(0, -d.scale)}.${digits.slice(-d.scale)}`;
  }
  let [whole, fraction] = digits.split('.');
  if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
export function parseLines(text) {
  const lines = String(text).split(/\r\n?|\n/);
  const values = [], errors = [];
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    try { values.push({ line: index + 1, raw: raw.trim(), value: parseDecimal(raw) }); }
    catch (error) { errors.push({ line: index + 1, raw: raw.trim(), message: error.message }); }
  });
  return { values, errors };
}
export function sum(values) {
  return values.reduce((acc, value) => add(acc, value), { coefficient: 0n, scale: 0 });
}
export function calculateAddition(text) {
  const parsed = parseLines(text);
  if (parsed.errors.length) return { ...parsed, result: null, verified: false, verification: 'ورودی نامعتبر است؛ محاسبه انجام نشد.' };
  if (!parsed.values.length) return { ...parsed, result: null, verified: false, empty: true, verification: 'هیچ عدد معتبری برای محاسبه وارد نشده است.' };
  const result = sum(parsed.values.map(x => x.value));
  const verification = verifyAddition(parsed.values, result);
  return { ...parsed, result, verified: verification.ok, verification: verification.message, verificationDetails: verification.details };
}
export function calculateMultiplication(text, multiplierRaw) {
  const parsed = parseLines(text);
  let multiplier;
  const multiplierErrors = [];
  try { multiplier = parseDecimal(multiplierRaw); } catch (e) { multiplierErrors.push(e.message); }
  const errors = [...parsed.errors, ...multiplierErrors.map(message => ({ line: null, raw: String(multiplierRaw), message: `ضریب: ${message}` }))];
  if (errors.length) return { ...parsed, errors, multiplier: null, products: [], total: null, verified: false, verification: 'ورودی نامعتبر است؛ محاسبه انجام نشد.' };
  if (!parsed.values.length) return { ...parsed, errors: [], multiplier, products: [], total: null, verified: false, empty: true, verification: 'هیچ عدد معتبری برای محاسبه وارد نشده است.' };
  const products = parsed.values.map((entry, index) => ({ index: index + 1, ...entry, product: multiply(entry.value, multiplier) }));
  const total = sum(products.map(p => p.product));
  const verification = verifyMultiplication(parsed.values, multiplier, products, total);
  return { ...parsed, errors: [], multiplier, products, total, verified: verification.ok, verification: verification.message, verificationDetails: verification.details };
}

// A separately structured verification path: convert each decimal to an exact rational,
// then accumulate using common powers-of-ten denominators, rather than calling add/sum.
function asFraction(raw) {
  let s = normalizeDigits(raw).replace(/,/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = s.split('.');
  const numerator = BigInt(`${whole || '0'}${fraction}` || '0') * (negative ? -1n : 1n);
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}
function fractionSum(rawValues) {
  const maxScale = rawValues.reduce((m, raw) => Math.max(m, asFraction(raw).denominator.toString().length - 1), 0);
  const denominator = 10n ** BigInt(maxScale);
  let numerator = 0n;
  for (const raw of rawValues) {
    const f = asFraction(raw);
    numerator += f.numerator * (denominator / f.denominator);
  }
  return { numerator, denominator };
}
function sameFractionDecimal(f, d) {
  const scaled = d.coefficient * (f.denominator / (10n ** BigInt(d.scale)));
  return f.numerator === scaled;
}
export function verifyAddition(entries, result) {
  try {
    const f = fractionSum(entries.map(e => e.raw));
    const ok = sameFractionDecimal(f, result);
    return { ok, message: ok ? 'نتیجه با بررسی مستقل مطابقت دارد.' : 'هشدار: بررسی مستقل با نتیجه اصلی اختلاف دارد.', details: `بررسی مستقل روی ${entries.length} ورودی انجام شد.` };
  } catch (error) { return { ok: false, message: 'بررسی مستقل به خطا برخورد کرد.', details: error.message }; }
}
export function verifyMultiplication(entries, multiplier, products, total) {
  try {
    const expectedCount = entries.length === products.length && products.every((p, i) => p.index === i + 1);
    const rawInputs = entries.map(e => e.raw);
    const fSum = fractionSum(rawInputs);
    const mf = asFraction(formatDecimal(multiplier, { grouping: false }));
    const identityNumerator = fSum.numerator * mf.numerator;
    const identityDenominator = fSum.denominator * mf.denominator;
    const productFractions = products.map(p => {
      const a = asFraction(p.raw), b = mf;
      return { numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator };
    });
    const maxDenomDigits = productFractions.reduce((m, f) => Math.max(m, f.denominator.toString().length - 1), 0);
    const commonDenom = 10n ** BigInt(maxDenomDigits);
    const productSumNumerator = productFractions.reduce((acc, f) => acc + f.numerator * (commonDenom / f.denominator), 0n);
    const totalFraction = asFraction(formatDecimal(total, { grouping: false }));
    const totalMatches = totalFraction.numerator * commonDenom === productSumNumerator * totalFraction.denominator;
    const identityMatches = identityNumerator * commonDenom === productSumNumerator * identityDenominator;
    const individualMatches = products.every((p, i) => {
      const expected = productFractions[i];
      const actual = asFraction(formatDecimal(p.product, { grouping: false }));
      return actual.numerator * expected.denominator === expected.numerator * actual.denominator;
    });
    const ok = expectedCount && totalMatches && identityMatches && individualMatches;
    return { ok, message: ok ? 'محاسبات با موفقیت بررسی شد؛ نتیجه با بررسی مستقل مطابقت دارد.' : 'هشدار: یک یا چند بررسی مستقل ناموفق بود.', details: `تعداد نتایج: ${products.length}؛ ترتیب، ضرب‌ها، جمع نتایج و همانی ریاضی بررسی شدند.` };
  } catch (error) { return { ok: false, message: 'بررسی مستقل به خطا برخورد کرد.', details: error.message }; }
}
export function roundDecimal(value, decimalPlaces = 2) {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) throw new Error('تعداد رقم اعشار نامعتبر است');
  const d = normalize(value);
  if (d.scale <= decimalPlaces) return d;
  const divisor = 10n ** BigInt(d.scale - decimalPlaces);
  let quotient = d.coefficient / divisor;
  const remainder = d.coefficient % divisor;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= divisor) quotient += d.coefficient < 0n ? -1n : 1n;
  return normalize({ coefficient: quotient, scale: decimalPlaces });
}