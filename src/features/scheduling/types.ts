export type ScheduleEmployee = {
  id: string;
  name: string;
  preferredShiftId: string | null;
  isBilingual: boolean;
  accountIds: string[];
  dayOffPreferences: { dayOfWeek: number; rank: number }[];
  timeOff: { date: string; type: "PTO" | "ANNUAL_LEAVE" | "EMERGENCY_LEAVE" | "COMP_OFF" | "PUBLIC_HOLIDAY" | "SICK" | "UNPAID" | "OTHER" | "UNPAID_LEAVE" | "OTHER_LEAVE" }[];
};

export type ScheduleShift = {
  id: string;
  name: string;
  startTime: string;
  minimumByDay: Record<number, number>;
  bilingualByDay: Record<number, number>;
  requiredAccountIdsByDay: Record<number, string[]>;
};

export type GeneratedAssignment = {
  employeeId: string;
  date: string;
  status: "WORKING" | "OFF" | "PTO" | "ANNUAL_LEAVE" | "EMERGENCY_LEAVE" | "COMP_OFF" | "PUBLIC_HOLIDAY" | "SICK" | "UNPAID_LEAVE" | "OTHER_LEAVE";
  shiftId: string | null;
};

export type ScheduleWarning = {
  date: string;
  shiftId: string;
  severity: "warning" | "critical";
  code: "STAFF_SHORTAGE" | "BILINGUAL_SHORTAGE" | "REST_PATTERN_OVERRIDE";
  message: string;
};
