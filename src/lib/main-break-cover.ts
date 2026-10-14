type Worker = { employeeId: string; shift: { startTime: string; endTime: string } | null; employee?: { isBilingual: boolean } };
type Account = { id: string; employeeCapabilities: { employeeId: string }[]; coverageRequirements: { dayOfWeek: number; startTime: string; endTime: string; minimumBilingual: number }[] };
type Break = { employeeId: string; startTime: string; endTime: string };
export function mainBreakCover(ownerId: string, start: string, end: string, weekday: number, workers: Worker[], breaks: Break[], accounts: Account[]) {
  const available = workers.filter(w => w.employeeId !== ownerId && w.shift && w.shift.startTime <= start && w.shift.endTime >= end && !breaks.some(b => b.employeeId === w.employeeId && b.startTime < end && b.endTime > start));
  const relevant = accounts.filter(a => a.employeeCapabilities.some(c => c.employeeId === ownerId) && a.coverageRequirements.some(r => r.dayOfWeek === weekday && r.startTime < end && r.endTime > start));
  for (const account of relevant) {
    const eligible = available.filter(w => account.employeeCapabilities.some(c => c.employeeId === w.employeeId));
    const languageMinimum = Math.max(0, ...account.coverageRequirements.filter(r => r.dayOfWeek === weekday && r.startTime < end && r.endTime > start).map(r => r.minimumBilingual));
    if (!eligible.length || eligible.filter(w => w.employee?.isBilingual).length < languageMinimum) return null;
  }
  return available.find(w => relevant.every(a => a.employeeCapabilities.some(c => c.employeeId === w.employeeId)))?.employeeId ?? null;
}
