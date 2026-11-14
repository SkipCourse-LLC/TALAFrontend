import type {
  CalendarCategory,
  CalendarClass,
} from "../../api/calendarContract";

/** One item on the student calendar: a class, a saved meeting or a goal due date. */
export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  category: CalendarCategory;
  allDay: boolean;
  kind: "class" | "meeting" | "goal";
  enrolled?: boolean;
  course?: CalendarClass;
};
