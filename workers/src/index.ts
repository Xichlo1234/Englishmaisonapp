import { createApp } from './app';
import type { Bindings } from './env';
import { getDb } from './db/client';
import { generateLessonsForOpenClasses } from './services/schedule.service';
import { lockPastAttendance } from './services/attendance.service';

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Triggers (giờ UTC) — xem wrangler.jsonc. */
  async scheduled(controller, env, ctx) {
    const db = getDb(env.DB);
    switch (controller.cron) {
      case '0 17 * * *': // 00:00 giờ Việt Nam
        // 1) Khóa phiên điểm danh của các ngày đã qua  2) Sinh buổi học 8 tuần tới
        ctx.waitUntil(
          lockPastAttendance(db)
            .then((n) => console.log(`cron: đã khóa ${n} phiên điểm danh`))
            .then(() => generateLessonsForOpenClasses(db))
            .then((n) => console.log(`cron: đã sinh buổi học cho ${n} lớp`)),
        );
        break;
      default:
        console.warn('cron không xác định', controller.cron);
    }
  },
} satisfies ExportedHandler<Bindings>;
