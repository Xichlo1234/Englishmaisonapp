export interface CriterionConfig {
  id: number;
  code: string;
  name: string;
  weight: number;
  maxScore: number;
}

export interface GradeBand {
  /** Ngưỡng dưới (bao gồm), thang 10. */
  min: number;
  label: string;
}

/** Thang xếp loại mặc định (sắp xếp giảm dần theo min). */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { min: 9, label: 'Xuất sắc' },
  { min: 8, label: 'Giỏi' },
  { min: 6.5, label: 'Khá' },
  { min: 5, label: 'Trung bình' },
  { min: 0, label: 'Cần cải thiện' },
];

export const DEFAULT_CRITERIA: Omit<CriterionConfig, 'id'>[] = [
  { code: 'LISTENING', name: 'Listening', weight: 1, maxScore: 10 },
  { code: 'SPEAKING', name: 'Speaking', weight: 1, maxScore: 10 },
  { code: 'READING', name: 'Reading', weight: 1, maxScore: 10 },
  { code: 'WRITING', name: 'Writing', weight: 1, maxScore: 10 },
  { code: 'HOMEWORK', name: 'Homework', weight: 1, maxScore: 10 },
  { code: 'ATTITUDE', name: 'Attitude', weight: 1, maxScore: 10 },
];

/** Làm tròn số thực về `digits` chữ số thập phân, tránh lỗi dấu phẩy động (VD 8.165 → 8.17). */
export function roundTo(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Điểm trung bình theo trọng số, quy về thang 10, làm tròn 2 chữ số.
 * Chỉ tính các tiêu chí có điểm (quyết định Q8). Trả về null nếu không có điểm nào.
 */
export function computeWeightedAverage(
  criteria: CriterionConfig[],
  scores: Record<number, number | null | undefined>,
): number | null {
  let sum = 0;
  let weightSum = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (s === null || s === undefined) continue;
    if (s < 0 || s > c.maxScore) throw new RangeError(`Điểm ${c.name} phải trong khoảng 0–${c.maxScore}`);
    sum += (s / c.maxScore) * 10 * c.weight;
    weightSum += c.weight;
  }
  if (weightSum === 0) return null;
  return roundTo(sum / weightSum, 2);
}

/** Xếp loại theo thang (quyết định Q9: xếp loại trên giá trị đã làm tròn 2 chữ số). */
export function classify(average: number | null, bands: GradeBand[] = DEFAULT_GRADE_BANDS): string | null {
  if (average === null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (average >= b.min) return b.label;
  return sorted[sorted.length - 1]?.label ?? null;
}

/** Kiểm tra thang xếp loại hợp lệ: có mức 0, các ngưỡng 0–10 không trùng nhau, nhãn không rỗng. */
export function validateGradeBands(bands: GradeBand[]): string | null {
  if (bands.length < 2) return 'Cần ít nhất 2 mức xếp loại';
  const mins = bands.map((b) => b.min);
  if (new Set(mins).size !== mins.length) return 'Các ngưỡng không được trùng nhau';
  if (!mins.includes(0)) return 'Phải có mức bắt đầu từ 0';
  if (mins.some((m) => m < 0 || m > 10)) return 'Ngưỡng phải trong khoảng 0–10';
  if (bands.some((b) => !b.label.trim())) return 'Nhãn xếp loại không được để trống';
  return null;
}
