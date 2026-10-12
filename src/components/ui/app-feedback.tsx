"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type Notification = { message: string; kind?: "success" | "error" | "info" };
type Confirmation = Notification & { title: string; confirmLabel?: string; destructive?: boolean; resolve: (approved: boolean) => void };

const notificationEvent = "cs:notification";
const confirmationEvent = "cs:confirmation";

export function showAppNotification(notification: Notification) {
  window.dispatchEvent(new CustomEvent(notificationEvent, { detail: notification }));
}

export function requestAppConfirmation(options: Omit<Confirmation, "resolve">) {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent(confirmationEvent, { detail: { ...options, resolve } }));
  });
}

export function AppFeedbackHost() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    const onNotification = (event: Event) => setNotification((event as CustomEvent<Notification>).detail);
    const onConfirmation = (event: Event) => setConfirmation((event as CustomEvent<Confirmation>).detail);
    window.addEventListener(notificationEvent, onNotification);
    window.addEventListener(confirmationEvent, onConfirmation);
    return () => {
      window.removeEventListener(notificationEvent, onNotification);
      window.removeEventListener(confirmationEvent, onConfirmation);
    };
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  const icon = notification?.kind === "error" ? <AlertTriangle className="h-5 w-5" /> : notification?.kind === "success" ? <CheckCircle2 className="h-5 w-5" /> : <Info className="h-5 w-5" />;
  const tone = notification?.kind === "error" ? "border-red-200 bg-red-50 text-red-900" : notification?.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-blue-200 bg-blue-50 text-blue-900";
  const close = (approved: boolean) => {
    confirmation?.resolve(approved);
    setConfirmation(null);
  };

  return <>
    {notification && <div role="status" className={`fixed right-5 top-24 z-[70] flex w-[min(28rem,calc(100vw-2.5rem))] gap-3 rounded-2xl border p-4 shadow-xl ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="flex-1 text-sm font-semibold leading-5">{notification.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={() => setNotification(null)} className="shrink-0 rounded-lg p-1 opacity-60 hover:bg-white/50 hover:opacity-100"><X className="h-4 w-4" /></button>
    </div>}
    {confirmation && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="app-confirmation-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <span className={`flex h-11 w-11 items-center justify-center rounded-full ${confirmation.destructive ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"}`}><AlertTriangle className="h-5 w-5" /></span>
        <h2 id="app-confirmation-title" className="mt-4 text-xl font-bold text-slate-950">{confirmation.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{confirmation.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => close(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => close(true)} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white ${confirmation.destructive ? "bg-red-600 hover:bg-red-700" : "bg-slate-950 hover:bg-slate-800"}`}>{confirmation.confirmLabel ?? "Continue"}</button>
        </div>
      </div>
    </div>}
  </>;
}
