// Build an iCalendar (.ics) feed from the Joana events so they can be
// subscribed/imported on the iPhone (secção 18). Pure and testable.

export interface IcsEvent {
  id: string;
  date: string; // ISO yyyy-mm-dd
  type: string;
  client_name: string | null;
  location?: string | null;
  notes?: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold long lines to 75 octets with CRLF + space (RFC 5545). */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) {
    parts.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

/** Build the full .ics document. `stamp` is an ISO datetime (for DTSTAMP). */
export function buildICS(events: IcsEvent[], stamp: string): string {
  const dt = new Date(stamp);
  const dtstamp = `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Contas a Dois//Eventos//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Eventos Joana",
  ];

  for (const ev of events) {
    const ymd = ev.date.slice(0, 10).replace(/-/g, "");
    const next = nextDay(ev.date);
    const title = [ev.client_name, ev.type].filter(Boolean).join(" · ") || "Evento";
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${ev.id}@contas-a-dois`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${ymd}`);
    lines.push(`DTEND;VALUE=DATE:${next}`);
    lines.push(fold(`SUMMARY:${esc(title)}`));
    if (ev.location) lines.push(fold(`LOCATION:${esc(ev.location)}`));
    if (ev.notes) lines.push(fold(`DESCRIPTION:${esc(ev.notes)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}
