export type ScheduleEmployee = {
  id: string;
  name: string;
  preferredShiftId: string | null;
  isBilingual: boolean;
  daysOff: number[];
  timeOff: string[];
};

export type ScheduleShift = {
  id: string;
  name: string;
  minimumByDay: Record<number, number>;
  bilingualByDay: Record<number, number>;
};

export type GeneratedAssignment = {
  employeeId: string;
  date: string;
  status: "WORKING" | "OFF" | "PTO";
  shiftId: string | null;
};

export type ScheduleWarning = {
  date: string;
  shiftId: string;
  message: string;
};
