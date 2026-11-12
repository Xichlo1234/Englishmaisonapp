export const nowIso = (at: Date = new Date()) => at.toISOString();
export const addSeconds = (s: number, at: Date = new Date()) => new Date(at.getTime() + s * 1000).toISOString();
export const addDaysIso = (d: number, at: Date = new Date()) => addSeconds(d * 86400, at);
