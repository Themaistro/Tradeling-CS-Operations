"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Loader2, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to sign in."); setLoading(false); return; }
    router.replace("/overview"); router.refresh();
  }

  return <main className="grid min-h-screen bg-[#f4f6fb] lg:grid-cols-[1.05fr_0.95fr]"><section className="hidden overflow-hidden bg-slate-950 p-14 text-white lg:flex lg:flex-col lg:justify-between"><div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500"><CalendarDays className="h-6 w-6" /></div><p className="mt-5 text-lg font-bold">Tradeling CS Operations</p></div><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-400">One connected workflow</p><h1 className="mt-5 text-5xl font-bold leading-[1.08] tracking-tight">Plan the month.<br />Run the day.<br />Keep Slack aligned.</h1><p className="mt-6 max-w-lg text-base leading-7 text-slate-400">Scheduling, task assignments, breaks, team availability, and Slack delivery in one organized workspace.</p></div><p className="text-xs text-slate-600">Customer Service Operations</p></section><section className="flex items-center justify-center p-6 md:p-12"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 md:p-10"><div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500"><LockKeyhole className="h-5 w-5" /></div><h2 className="text-3xl font-bold tracking-tight text-slate-950">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to manage schedules and daily operations.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Username</span><input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-50" /></label><label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Password</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-50" /></label>{error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}<button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}</button></form></div></section></main>;
}
