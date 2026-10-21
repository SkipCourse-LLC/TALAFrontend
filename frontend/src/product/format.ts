export function meetingTime(startsAt: string, endsAt: string) {
  return `${new Date(startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} – ${new Date(endsAt).toLocaleTimeString([], { timeStyle: "short" })}`;
}
