import { api } from '@/lib/api';

export interface FileRef {
  id: number;
  mimeType: string;
  name: string;
}
export interface ClassPost {
  id: number;
  classId: number;
  className: string;
  postDate: string;
  content: string;
  author: string;
  createdAt: string;
  photos: FileRef[];
  canDelete: boolean;
}
export interface HomeworkListItem {
  id: number;
  title: string;
  assignedDate: string;
  dueDate: string;
  author: string;
  roster: number;
  submitted: number;
  done: number;
}
export interface HomeworkStudentRow {
  studentId: number;
  fullName: string;
  studentCode: string;
  submittedAt: string | null;
  submittedBy: string | null;
  note: string | null;
  photos: FileRef[];
  result: 'DONE' | 'NOT_DONE' | null;
  teacherComment: string | null;
  reviewedAt: string | null;
}
export interface HomeworkDetail {
  id: number;
  classId: number;
  className: string;
  title: string;
  description: string | null;
  assignedDate: string;
  dueDate: string;
  author: string;
  attachments: FileRef[];
  canManage: boolean;
  canDelete: boolean;
  students: HomeworkStudentRow[];
}

const multipart = (fields: Record<string, string>, files: Blob[]) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  files.forEach((b, i) => f.append('files', b, b instanceof File ? b.name : `anh-${i + 1}.jpg`));
  return f;
};

export const classroomKeys = {
  posts: (classId: number) => ['classroom', 'posts', classId] as const,
  noPhoto: (classId: number) => ['classroom', 'no-photo', classId] as const,
  homework: (classId: number) => ['classroom', 'homework', classId] as const,
  homeworkDetail: (id: number) => ['classroom', 'homework-detail', id] as const,
};

export const classroomApi = {
  posts: (classId: number) => api<{ data: ClassPost[] }>(`/classes/${classId}/posts`, { query: { limit: 30 } }),
  noPhotoStudents: (classId: number) => api<{ data: { id: number; fullName: string }[] }>(`/classes/${classId}/no-photo-students`),
  createPost: (classId: number, content: string, postDate: string, photos: Blob[]) =>
    api<{ id: number }>(`/classes/${classId}/posts`, { form: multipart({ content, postDate }, photos) }),
  deletePost: (id: number) => api(`/class-posts/${id}`, { method: 'DELETE' }),
  homework: (classId: number) => api<{ data: HomeworkListItem[] }>(`/classes/${classId}/homework`),
  createHomework: (classId: number, body: { title: string; description: string; dueDate: string }, files: Blob[]) =>
    api<{ id: number }>(`/classes/${classId}/homework`, { form: multipart(body, files) }),
  homeworkDetail: (id: number) => api<HomeworkDetail>(`/homework/${id}`),
  review: (id: number, body: { studentId: number; result: 'DONE' | 'NOT_DONE'; comment: string | null }) => api(`/homework/${id}/review`, { body }),
  deleteHomework: (id: number) => api(`/homework/${id}`, { method: 'DELETE' }),
};
