import { describe, expect, it } from 'vitest';
import { vndInWords } from '../src/pages/fees/ReceiptPage';

describe('Đọc số tiền bằng chữ (phiếu thu)', () => {
  it.each([
    [0, 'Không đồng'],
    [1_620_000, 'Một triệu sáu trăm hai mươi nghìn đồng'],
    [1_800_000, 'Một triệu tám trăm nghìn đồng'],
    [500_000, 'Năm trăm nghìn đồng'],
    [2_005_000, 'Hai triệu không trăm lẻ năm nghìn đồng'],
    [215_000, 'Hai trăm mười lăm nghìn đồng'],
    [1_021_000, 'Một triệu không trăm hai mươi mốt nghìn đồng'],
    [34_000, 'Ba mươi tư nghìn đồng'],
    [1_000_000_000, 'Một tỷ đồng'],
  ])('%i → %s', (n, s) => expect(vndInWords(n)).toBe(s));
});
