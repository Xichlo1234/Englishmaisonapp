import { createApp } from './app';
import type { Bindings } from './env';
import { getDb } from './db/client';
import { generateLessonsForOpenClasses } from './services/schedule.service';

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Triggers (giờ UTC) — xem wrangler.jsonc. */
  async scheduled(controller, env, ctx) {
    const db = getDb(env.DB);
    switch (controller.cron) {
      case '0 17 * * *': // 00:00 giờ Việt Nam
        ctx.waitUntil(
          generateLessonsForOpenClasses(db).then((n) => console.log(`cron: đã sinh buổi học cho ${n} lớp`)),
        );
        break;
      default:
        console.warn('cron không xác định', controller.cron);
    }
  },
} satisfies ExportedHandler<Bindings>;
