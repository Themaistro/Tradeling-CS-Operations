import { CalendarDays, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page-heading";

export default function SchedulePage() {
  return <div className="mx-auto max-w-7xl"><PageHeading eyebrow="Workforce planning" title="Schedule Generator" description="Build monthly shift schedules using staffing requirements, preferred days off, PTO, and language coverage." action={<button className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-200"><Plus className="h-4 w-4" /> Generate schedule</button>} /><EmptyState icon={CalendarDays} title="No schedule generated yet" description="Add team members and shift rules first, then generate the first monthly schedule." action="Configure shifts" /></div>;
}
