import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatDateVN } from '@ecm/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/common/page';
import { gradeKeys, gradesApi, type StudentResult } from '@/services/grades';

const fmt = (v: number | null) => (v === null ? '—' : String(v).replace('.', ','));

export function StudentResultsTab({ studentId }: { studentId: number }) {
  const q = useQuery({ queryKey: gradeKeys.student(studentId), queryFn: () => gradesApi.studentResults(studentId).then((r) => r.data) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  if (!rows.length)
    return (
      <Card>
        <EmptyBlock title="Chưa có kết quả học tập" />
      </Card>
    );
  const withAvg = rows.filter((r) => r.average !== null);
  return (
    <div className="flex flex-col gap-4">
      {withAvg.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Tiến bộ điểm trung bình</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressChart points={withAvg} />
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead>
              <TableHead>Đợt đánh giá</TableHead>
              <TableHead>Điểm từng tiêu chí</TableHead>
              <TableHead className="text-center">TB</TableHead>
              <TableHead>Xếp loại</TableHead>
              <TableHead>Nhận xét</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...rows].reverse().map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{formatDateVN(r.assessedOn)}</TableCell>
                <TableCell>
                  <Link to={`/diem-so/${r.id}`} className="font-medium hover:text-primary">
                    {r.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.typeName} · {r.classCode}
                    {r.status === 'DRAFT' && (
                      <Badge variant="warning" className="ml-1.5">
                        Nháp
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {r.scores
                    .filter((s) => s.score !== null)
                    .map((s) => `${s.name} ${fmt(s.score)}${s.maxScore !== 10 ? `/${s.maxScore}` : ''}`)
                    .join(' · ')}
                </TableCell>
                <TableCell className="text-center font-semibold tabular-nums">{fmt(r.average)}</TableCell>
                <TableCell>{r.classification}</TableCell>
                <TableCell className="max-w-64 text-sm text-muted-foreground">{r.comment}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/** Biểu đồ đường một chuỗi (điểm TB thang 10). Một trục, lưới mờ, điểm ≥ 8px, chú thích khi rê/chạm. */
function ProgressChart({ points }: { points: StudentResult[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 16, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / 10) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.average!).toFixed(1)}`).join(' ');
  const h = hover !== null ? points[hover]! : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label="Biểu đồ điểm trung bình qua các đợt đánh giá">
        {[0, 2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {v}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />}
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.average!)} r={hover === i ? 6 : 4.5} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />
            {(i === 0 || i === points.length - 1 || points.length <= 6) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {formatDateVN(p.assessedOn).slice(0, 5)}
              </text>
            )}
            {/* vùng bắt rê chuột rộng hơn điểm */}
            <rect
              x={x(i) - Math.max(12, iw / points.length / 2)}
              y={pad.t}
              width={Math.max(24, iw / points.length)}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover(i)}
            />
          </g>
        ))}
        {/* nhãn trực tiếp cho điểm cuối */}
        <text x={x(points.length - 1)} y={y(points[points.length - 1]!.average!) - 10} textAnchor="end" className="fill-foreground text-[12px] font-semibold">
          {fmt(points[points.length - 1]!.average)}
        </text>
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: `${(x(hover!) / W) * 100}%`, top: 0 }}
        >
          <div className="font-medium">{h.title}</div>
          <div className="text-muted-foreground">{formatDateVN(h.assessedOn)}</div>
          <div>
            TB <b>{fmt(h.average)}</b> · {h.classification}
          </div>
        </div>
      )}
    </div>
  );
}
