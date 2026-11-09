export function seatSummary({ activeUsers, reservedSeats, maxActiveUsers }) {
  const occupied = `${activeUsers} active · ${reservedSeats} reserved`;
  if (maxActiveUsers === null) return occupied;
  const available = Math.max(0, maxActiveUsers - activeUsers - reservedSeats);
  return `${occupied} · ${available} available · ${maxActiveUsers} seats`;
}
