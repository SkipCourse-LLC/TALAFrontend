import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import {
  calendarDayLabel,
  calendarMonthDays,
  calendarMonthLabel,
  calendarWeekDays,
  calendarWeekTitle,
  civilDate,
  shiftCalendarMonth,
} from "./calendarDates";
import "./calendarJump.css";

type Props = {
  /** "week" picks a whole week row; "day" picks one day. */
  mode: "week" | "day";
  /** The selected day (YYYY-MM-DD); in week mode, any day of the week. */
  value: string;
  today: string;
  onPick: (day: string) => void;
};

/**
 * The calendar's date picker, drawn like the calendar itself. In Week view
 * each week is one selectable row; in Day view each day is a button.
 */
export function CalendarJump({ mode, value, today, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const week = calendarWeekDays(value);
  const days = calendarMonthDays(month);
  const rows = Array.from({ length: days.length / 7 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );

  // Close on a click outside or Escape; return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function pick(day: string) {
    onPick(day);
    setOpen(false);
    trigger.current?.focus();
  }

  const label =
    mode === "week"
      ? calendarWeekTitle(week[0]!, week[6]!)
      : calendarDayLabel(value, { weekday: "short", month: "short" });

  return (
    <div className="tala-jump" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="tala-jump-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={`${mode === "week" ? "Choose week" : "Choose day"}, showing ${label}`}
        onClick={() => {
          if (!open) setMonth(value.slice(0, 7));
          setOpen((current) => !current);
        }}
      >
        <Icon name="calendar" />
        {/* The title beside it already shows the date, so the button says
            what it does. */}
        <span>{mode === "week" ? "Choose week" : "Choose day"}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div
          className="tala-jump-popup"
          id={popupId}
          role="dialog"
          aria-label={mode === "week" ? "Choose a week" : "Choose a day"}
          data-mode={mode}
        >
          <div className="tala-jump-head">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setMonth(shiftCalendarMonth(`${month}-01`, -1).slice(0, 7))
              }
            >
              <Icon name="chevron-left" />
            </button>
            <strong aria-live="polite">{calendarMonthLabel(month)}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setMonth(shiftCalendarMonth(`${month}-01`, 1).slice(0, 7))
              }
            >
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="tala-jump-weekdays" aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={index}>{day}</span>
            ))}
          </div>
          <div className="tala-jump-rows">
            {rows.map((row) => {
              const selectedWeek = row.includes(week[0]!);
              const dayCells = row.map((day) => (
                <span
                  key={day}
                  className="tala-jump-day"
                  data-outside={!day.startsWith(month)}
                  data-today={day === today}
                >
                  {civilDate(day).getUTCDate()}
                </span>
              ));
              return mode === "week" ? (
                // One button per week: the whole row is the target.
                <button
                  type="button"
                  key={row[0]}
                  className="tala-jump-week"
                  aria-pressed={selectedWeek}
                  aria-label={`Week of ${calendarWeekTitle(row[0]!, row[6]!)}`}
                  onClick={() => pick(row[0]!)}
                >
                  {dayCells}
                </button>
              ) : (
                <div
                  key={row[0]}
                  className="tala-jump-week"
                  role="presentation"
                >
                  {row.map((day) => (
                    <button
                      type="button"
                      key={day}
                      className="tala-jump-day"
                      data-outside={!day.startsWith(month)}
                      data-today={day === today}
                      aria-pressed={day === value}
                      aria-label={calendarDayLabel(day, { year: "numeric" })}
                      onClick={() => pick(day)}
                    >
                      {civilDate(day).getUTCDate()}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="tala-jump-today"
            onClick={() => pick(today)}
          >
            {mode === "week" ? "This week" : "Today"}
          </button>
        </div>
      )}
    </div>
  );
}
