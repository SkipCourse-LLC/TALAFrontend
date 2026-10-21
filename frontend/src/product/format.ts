export function meetingTime(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  const options = { dateStyle: "medium", timeStyle: "short" } as const;
  const end =
    starts.toDateString() === ends.toDateString()
      ? ends.toLocaleTimeString([], { timeStyle: "short" })
      : ends.toLocaleString([], options);
  return `${starts.toLocaleString([], options)} – ${end}`;
}
