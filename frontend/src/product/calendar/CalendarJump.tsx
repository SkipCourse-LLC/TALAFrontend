import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "../../shared/Icon";
import {
  addCalendarDays,
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
  // The day the keyboard is on; arrow keys move it, Enter picks it.
  const [cursor, setCursor] = useState(value);
  const grid = useRef<HTMLDivElement>(null);
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

  // Keep keyboard focus on the cursor's day (or its week row).
  useLayoutEffect(() => {
    if (!open) return;
    grid.current
      ?.querySelector<HTMLElement>(`[data-key="${cursor}"]`)
      ?.focus({ preventScroll: true });
  }, [open, cursor, month]);

  function moveCursor(next: string) {
    setCursor(next);
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
  }
  function gridKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> =
      mode === "week"
        ? { ArrowUp: -7, ArrowLeft: -7, ArrowDown: 7, ArrowRight: 7 }
        : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | undefined;
    if (event.key in steps) next = addCalendarDays(cursor, steps[event.key]!);
    else if (event.key === "PageUp") next = shiftCalendarMonth(cursor, -1);
    else if (event.key === "PageDown") next = shiftCalendarMonth(cursor, 1);
    else if (mode === "day" && event.key === "Home")
      next = calendarWeekDays(cursor)[0];
    else if (mode === "day" && event.key === "End")
      next = calendarWeekDays(cursor)[6];
    if (!next) return;
    event.preventDefault();
    moveCursor(next);
  }

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
          if (!open) {
            setMonth(value.slice(0, 7));
            setCursor(value);
          }
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
              onClick={() => moveCursor(shiftCalendarMonth(cursor, -1))}
            >
              <Icon name="chevron-left" />
            </button>
            <strong aria-live="polite">{calendarMonthLabel(month)}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => moveCursor(shiftCalendarMonth(cursor, 1))}
            >
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="tala-jump-weekdays" aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={index}>{day}</span>
            ))}
          </div>
          <p className="tala-cal-sr" id={`${popupId}-keys`}>
            {mode === "week"
              ? "Arrow keys move between weeks. Page Up and Page Down change month. Enter chooses."
              : "Arrow keys move between days. Page Up and Page Down change month. Enter chooses."}
          </p>
          <div
            className="tala-jump-rows"
            ref={grid}
            onKeyDown={gridKeys}
            aria-describedby={`${popupId}-keys`}
          >
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
                  data-key={row.includes(cursor) ? cursor : row[0]}
                  tabIndex={row.includes(cursor) ? 0 : -1}
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
                      data-key={day}
                      tabIndex={day === cursor ? 0 : -1}
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
