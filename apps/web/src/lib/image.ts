/** Nén ảnh ở trình duyệt về tối đa `max` px, JPEG — giảm dung lượng R2 và thời gian tải lên bằng 4G. */
export async function compressImage(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.85));
}

export const fileUrl = (id: number) => `/api/v1/files/${id}/content`;
