import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const statusLabels: Record<string, string> = {
  OFF: "OFF",
  PTO: "Annual leave",
  ANNUAL_LEAVE: "Annual leave",
  EMERGENCY_LEAVE: "Emergency leave",
  COMP_OFF: "Comp off",
  PUBLIC_HOLIDAY: "Public holiday",
  SICK: "Sick leave",
  UNPAID_LEAVE: "Unpaid leave",
  OTHER_LEAVE: "Other leave",
};

function displayTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const shown = hour % 12 || 12;
  return `${shown}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const includeTasks = url.searchParams.get("includeTasks") === "true";
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Choose a valid month." }, { status: 400 });
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const [period, breaks, tasks] = await Promise.all([
    prisma.schedulePeriod.findUnique({
      where: { year_month: { year, month } },
      include: { assignments: { include: { employee: true, shift: true }, orderBy: [{ employee: { name: "asc" } }, { date: "asc" }] } },
    }),
    prisma.breakSchedule.findMany({ where: { date: { gte: start, lt: end } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
    includeTasks
      ? prisma.taskAssignment.findMany({ where: { date: { gte: start, lt: end } }, include: { employee: true, category: true }, orderBy: [{ date: "asc" }, { employee: { name: "asc" } }, { category: { order: "asc" } }] })
      : Promise.resolve([]),
  ]);
  if (!period) return NextResponse.json({ error: "Generate the schedule before downloading it." }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tradeling CS Operations";
  workbook.created = new Date();
  const roster = workbook.addWorksheet("Monthly roster", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  roster.properties.defaultRowHeight = 22;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = Array.from({ length: daysInMonth }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1)));
  const monthName = start.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

  roster.mergeCells(1, 1, 1, dates.length + 1);
  const title = roster.getCell(1, 1);
  title.value = `Customer Service Schedule — ${monthName}`;
  title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
  title.alignment = { horizontal: "left", vertical: "middle" };
  roster.getRow(1).height = 32;

  roster.getCell(2, 1).value = "Name";
  roster.getCell(3, 1).value = "";
  dates.forEach((date, index) => {
    const column = index + 2;
    roster.getCell(2, column).value = date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
    roster.getCell(3, column).value = date;
    roster.getCell(3, column).numFmt = "m/d/yyyy";
  });
  for (const rowNumber of [2, 3]) {
    const row = roster.getRow(rowNumber);
    row.font = { bold: true, color: { argb: "FF172033" } };
    row.alignment = { horizontal: "center", vertical: "middle" };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowNumber === 2 ? "FFF1C7C7" : "FFC6E0B4" } };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
  }

  const employees = Array.from(new Map(period.assignments.map((item) => [item.employee.id, item.employee])).values()).sort((left, right) => left.name.localeCompare(right.name));
  employees.forEach((employee, employeeIndex) => {
    const row = roster.getRow(employeeIndex + 4);
    row.getCell(1).value = employee.name;
    row.getCell(1).font = { bold: true };
    dates.forEach((date, dateIndex) => {
      const key = dateKey(date);
      const assignment = period.assignments.find((item) => item.employeeId === employee.id && dateKey(item.date) === key);
      const employeeBreaks = breaks.filter((item) => item.employeeId === employee.id && dateKey(item.date) === key);
      const cell = row.getCell(dateIndex + 2);
      if (!assignment || assignment.status !== "WORKING") {
        cell.value = statusLabels[assignment?.status ?? "OFF"] ?? assignment?.status ?? "OFF";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: assignment?.status && assignment.status !== "OFF" ? "FFE4D9F2" : "FFF8CB9C" } };
      } else {
        const location = assignment.workLocation === "WFH" ? "WFH " : "";
        const shift = assignment.shift ? `${displayTime(assignment.shift.startTime)}–${displayTime(assignment.shift.endTime)}` : "Working";
        const breakText = employeeBreaks.map((item) => `${item.type === "MAIN" ? "Break" : "Short break"} ${displayTime(item.startTime)}–${displayTime(item.endTime)}`).join("\n");
        cell.value = `${location}${shift}${breakText ? `\n${breakText}` : ""}`;
        const late = assignment.shift ? assignment.shift.startTime >= "12:00" : false;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: late ? "FFCFE2F3" : assignment.workLocation === "WFH" ? "FFD9EAD3" : "FFF4CCCC" } };
      }
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
    row.height = 54;
  });
  roster.getColumn(1).width = 24;
  for (let index = 2; index <= dates.length + 1; index += 1) roster.getColumn(index).width = 19;
  roster.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: dates.length + 1 } };
  roster.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  roster.headerFooter.oddFooter = "&LTradeling CS Operations&CPage &P of &N&RGenerated &D";

  if (includeTasks) {
    const taskSheet = workbook.addWorksheet("Daily tasks", { views: [{ state: "frozen", ySplit: 1 }] });
    taskSheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Agent", key: "agent", width: 24 },
      { header: "Task", key: "task", width: 34 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Time", key: "time", width: 22 },
      { header: "Notes", key: "notes", width: 42 },
    ];
    tasks.forEach((task) => taskSheet.addRow({
      date: task.date,
      agent: task.employee.name,
      task: task.category.name,
      priority: `P${task.priority}`,
      time: task.startTime && task.endTime ? `${displayTime(task.startTime)}–${displayTime(task.endTime)}` : "",
      notes: task.note ?? "",
    }));
    taskSheet.getColumn("date").numFmt = "m/d/yyyy";
    taskSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    taskSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
    taskSheet.getRow(1).alignment = { vertical: "middle" };
    taskSheet.autoFilter = { from: "A1", to: "F1" };
    taskSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      row.alignment = { vertical: "top", wrapText: true };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = includeTasks ? "-with-tasks" : "";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cs-schedule-${year}-${String(month).padStart(2, "0")}${suffix}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
