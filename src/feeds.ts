import { XMLParser } from "fast-xml-parser";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EngageEvent {
  eventId: string;
  title: string;
  date: string;
  time: string;
  sortDate: string; // ISO 8601 for sorting/filtering
  location: string;
  group: string;
  eventType: string;
  category: string;
  foodProvided: boolean;
  description: string;
  link: string;
}

export interface EngageGroup {
  name: string;
  groupType: string;
  category: string;
  mission: string;
  link: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EVENTS_URL = "https://engage.babson.edu/rss_events";
const GROUPS_URL = "https://engage.babson.edu/rss_groups";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Category mapping from Python agent (18 types -> 7 categories)
const TYPE_TO_CATEGORY: Record<string, string> = {
  "Workshop": "CAREER",
  "CCD Event": "CAREER",
  "Information Session": "CAREER",
  "Guest Speaker": "INDUSTRY",
  "Panel Discussion": "INDUSTRY",
  "Lecture": "INDUSTRY",
  "Conference": "INDUSTRY",
  "Social": "SOCIAL",
  "Networking": "SOCIAL",
  "Competition": "ENTREPRENEURSHIP",
  "Pitch Event": "ENTREPRENEURSHIP",
  "Hackathon": "ENTREPRENEURSHIP",
  "Community Service": "COMMUNITY",
  "Fundraiser": "COMMUNITY",
  "Meeting": "COMMUNITY",
  "Cultural": "CULTURAL",
  "Performance": "CULTURAL",
  "Announcement": "ANNOUNCEMENT",
};

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let eventsCache: CacheEntry<EngageEvent[]> | null = null;
let groupsCache: CacheEntry<EngageGroup[]> | null = null;

function isFresh<T>(entry: CacheEntry<T> | null): boolean {
  return entry !== null && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// ── XML Parser ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

// ── Strip HTML ───────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#xD;/g, "")
    .replace(/&#xA;/g, "\n")
    .replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Fetch Events ─────────────────────────────────────────────────────────────

export async function fetchEvents(): Promise<EngageEvent[]> {
  if (isFresh(eventsCache)) return eventsCache!.data;

  const res = await fetch(EVENTS_URL, {
    headers: { "User-Agent": "BabsonEngageMCP/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (eventsCache !== null) return eventsCache.data; // stale fallback
    throw new Error(`Events RSS returned ${res.status}`);
  }

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = normalizeItems(parsed?.rss?.channel?.item);

  const events: EngageEvent[] = items.map((item: any) => {
    const eventType = str(item.eventType);
    return {
      eventId: str(item.eventId),
      title: str(item.title),
      date: str(item.eventDate),
      time: str(item.eventTime),
      sortDate: toIso(item.eventStartDateTime || item.eventDate),
      location: str(item.eventLocation),
      group: str(item.group),
      eventType,
      category: TYPE_TO_CATEGORY[eventType] || "OTHER",
      foodProvided: str(item.foodProvided).toLowerCase() === "true",
      description: stripHtml(str(item.description)),
      link: str(item.link),
    };
  });

  events.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  eventsCache = { data: events, fetchedAt: Date.now() };
  return events;
}

// ── Fetch Groups ─────────────────────────────────────────────────────────────

export async function fetchGroups(): Promise<EngageGroup[]> {
  if (isFresh(groupsCache)) return groupsCache!.data;

  const res = await fetch(GROUPS_URL, {
    headers: { "User-Agent": "BabsonEngageMCP/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (groupsCache !== null) return groupsCache.data;
    throw new Error(`Groups RSS returned ${res.status}`);
  }

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = normalizeItems(parsed?.rss?.channel?.item);

  const groups: EngageGroup[] = items
    .filter((item: any) => {
      const status = str(item.groupStatus).toLowerCase();
      return status !== "deleted" && status !== "hidden";
    })
    .map((item: any) => {
      const mission = stripHtml(str(item.mission));
      return {
        name: str(item.groupName),
        groupType: str(item.groupType),
        category: str(item.category),
        mission: mission.length > 200 ? mission.slice(0, 197) + "..." : mission,
        link: str(item.groupLink),
      };
    });

  groups.sort((a, b) => a.name.localeCompare(b.name));

  groupsCache = { data: groups, fetchedAt: Date.now() };
  return groups;
}

// ── Fetch iCal Past Events ───────────────────────────────────────────────────

const ICAL_URL = "https://engage.babson.edu/ical/babsongrad/ical_babsongrad.ics";

export interface ICalEvent {
  title: string;
  date: string;
  sortDate: string;
  location: string;
  organizer: string;
  category: string;
  link: string;
}

let icalCache: CacheEntry<ICalEvent[]> | null = null;

export async function fetchPastEvents(): Promise<ICalEvent[]> {
  if (isFresh(icalCache)) return icalCache!.data;

  const res = await fetch(ICAL_URL, {
    headers: { "User-Agent": "BabsonEngageMCP/1.0" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    if (icalCache !== null) return icalCache.data;
    throw new Error(`iCal feed returned ${res.status}`);
  }

  const text = await res.text();
  const blocks = text.split("BEGIN:VEVENT").slice(1);

  const seen = new Set<string>();
  const events: ICalEvent[] = [];

  for (const block of blocks) {
    const title = icalField(block, "SUMMARY") || "Untitled";
    const dtstart = icalField(block, "DTSTART");
    const url = icalField(block, "URL");
    const location = icalField(block, "LOCATION") || "TBD";
    const organizer = icalField(block, "ORGANIZER") || "";
    const category = icalField(block, "X-CG-CATEGORY") || "";

    if (!dtstart) continue;

    // Dedupe by URL
    const key = url || `${title}-${dtstart}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sortDate = icalDateToIso(dtstart);
    const displayDate = formatICalDate(dtstart);

    events.push({
      title,
      date: displayDate,
      sortDate,
      location: location.replace(/\\,/g, ",").replace(/\\\\/g, "\\"),
      organizer: organizer.replace(/^mailto:/i, "").replace(/\\,/g, ","),
      category: category || "Uncategorized",
      link: url || "",
    });
  }

  events.sort((a, b) => b.sortDate.localeCompare(a.sortDate)); // newest first

  icalCache = { data: events, fetchedAt: Date.now() };
  return events;
}

function icalField(block: string, field: string): string {
  // Handle folded lines (RFC 5545: continuation lines start with space/tab)
  const unfolded = block.replace(/\r?\n[ \t]/g, "");
  const regex = new RegExp(`^${field}[^:]*:(.*)$`, "m");
  const match = unfolded.match(regex);
  return match ? match[1].trim() : "";
}

function icalDateToIso(dt: string): string {
  // Format: 20260407T120000Z or 20260407T120000
  const clean = dt.replace(/[^0-9T]/g, "");
  if (clean.length >= 15) {
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    const h = clean.slice(9, 11);
    const min = clean.slice(11, 13);
    return `${y}-${m}-${d}T${h}:${min}:00`;
  }
  if (clean.length >= 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00`;
  }
  return dt;
}

function formatICalDate(dt: string): string {
  const iso = icalDateToIso(dt);
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeItems(items: unknown): any[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toIso(dateStr: string): string {
  if (!dateStr) return "";
  // Handle ISO 8601 directly
  if (dateStr.includes("T")) return dateStr;
  // Handle MM/DD/YYYY format from Engage
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`;
  }
  return dateStr;
}
