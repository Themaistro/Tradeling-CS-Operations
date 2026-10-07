import { BadgeCheck, ClipboardList, Mail, MailOpen, MessageCircle, MessagesSquare, Phone, RotateCcw, Star, TicketCheck, type LucideIcon } from "lucide-react";

type IconRule = { match: RegExp; icon: LucideIcon; tone: string; emoji: string };

const rules: IconRule[] = [
  { match: /call/i, icon: Phone, tone: "bg-emerald-50 text-emerald-700", emoji: "☎️" },
  { match: /slack|group|channel|support/i, icon: MessagesSquare, tone: "bg-violet-50 text-violet-700", emoji: "💬" },
  { match: /chat/i, icon: MessageCircle, tone: "bg-blue-50 text-blue-700", emoji: "💬" },
  { match: /open email/i, icon: MailOpen, tone: "bg-cyan-50 text-cyan-700", emoji: "📨" },
  { match: /stakeholder|email/i, icon: Mail, tone: "bg-sky-50 text-sky-700", emoji: "✉️" },
  { match: /return|escalation/i, icon: RotateCcw, tone: "bg-orange-50 text-orange-700", emoji: "↩️" },
  { match: /internal|ticket/i, icon: TicketCheck, tone: "bg-indigo-50 text-indigo-700", emoji: "🎫" },
  { match: /verification/i, icon: BadgeCheck, tone: "bg-teal-50 text-teal-700", emoji: "✅" },
  { match: /review/i, icon: Star, tone: "bg-amber-50 text-amber-700", emoji: "⭐" },
];

function ruleFor(name: string) {
  return rules.find((rule) => rule.match.test(name)) ?? { icon: ClipboardList, tone: "bg-slate-100 text-slate-600", emoji: "📋" };
}

export function TaskIcon({ name, className = "h-9 w-9" }: { name: string; className?: string }) {
  const rule = ruleFor(name);
  const Icon = rule.icon;
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-lg ${rule.tone} ${className}`}><Icon className="h-4 w-4" /></span>;
}

export function taskEmoji(name: string) {
  return ruleFor(name).emoji;
}
