const ONES = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (full || h) out.push(`${ONES[h]} trăm`);
  if (t > 1) out.push(`${ONES[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if ((full || h) && u) out.push('lẻ');
  if (u) out.push(t > 1 && u === 1 ? 'mốt' : t >= 1 && u === 5 ? 'lăm' : t > 1 && u === 4 ? 'tư' : ONES[u]!);
  return out.join(' ');
}
/** Đọc số tiền bằng chữ (VD 1.620.000 → "Một triệu sáu trăm hai mươi nghìn đồng"). */
export function vndInWords(amount: number): string {
  if (amount === 0) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups: number[] = [];
  let n = Math.abs(Math.trunc(amount));
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    parts.push(readTriple(g, i < groups.length - 1) + units[i % 4]);
  }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng';
}
