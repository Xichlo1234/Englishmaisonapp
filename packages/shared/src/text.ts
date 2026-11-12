/** Bỏ dấu tiếng Việt, chuyển chữ thường, gộp khoảng trắng — dùng cho cột tìm kiếm. */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hóa số điện thoại Việt Nam về dạng 0xxxxxxxxx. Trả về null nếu không hợp lệ. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/** Chuẩn hóa họ tên: bỏ khoảng trắng thừa, viết hoa chữ cái đầu mỗi từ. */
export function normalizePersonName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi') : w))
    .join(' ');
}

/** Mã hiển thị có tiền tố + số thứ tự đệm 0. VD: formatCode('HS', 42, 5) = 'HS00042'. */
export function formatCode(prefix: string, n: number, width: number): string {
  return `${prefix}${String(n).padStart(width, '0')}`;
}
