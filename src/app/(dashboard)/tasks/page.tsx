import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page-heading";

export default function TasksPage() {
  return <div className="mx-auto max-w-7xl"><PageHeading eyebrow="Daily workflow" title="Daily Tasks" description="Assign task categories, notes, and breaks to the employees scheduled for a selected date." /><EmptyState icon={ClipboardList} title="Choose an approved schedule first" description="Once a monthly schedule is approved, the employees working on each date will appear here automatically." action="Open schedule" /></div>;
}
