import { Bell, Clock3, Database, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

const groups = [{ title: "Shift rules", description: "Define shifts, coverage, and workload targets.", icon: Clock3 }, { title: "Slack connection", description: "Configure tokens, channel, posting time, and timezone.", icon: Bell }, { title: "Security", description: "Manage the single administrator account and session settings.", icon: ShieldCheck }, { title: "Data and imports", description: "Import records from the two existing tools and manage backups.", icon: Database }];

export default function SettingsPage() {
  return <div className="mx-auto max-w-7xl"><PageHeading eyebrow="Configuration" title="Settings" description="Keep application, scheduling, Slack, security, and migration settings in one place." /><div className="grid gap-4 md:grid-cols-2">{groups.map(({ title, description, icon: Icon }) => <button key={title} className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-orange-50 group-hover:text-orange-500"><Icon className="h-5 w-5" /></div><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></button>)}</div></div>;
}
