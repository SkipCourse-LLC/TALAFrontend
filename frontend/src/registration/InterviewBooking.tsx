
import { useId, useMemo, useState } from "react";
import "./interviewBooking.css";

export type InterviewSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  label?: string;
  isAvailable?: boolean;
};

type Props = {
  slots: InterviewSlot[];
  onBook: (slotId: string) => Promise<void>;
  pending?: boolean;
  disabled?: boolean;
};

const zone = "America/Phoenix";

const weekdays = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
];

function dayKey(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));

  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function InterviewBooking({
  slots,
  onBook,
  pending = false,
  disabled = false,
}: Props) {
  const headingId = useId();

  const [selectedDay, setSelectedDay] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");

  const available = useMemo(
    () =>
      slots
        .filter(
          (slot) =>
            slot.isAvailable !== false &&
            Date.parse(slot.startsAt) > Date.now()
        )
        .sort(
          (a, b) =>
            Date.parse(a.startsAt) -
            Date.parse(b.startsAt)
        ),
    [slots]
  );

  const today = dayKey(new Date().toISOString());

  const [viewedMonth, setViewedMonth] = useState(() => {
    const initial = available[0]
      ? dayKey(available[0].startsAt)
      : today;

    return new Date(`${initial.slice(0, 7)}-01T12:00:00`);
  });

  const availableDays = useMemo(
    () => new Set(
      available.map((slot) => dayKey(slot.startsAt))
    ),
    [available]
  );

  const year = viewedMonth.getFullYear();
  const month = viewedMonth.getMonth();

  const monthKey =
    `${year}-${String(month + 1).padStart(2, "0")}`;

  const firstDay = new Date(year, month, 1).getDay();

  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  const calendarCells = Array.from(
    {
      length: Math.ceil(
        (firstDay + daysInMonth) / 7
      ) * 7,
    },
    (_, index) => {
      const day = index - firstDay + 1;

      return day > 0 && day <= daysInMonth
        ? day
        : null;
    }
  );

  const monthTitle = viewedMonth.toLocaleDateString(
    "en-US",
    {
      month: "long",
      year: "numeric",
    }
  );

  const activeDay =
    selectedDay.startsWith(monthKey) &&
    availableDays.has(selectedDay)
      ? selectedDay
      : "";

  const daySlots = available.filter(
    (slot) => dayKey(slot.startsAt) === activeDay
  );

  const chosen = daySlots.find(
    (slot) => slot.id === selectedSlot
  );

  function changeMonth(direction: number) {
    setViewedMonth(
      new Date(year, month + direction, 1, 12)
    );

    setSelectedDay("");
    setSelectedSlot("");
  }

  async function confirm() {
    if (!chosen || pending || disabled) return;

    await onBook(chosen.id);
  }

  return (
    <section
      className="interview-booking"
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>
        Schedule an Interview with Tina
      </h3>

      <p className="tala-booking-description">
        Select an available date and time.
        All times are in Phoenix, Arizona (MST).
      </p>

      <div className="tala-booking-layout">

        {/* Monthly calendar */}
        <div className="tala-calendar">

          <div className="tala-calendar-header">
            <button
              type="button"
              aria-label="Previous month"
              disabled={
                pending ||
                disabled ||
                monthKey <= today.slice(0, 7)
              }
              onClick={() => changeMonth(-1)}
            >
              &#8249;
            </button>

            <h4 aria-live="polite">{monthTitle}</h4>

            <button
              type="button"
              aria-label="Next month"
              disabled={pending || disabled}
              onClick={() => changeMonth(1)}
            >
              &#8250;
            </button>
          </div>

          <div className="tala-calendar-grid">

            {weekdays.map((day) => (
              <div
                key={day}
                className="tala-calendar-weekday"
              >
                {day}
              </div>
            ))}

            {calendarCells.map((day, index) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="tala-calendar-empty"
                  />
                );
              }

              const dateKey =
                `${monthKey}-${String(day).padStart(2, "0")}`;

              const isAvailable =
                availableDays.has(dateKey);

              const isSelected =
                activeDay === dateKey;

              return (
                <button
                  key={dateKey}
                  type="button"
                  aria-label={dateKey}
                  aria-pressed={isSelected}
                  disabled={
                    !isAvailable || pending || disabled
                  }
                  className={[
                    "tala-calendar-day",
                    isAvailable ? "available" : "",
                    isSelected ? "selected" : "",
                    dateKey === today ? "today" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedDay(dateKey);
                    setSelectedSlot("");
                  }}
                >
                  {day}
                </button>
              );
            })}

          </div>

          <div className="tala-calendar-legend">
            <span>
              <i className="legend-available" />
              Available
            </span>

            <span>
              <i className="legend-unavailable" />
              Unavailable
            </span>
          </div>

          {available.length === 0 && (
            <p role="status">
              No interview times are currently available.
              Please check back later.
            </p>
          )}

        </div>

        {/* Available appointment times */}
        <div className="tala-booking-panel">

          <h4>
            {daySlots[0]
              ? formatDate(daySlots[0].startsAt)
              : "Choose a date"}
          </h4>

          {!activeDay ? (
            <p className="tala-booking-placeholder">
              Select a highlighted date on the calendar
              to view available interview times.
            </p>
          ) : (
            <>
              <p>Available times</p>

              <div className="tala-booking-times">
                {daySlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={pending || disabled}
                    aria-pressed={
                      selectedSlot === slot.id
                    }
                    className={
                      selectedSlot === slot.id
                        ? "selected"
                        : ""
                    }
                    onClick={() =>
                      setSelectedSlot(slot.id)
                    }
                  >
                    {formatTime(slot.startsAt)}
                  </button>
                ))}
              </div>
            </>
          )}

          {chosen && (
            <div className="tala-booking-summary">
              <strong>Selected interview</strong>

              <p>{formatDate(chosen.startsAt)}</p>

              <p>
                {formatTime(chosen.startsAt)}
                {" – "}
                {formatTime(chosen.endsAt)}
                {" MST"}
              </p>
            </div>
          )}

          <button
            className="button tala-confirm-interview"
            type="button"
            disabled={!chosen || pending || disabled}
            onClick={() => void confirm()}
          >
            {pending ? "Please wait..." : "Review Application"}
          </button>

        </div>
      </div>
    </section>
  );
}