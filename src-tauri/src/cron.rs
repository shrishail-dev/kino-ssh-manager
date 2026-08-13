//! Crontab reader/writer for the connected host (or the local machine).
//!
//! # Why the file is handled the way it is
//!
//! A crontab is somebody's automation. Losing a line of it is worse than any
//! amount of missing UI polish, so the whole design here is arranged around one
//! rule: **the panel never regenerates a crontab, it edits lines of one.**
//!
//! `cron_list` returns every line verbatim along with the indices of the lines
//! that parsed as jobs. The panel edits those indices and hands the entire line
//! list back to `cron_save`, which writes it out unchanged. Comments, blank
//! lines, `MAILTO=`, `PATH=`, `@reboot`, unusual spacing and anything this
//! parser simply doesn't understand all survive a round trip untouched, because
//! nothing ever rebuilds them.
//!
//! Two further guards:
//!
//! * The content travels base64-encoded in both directions. A crontab is
//!   arbitrary shell, and any scheme that pastes it into a command line - quotes,
//!   heredocs - eventually meets a crontab that breaks out of it.
//! * `cron_save` is a compare-and-swap. It re-reads the crontab on the host and
//!   refuses to write if it changed since the panel loaded it, so a `crontab -e`
//!   in another window can't be silently overwritten.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use crate::exec::{exec, transport};

/// Marks the start of the encoded payload. If the decoded blob doesn't begin
/// with this, `base64` was missing or broken on the host and what we're holding
/// is not the crontab - which must be an error, never an empty table. Showing an
/// empty table would invite the user to "save" it straight over their real one.
const SENTINEL: &str = "KINOSTART";

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CronJob {
    /// Index into `CronTable::lines`. The write path edits this one line.
    pub line: usize,
    /// The five fields, or an `@nickname`.
    pub schedule: String,
    pub command: String,
    /// False when the line is commented out - the usual way to park a job.
    pub enabled: bool,
    /// The `#` comment block immediately above, if any. Conventionally the only
    /// label a cron job has.
    pub comment: Option<String>,
    /// Plain English, e.g. "Every Tuesday at 04:00".
    pub description: String,
    /// Unix seconds, in the host's clock, of the next few runs. Empty for
    /// `@reboot` and for anything that can never fire (e.g. 30 February).
    pub next_runs: Vec<i64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CronTable {
    /// Every line of the crontab, verbatim and in order.
    pub lines: Vec<String>,
    pub jobs: Vec<CronJob>,
    /// `NAME=value` assignments, surfaced read-only for context - they change
    /// how every job below them runs.
    pub env: Vec<String>,
    /// Base64 of what was read, echoed back to `cron_save` as the CAS token.
    pub token: String,
    /// The host's clock at read time, so the panel can say "in 3 hours" against
    /// the host's idea of now rather than ours.
    pub host_now: i64,
    /// The host's UTC offset in minutes. Cron fires on host local time.
    pub host_offset_min: i32,
    /// True when the user has no crontab yet. Saving creates one.
    pub empty: bool,
}

// ── Schedule parsing ──────────────────────────────────────────────────────────

const MONTHS: [&str; 12] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
const DAYS: [&str; 7] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_NAMES: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

#[derive(Clone, Debug, PartialEq)]
struct Field {
    /// Sorted, de-duplicated matching values.
    values: Vec<u32>,
    /// The field was literally `*`. Drives cron's day-of-month/day-of-week rule
    /// and lets the description say "every hour" instead of listing 24 of them.
    star: bool,
    /// Step from `*/n`, kept for phrasing ("every 15 minutes").
    step: Option<u32>,
}

impl Field {
    fn matches(&self, v: u32) -> bool {
        self.values.binary_search(&v).is_ok()
    }
}

/// One field of a five-field schedule. `names` allows `JAN`/`MON` style values.
fn parse_field(spec: &str, min: u32, max: u32, names: &[&str]) -> Option<Field> {
    if spec.is_empty() {
        return None;
    }
    let mut values: Vec<u32> = Vec::new();
    let mut star = false;
    let mut step_hint = None;

    for part in spec.split(',') {
        // Split the optional `/step` off first; the rest is a range or a value.
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => {
                let n: u32 = s.parse().ok()?;
                if n == 0 {
                    return None;
                }
                (r, n)
            }
            None => (part, 1),
        };

        let (lo, hi) = if range == "*" {
            if part == "*" {
                star = true;
            } else {
                step_hint = Some(step);
            }
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (
                parse_value(a, min, max, names)?,
                parse_value(b, min, max, names)?,
            )
        } else {
            let v = parse_value(range, min, max, names)?;
            // `5/10` means "from 5 to the end of the range, every 10".
            if step > 1 {
                (v, max)
            } else {
                (v, v)
            }
        };
        if lo > hi {
            return None;
        }
        let mut v = lo;
        while v <= hi {
            values.push(v);
            v += step;
        }
    }

    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return None;
    }
    Some(Field {
        values,
        star,
        step: step_hint,
    })
}

fn parse_value(text: &str, min: u32, max: u32, names: &[&str]) -> Option<u32> {
    if let Ok(n) = text.parse::<u32>() {
        return (n >= min && n <= max).then_some(n);
    }
    let upper = text.to_ascii_uppercase();
    // Names are 1-based for months, 0-based for days - hence the `min` offset.
    names
        .iter()
        .position(|n| *n == upper)
        .map(|i| i as u32 + min)
}

#[derive(Clone, Debug, PartialEq)]
struct Schedule {
    minute: Field,
    hour: Field,
    dom: Field,
    month: Field,
    dow: Field,
}

/// Split a job line into (schedule, command).
///
/// The strictness matters. This is what decides whether a line is a job or
/// something the panel must leave alone, and a loose grammar would happily read
/// `cd /var/log && ./rotate.sh` as five schedule fields plus a command.
fn split_schedule(body: &str) -> Option<(String, String)> {
    if let Some(rest) = body.strip_prefix('@') {
        let mut it = rest.splitn(2, char::is_whitespace);
        let nick = it.next()?.to_ascii_lowercase();
        let known = matches!(
            nick.as_str(),
            "reboot"
                | "yearly"
                | "annually"
                | "monthly"
                | "weekly"
                | "daily"
                | "midnight"
                | "hourly"
        );
        if !known {
            return None;
        }
        let command = it.next().unwrap_or("").trim().to_string();
        if command.is_empty() {
            return None;
        }
        return Some((format!("@{}", nick), command));
    }

    let mut fields = body.split_whitespace();
    let parts: Vec<&str> = fields.by_ref().take(5).collect();
    if parts.len() < 5 {
        return None;
    }
    parse_schedule_fields(&parts)?;
    let command = body
        .split_whitespace()
        .skip(5)
        .collect::<Vec<_>>()
        .join(" ");
    if command.is_empty() {
        return None;
    }
    Some((parts.join(" "), command))
}

fn parse_schedule_fields(parts: &[&str]) -> Option<Schedule> {
    Some(Schedule {
        minute: parse_field(parts[0], 0, 59, &[])?,
        hour: parse_field(parts[1], 0, 23, &[])?,
        dom: parse_field(parts[2], 1, 31, &[])?,
        month: parse_field(parts[3], 1, 12, &MONTHS)?,
        // 7 is Sunday as well as 0; normalised after parsing.
        dow: parse_field(parts[4], 0, 7, &DAYS).map(normalise_dow)?,
    })
}

fn normalise_dow(mut f: Field) -> Field {
    if f.values.contains(&7) {
        f.values.retain(|v| *v != 7);
        if !f.values.contains(&0) {
            f.values.push(0);
        }
        f.values.sort_unstable();
    }
    f
}

/// Expand an `@nickname` to its five-field equivalent. `@reboot` has none.
fn nickname_fields(nick: &str) -> Option<[&'static str; 5]> {
    Some(match nick {
        "@yearly" | "@annually" => ["0", "0", "1", "1", "*"],
        "@monthly" => ["0", "0", "1", "*", "*"],
        "@weekly" => ["0", "0", "*", "*", "0"],
        "@daily" | "@midnight" => ["0", "0", "*", "*", "*"],
        "@hourly" => ["0", "*", "*", "*", "*"],
        _ => return None,
    })
}

fn schedule_of(spec: &str) -> Option<Schedule> {
    if spec.starts_with('@') {
        let fields = nickname_fields(spec)?;
        return parse_schedule_fields(&fields);
    }
    let parts: Vec<&str> = spec.split_whitespace().collect();
    if parts.len() != 5 {
        return None;
    }
    parse_schedule_fields(&parts)
}

// ── Civil date arithmetic ─────────────────────────────────────────────────────
//
// Cron fires on the host's wall clock, so everything below works in host-local
// time and converts back to Unix seconds at the end. No date library - these two
// functions (Howard Hinnant's days-from-civil) are the whole of what's needed.

/// Days since 1970-01-01 for a proleptic Gregorian date.
///
/// Only the reverse direction is needed at runtime; this exists so the tests can
/// check the pair round-trips, which is the thing that would silently poison
/// every "next run" if it were wrong.
#[cfg(test)]
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of `days_from_civil`.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 0 = Sunday, matching cron's day-of-week numbering.
fn weekday_from_days(days: i64) -> u32 {
    // 1970-01-01 was a Thursday (4).
    (((days % 7) + 11) % 7) as u32
}

/// Cron's day rule: when *both* day-of-month and day-of-week are restricted the
/// job runs if *either* matches. When only one is restricted, only it applies.
/// This trips people up constantly, and getting it wrong here would make the
/// "next run" times quietly, plausibly wrong.
fn day_matches(s: &Schedule, dom: u32, dow: u32) -> bool {
    match (s.dom.star, s.dow.star) {
        (true, true) => true,
        (false, true) => s.dom.matches(dom),
        (true, false) => s.dow.matches(dow),
        (false, false) => s.dom.matches(dom) || s.dow.matches(dow),
    }
}

/// The next `count` fire times at or after `after`, as Unix seconds.
///
/// `after` and `offset_min` are the host's clock and UTC offset; cron runs on
/// local time, so the search happens in local minutes and converts back at the
/// end. Days are filtered before minutes are scanned, which keeps even a
/// once-a-year schedule to a few hundred cheap checks.
fn next_runs(s: &Schedule, after: i64, offset_min: i32, count: usize) -> Vec<i64> {
    let mut out = Vec::with_capacity(count);
    let local = after + offset_min as i64 * 60;
    let start_day = local.div_euclid(86_400);
    let start_min_of_day = local.rem_euclid(86_400) / 60;

    // 4 years covers every schedule that can fire at all, leap days included.
    for day_offset in 0..=1461 {
        let day = start_day + day_offset;
        let (_, m, d) = civil_from_days(day);
        if !s.month.matches(m as u32) || !day_matches(s, d as u32, weekday_from_days(day)) {
            continue;
        }
        for &h in &s.hour.values {
            for &min in &s.minute.values {
                let mod_ = h * 60 + min;
                // Strictly after the current minute, so "now" isn't reported as
                // the next run for a job that has already fired this minute.
                if day_offset == 0 && (mod_ as i64) <= start_min_of_day {
                    continue;
                }
                out.push((day * 86_400 + mod_ as i64 * 60) - offset_min as i64 * 60);
                if out.len() == count {
                    return out;
                }
            }
        }
    }
    out
}

// ── Plain English ─────────────────────────────────────────────────────────────

fn join_list(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [a] => a.clone(),
        [a, b] => format!("{} and {}", a, b),
        _ => format!(
            "{} and {}",
            items[..items.len() - 1].join(", "),
            items[items.len() - 1]
        ),
    }
}

fn ordinal(n: u32) -> String {
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{}{}", n, suffix)
}

/// When it runs, e.g. "At 04:00", "Every 15 minutes", "Every hour at :05".
fn describe_time(s: &Schedule) -> String {
    let every_minute = s.minute.star;
    let every_hour = s.hour.star;

    if every_minute && every_hour {
        return "Every minute".into();
    }
    if let (Some(step), true) = (s.minute.step, every_hour) {
        return format!("Every {} minutes", step);
    }
    if every_minute {
        let hours = join_list(
            &s.hour
                .values
                .iter()
                .map(|h| format!("{:02}:00", h))
                .collect::<Vec<_>>(),
        );
        return format!("Every minute of {}", hours);
    }
    if every_hour {
        // Listing 30 minute marks helps nobody; the step reads better.
        if let Some(step) = s.minute.step {
            return format!("Every {} minutes", step);
        }
        let mins = join_list(
            &s.minute
                .values
                .iter()
                .map(|m| format!(":{:02}", m))
                .collect::<Vec<_>>(),
        );
        return format!("Every hour at {}", mins);
    }
    if let Some(step) = s.hour.step {
        let mins = join_list(
            &s.minute
                .values
                .iter()
                .map(|m| format!(":{:02}", m))
                .collect::<Vec<_>>(),
        );
        return format!("Every {} hours at {}", step, mins);
    }

    // A full cross product gets unreadable fast; past a handful, summarise.
    let times = s.hour.values.len() * s.minute.values.len();
    if times > 6 {
        return format!("At {} times a day", times);
    }
    let mut stamps = Vec::new();
    for h in &s.hour.values {
        for m in &s.minute.values {
            stamps.push(format!("{:02}:{:02}", h, m));
        }
    }
    format!("At {}", join_list(&stamps))
}

/// Which days, e.g. "every day", "on Monday and Friday", "on the 1st".
fn describe_days(s: &Schedule) -> String {
    // `*` and an explicit `0-6` both mean every day, and neither is worth
    // saying out loud - "on Sunday, Monday, Tuesday…" is noise, not information.
    let dow = if s.dow.star || s.dow.values.len() == 7 {
        None
    } else {
        Some(join_list(
            &s.dow
                .values
                .iter()
                .map(|d| DAY_NAMES[*d as usize % 7].to_string())
                .collect::<Vec<_>>(),
        ))
    };
    let dom = if s.dom.star {
        None
    } else if let Some(step) = s.dom.step {
        Some(format!("every {} days", step))
    } else if s.dom.values.len() > 6 {
        Some(format!("on {} days of the month", s.dom.values.len()))
    } else {
        Some(format!(
            "on the {}",
            join_list(&s.dom.values.iter().map(|d| ordinal(*d)).collect::<Vec<_>>())
        ))
    };

    match (dom, dow) {
        (None, None) => "every day".into(),
        (Some(dom), None) => dom,
        (None, Some(dow)) => format!("on {}", dow),
        // Both restricted is cron's OR case, and saying so is the only way the
        // reader won't assume it's an AND.
        (Some(dom), Some(dow)) => format!("{}, or on any {}", dom, dow),
    }
}

fn describe_months(s: &Schedule) -> Option<String> {
    if s.month.star || s.month.values.len() == 12 {
        return None;
    }
    Some(format!(
        "in {}",
        join_list(
            &s.month
                .values
                .iter()
                .map(|m| MONTH_NAMES[(*m as usize) - 1].to_string())
                .collect::<Vec<_>>()
        )
    ))
}

pub fn describe(spec: &str) -> String {
    if spec == "@reboot" {
        return "At boot".into();
    }
    let Some(s) = schedule_of(spec) else {
        return "Unrecognised schedule".into();
    };
    let mut out = describe_time(&s);
    let days = describe_days(&s);
    if days != "every day" {
        out.push(' ');
        out.push_str(&days);
    } else if !out.starts_with("Every") {
        out.push_str(" every day");
    }
    if let Some(months) = describe_months(&s) {
        out.push(' ');
        out.push_str(&months);
    }
    out
}

// ── Table parsing ─────────────────────────────────────────────────────────────

fn is_env_assignment(body: &str) -> bool {
    let Some((name, _)) = body.split_once('=') else {
        return false;
    };
    let name = name.trim_end();
    !name.is_empty()
        && !name.contains(char::is_whitespace)
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Split a crontab into jobs and environment lines. Lines that are neither -
/// comments, blanks, and anything unparseable - are simply not reported; they
/// stay in `lines` and ride through a save untouched.
pub fn parse_table(text: &str, host_now: i64, offset_min: i32) -> (Vec<CronJob>, Vec<String>) {
    let mut jobs = Vec::new();
    let mut env = Vec::new();
    // A `#` comment directly above a job is that job's label, by convention.
    let mut pending_comment: Option<String> = None;

    for (i, raw) in text.lines().enumerate() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            pending_comment = None;
            continue;
        }

        let (body, enabled) = match trimmed.strip_prefix('#') {
            Some(rest) => (rest.trim_start_matches(['#', ' ', '\t']), false),
            None => (trimmed, true),
        };

        if enabled && is_env_assignment(body) {
            env.push(trimmed.to_string());
            pending_comment = None;
            continue;
        }

        match split_schedule(body) {
            Some((schedule, command)) => {
                let next_runs = if schedule == "@reboot" {
                    Vec::new()
                } else {
                    schedule_of(&schedule)
                        .map(|s| next_runs(&s, host_now, offset_min, 3))
                        .unwrap_or_default()
                };
                jobs.push(CronJob {
                    line: i,
                    description: describe(&schedule),
                    schedule,
                    command,
                    enabled,
                    comment: pending_comment.take(),
                    next_runs,
                });
            }
            None => {
                // Didn't parse. If it was a comment, hold it as a label for
                // whatever job comes next; otherwise leave it entirely alone.
                pending_comment = if enabled {
                    None
                } else {
                    Some(body.trim().to_string()).filter(|c| !c.is_empty())
                };
            }
        }
    }

    (jobs, env)
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Reads the crontab and the host's clock in one round trip.
///
/// The body comes back base64-encoded behind a sentinel: a crontab is arbitrary
/// text, and this is the only way to be certain that what arrives is the file
/// and not a shell error or a truncated read.
const READ_CMD: &str = "raw=$(crontab -l 2>/dev/null); rc=$?; \
     printf 'KINO %s %s %s\\n' \"$rc\" \"$(date +%s)\" \"$(date +%z)\"; \
     printf '%s' \"KINOSTART$raw\" | base64 | tr -d '\\n'";

/// `+0530` / `-0800` to minutes east of UTC.
fn parse_offset(text: &str) -> i32 {
    let t = text.trim();
    let (sign, rest) = match t.strip_prefix('-') {
        Some(r) => (-1, r),
        None => (1, t.strip_prefix('+').unwrap_or(t)),
    };
    if rest.len() < 4 {
        return 0;
    }
    let hours: i32 = rest[..2].parse().unwrap_or(0);
    let mins: i32 = rest[2..4].parse().unwrap_or(0);
    sign * (hours * 60 + mins)
}

#[derive(Serialize, Clone, Debug)]
pub struct CronPreview {
    pub valid: bool,
    pub description: String,
    pub next_runs: Vec<i64>,
}

/// Describe a schedule without touching the host, so the editor can show what a
/// half-typed expression means as it's typed. Pure; `host_now`/`host_offset_min`
/// come from the `CronTable` the editor was opened from.
#[tauri::command]
pub fn cron_preview(schedule: String, host_now: i64, host_offset_min: i32) -> CronPreview {
    let spec = schedule.trim();
    if spec.eq_ignore_ascii_case("@reboot") {
        return CronPreview {
            valid: true,
            description: "At boot".into(),
            next_runs: Vec::new(),
        };
    }
    match schedule_of(spec) {
        Some(s) => CronPreview {
            valid: true,
            description: describe(spec),
            next_runs: next_runs(&s, host_now, host_offset_min, 3),
        },
        None => CronPreview {
            valid: false,
            description: "Unrecognised schedule".into(),
            next_runs: Vec::new(),
        },
    }
}

#[tauri::command]
pub async fn cron_list(
    state: tauri::State<'_, crate::AppState>,
    session_id: String,
    local: bool,
) -> Result<CronTable, String> {
    let handle = transport(&state, &session_id, local)?;
    let out = exec(handle.as_ref(), READ_CMD).await?;

    let mut lines_iter = out.stdout.lines();
    let meta = lines_iter
        .next()
        .filter(|l| l.starts_with("KINO "))
        .ok_or_else(|| {
            let err = out.stderr.trim();
            if err.is_empty() {
                "Couldn't read the crontab - is `crontab` installed on this host?".to_string()
            } else {
                err.to_string()
            }
        })?;
    let meta: Vec<&str> = meta.split_whitespace().collect();
    let rc: i32 = meta.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
    let host_now: i64 = meta.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let host_offset_min = meta.get(3).map(|s| parse_offset(s)).unwrap_or(0);

    let payload: String = lines_iter.collect::<Vec<_>>().join("");
    let decoded = STANDARD
        .decode(payload.trim())
        .map_err(|_| "The host returned a crontab this build can't decode".to_string())?;
    let decoded = String::from_utf8_lossy(&decoded);
    let text = decoded
        .strip_prefix(SENTINEL)
        // No sentinel means `base64` isn't there or the command was mangled.
        // Refusing here is the point: an empty table would be an invitation to
        // save over a crontab we never actually read.
        .ok_or_else(|| {
            "Couldn't read the crontab safely - `base64` doesn't seem to be available on this host"
                .to_string()
        })?
        .to_string();

    // A non-zero exit with nothing to show is the normal "no crontab for user"
    // case; there is nothing to clobber, so the panel starts on a blank table.
    let empty = text.trim().is_empty();
    if rc != 0 && !empty {
        return Err("`crontab -l` failed on this host".to_string());
    }

    let (jobs, env) = parse_table(&text, host_now, host_offset_min);
    let lines: Vec<String> = if empty {
        Vec::new()
    } else {
        text.lines().map(|l| l.to_string()).collect()
    };

    Ok(CronTable {
        token: STANDARD.encode(format!("{}{}", SENTINEL, text)),
        lines,
        jobs,
        env,
        host_now,
        host_offset_min,
        empty,
    })
}

/// The compare-and-swap write, as a shell script.
///
/// Re-reads the crontab, hashes it the same way `READ_CMD` did, and bails with
/// status 9 if it no longer matches what the panel loaded. Both interpolated
/// values are base64, so nothing in a crontab can escape the single quotes.
/// Exit statuses: 9 conflict, 8 couldn't stage the file, otherwise `crontab`'s.
fn save_command(token: &str, new_b64: &str) -> String {
    format!(
        "tmp=\"${{TMPDIR:-/tmp}}/kino-cron.$$\"; \
         cur=$(crontab -l 2>/dev/null); \
         cur64=$(printf '%s' \"KINOSTART$cur\" | base64 | tr -d '\\n'); \
         if [ \"$cur64\" != '{token}' ]; then echo KINO_CONFLICT >&2; exit 9; fi; \
         printf '%s' '{new}' | base64 -d > \"$tmp\" || exit 8; \
         crontab \"$tmp\"; rc=$?; rm -f \"$tmp\"; exit $rc",
        token = token,
        new = new_b64,
    )
}

/// Write the crontab back, but only if it still matches `token`.
///
/// `lines` is the complete file. The panel builds it from the list `cron_list`
/// returned, with only the lines it actually edited changed - so anything this
/// module failed to parse is written back exactly as it arrived.
#[tauri::command]
pub async fn cron_save(
    state: tauri::State<'_, crate::AppState>,
    session_id: String,
    local: bool,
    lines: Vec<String>,
    token: String,
) -> Result<CronTable, String> {
    let handle = transport(&state, &session_id, local)?;

    let mut body = lines.join("\n");
    // cron ignores a final line with no newline on it; some implementations
    // reject the file outright.
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    let new_b64 = STANDARD.encode(&body);

    // Every interpolated value here is base64, so nothing in a crontab can
    // escape the quoting - which is the whole reason it's encoded.
    if token.contains('\'') || new_b64.contains('\'') {
        return Err("Refusing to write: unexpected characters in the payload".to_string());
    }

    let out = exec(handle.as_ref(), &save_command(&token, &new_b64)).await?;
    match out.code {
        Some(0) | None => {}
        Some(9) => {
            return Err(
                "The crontab changed on the host since it was loaded. Refresh and reapply your \
                 edit - nothing was written."
                    .to_string(),
            )
        }
        Some(8) => return Err("Couldn't stage the new crontab on the host".to_string()),
        Some(_) => {
            let msg = out.stderr.trim();
            return Err(if msg.is_empty() {
                "`crontab` rejected the file".to_string()
            } else {
                msg.to_string()
            });
        }
    }

    // Re-read rather than echoing the input back: this returns the host's view,
    // including a fresh CAS token, and proves the write landed.
    cron_list(state, session_id, local).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sched(spec: &str) -> Schedule {
        schedule_of(spec).expect("should parse")
    }

    #[test]
    fn parses_stars_and_lists_and_steps() {
        let s = sched("*/15 2,14 * * 1-5");
        assert_eq!(s.minute.values, vec![0, 15, 30, 45]);
        assert_eq!(s.minute.step, Some(15));
        assert_eq!(s.hour.values, vec![2, 14]);
        assert!(s.dom.star);
        assert_eq!(s.dow.values, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn accepts_month_and_day_names() {
        let s = sched("0 0 1 JAN,jul MON");
        assert_eq!(s.month.values, vec![1, 7]);
        assert_eq!(s.dow.values, vec![1]);
    }

    #[test]
    fn day_seven_is_sunday() {
        let s = sched("0 0 * * 7");
        assert_eq!(s.dow.values, vec![0]);
        let both = sched("0 0 * * 0,7");
        assert_eq!(both.dow.values, vec![0]);
    }

    #[test]
    fn rejects_out_of_range_and_malformed() {
        assert!(schedule_of("60 0 * * *").is_none());
        assert!(schedule_of("0 24 * * *").is_none());
        assert!(schedule_of("0 0 0 * *").is_none()); // day-of-month is 1-based
        assert!(schedule_of("0 0 * 13 *").is_none());
        assert!(schedule_of("*/0 * * * *").is_none());
        assert!(schedule_of("5-1 * * * *").is_none());
        assert!(schedule_of("* * * *").is_none());
    }

    #[test]
    fn a_shell_line_is_not_a_schedule() {
        // The whole reason the field grammar is strict: these must not be read
        // as jobs, or the panel would offer to "edit" them and mangle them.
        assert!(split_schedule("cd /var/log && ./rotate.sh --keep 7").is_none());
        assert!(split_schedule("echo one two three four five").is_none());
        assert!(split_schedule("PATH=/usr/bin:/bin").is_none());
    }

    #[test]
    fn splits_nicknames() {
        let (s, c) = split_schedule("@daily /usr/local/bin/backup.sh").unwrap();
        assert_eq!(s, "@daily");
        assert_eq!(c, "/usr/local/bin/backup.sh");
        assert!(split_schedule("@yesterday /bin/true").is_none());
        // A nickname with no command isn't a job.
        assert!(split_schedule("@reboot").is_none());
    }

    #[test]
    fn nicknames_expand_to_equivalent_fields() {
        assert_eq!(sched("@hourly"), sched("0 * * * *"));
        assert_eq!(sched("@daily"), sched("0 0 * * *"));
        assert_eq!(sched("@midnight"), sched("0 0 * * *"));
        assert_eq!(sched("@weekly"), sched("0 0 * * 0"));
        assert_eq!(sched("@monthly"), sched("0 0 1 * *"));
        assert_eq!(sched("@yearly"), sched("0 0 1 1 *"));
        assert!(schedule_of("@reboot").is_none());
    }

    #[test]
    fn civil_date_roundtrips() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 1970-01-01 was a Thursday.
        assert_eq!(weekday_from_days(0), 4);
        for day in [-25_000i64, -1, 0, 1, 19_000, 25_000, 100_000] {
            let (y, m, d) = civil_from_days(day);
            assert_eq!(days_from_civil(y, m, d), day, "roundtrip failed at {}", day);
        }
        // Leap day exists in 2024 and the day after is the 1st of March.
        assert_eq!(
            civil_from_days(days_from_civil(2024, 2, 29) + 1),
            (2024, 3, 1)
        );
    }

    /// 2024-01-01 00:00:00 UTC, a Monday.
    const MON_2024: i64 = 1_704_067_200;

    #[test]
    fn next_run_is_strictly_after_now() {
        let s = sched("0 * * * *");
        // Exactly on the hour: the next run is the following hour, not now.
        let runs = next_runs(&s, MON_2024, 0, 2);
        assert_eq!(runs[0], MON_2024 + 3600);
        assert_eq!(runs[1], MON_2024 + 7200);
    }

    #[test]
    fn next_run_respects_host_offset() {
        // 04:00 daily. At 00:00 UTC on a host 5h30m east it is already 05:30
        // local, so the next 04:00 local is 22h30m away.
        let s = sched("0 4 * * *");
        let runs = next_runs(&s, MON_2024, 330, 1);
        assert_eq!(runs[0] - MON_2024, 22 * 3600 + 30 * 60);
    }

    #[test]
    fn next_run_finds_the_right_weekday() {
        // Tuesdays at 04:00; 2024-01-01 is a Monday, so tomorrow.
        let s = sched("0 4 * * 2");
        let runs = next_runs(&s, MON_2024, 0, 2);
        assert_eq!(runs[0], MON_2024 + 86_400 + 4 * 3600);
        assert_eq!(runs[1], runs[0] + 7 * 86_400);
    }

    #[test]
    fn dom_and_dow_are_ored_when_both_are_set() {
        // The 15th OR any Monday - the classic cron gotcha.
        let s = sched("0 0 15 * 1");
        let runs = next_runs(&s, MON_2024 + 3600, 0, 3);
        let dates: Vec<(i64, i64, i64)> = runs
            .iter()
            .map(|t| civil_from_days(t.div_euclid(86_400)))
            .collect();
        // Mondays 8th and 15th (also the 15th), then Monday the 22nd.
        assert_eq!(dates[0], (2024, 1, 8));
        assert_eq!(dates[1], (2024, 1, 15));
        assert_eq!(dates[2], (2024, 1, 22));
    }

    #[test]
    fn dom_alone_is_not_ored_with_every_weekday() {
        let s = sched("0 0 15 * *");
        let runs = next_runs(&s, MON_2024, 0, 2);
        assert_eq!(civil_from_days(runs[0].div_euclid(86_400)), (2024, 1, 15));
        assert_eq!(civil_from_days(runs[1].div_euclid(86_400)), (2024, 2, 15));
    }

    #[test]
    fn impossible_schedules_return_no_runs() {
        // 30 February never happens; the search must terminate, not spin.
        let s = sched("0 0 30 2 *");
        assert!(next_runs(&s, MON_2024, 0, 1).is_empty());
    }

    #[test]
    fn leap_day_schedule_finds_the_next_leap_year() {
        let s = sched("0 0 29 2 *");
        // From 2025-01-01, the next 29 February is in 2028.
        let start = MON_2024 + 366 * 86_400;
        let runs = next_runs(&s, start, 0, 1);
        assert_eq!(civil_from_days(runs[0].div_euclid(86_400)), (2028, 2, 29));
    }

    #[test]
    fn descriptions_read_like_english() {
        assert_eq!(describe("* * * * *"), "Every minute");
        assert_eq!(describe("*/15 * * * *"), "Every 15 minutes");
        assert_eq!(describe("5 * * * *"), "Every hour at :05");
        assert_eq!(describe("0 4 * * *"), "At 04:00 every day");
        assert_eq!(describe("30 4 * * 2"), "At 04:30 on Tuesday");
        assert_eq!(describe("0 0 1 * *"), "At 00:00 on the 1st");
        assert_eq!(
            describe("0 9 * * 1-5"),
            "At 09:00 on Monday, Tuesday, Wednesday, Thursday and Friday"
        );
        assert_eq!(describe("@reboot"), "At boot");
        assert_eq!(describe("@daily"), "At 00:00 every day");
        assert_eq!(describe("0 0 1 1 *"), "At 00:00 on the 1st in January");
        assert_eq!(
            describe("0 0 15 * 1"),
            "At 00:00 on the 15th, or on any Monday"
        );
        assert_eq!(describe("nonsense"), "Unrecognised schedule");
    }

    #[test]
    fn parses_a_table_and_keeps_line_indices() {
        let text = "\
# m h dom mon dow command
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=ops@example.com

# Nightly database backup
0 4 * * * /usr/local/bin/backup.sh --full

#0 5 * * * /usr/local/bin/old-backup.sh
@reboot /usr/local/bin/warm-cache.sh
cd /tmp && echo not a job
";
        let (jobs, env) = parse_table(text, MON_2024, 0);
        assert_eq!(
            env,
            vec![
                "PATH=/usr/local/bin:/usr/bin:/bin",
                "MAILTO=ops@example.com"
            ]
        );
        assert_eq!(jobs.len(), 3);

        assert_eq!(jobs[0].line, 5);
        assert_eq!(jobs[0].schedule, "0 4 * * *");
        assert_eq!(jobs[0].command, "/usr/local/bin/backup.sh --full");
        assert!(jobs[0].enabled);
        assert_eq!(jobs[0].comment.as_deref(), Some("Nightly database backup"));
        assert_eq!(jobs[0].description, "At 04:00 every day");
        assert_eq!(jobs[0].next_runs.len(), 3);

        // Commented-out job: still a job, just parked.
        assert_eq!(jobs[1].line, 7);
        assert!(!jobs[1].enabled);
        assert_eq!(jobs[1].command, "/usr/local/bin/old-backup.sh");

        assert_eq!(jobs[2].schedule, "@reboot");
        assert!(jobs[2].next_runs.is_empty());

        // The trailing shell line parsed as nothing, and is reported as nothing.
        assert!(!jobs.iter().any(|j| j.command.contains("not a job")));
    }

    #[test]
    fn every_line_survives_a_round_trip() {
        // The guarantee the panel rests on: what isn't edited comes back byte
        // for byte, including the lines this parser doesn't understand.
        let text = "# header\n\n\nPATH=/bin\n0 4 * * *  spaced   out.sh\n\tgarbage line\n";
        let lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
        let (jobs, _) = parse_table(text, MON_2024, 0);
        assert_eq!(jobs.len(), 1);

        let mut edited = lines.clone();
        edited[jobs[0].line] = "0 5 * * *  spaced   out.sh".to_string();
        let rebuilt = edited.join("\n") + "\n";
        assert_eq!(
            rebuilt,
            "# header\n\n\nPATH=/bin\n0 5 * * *  spaced   out.sh\n\tgarbage line\n"
        );
    }

    #[test]
    fn env_detection_is_narrow() {
        assert!(is_env_assignment("PATH=/usr/bin"));
        assert!(is_env_assignment("MAILTO="));
        assert!(is_env_assignment("_x1 = value"));
        assert!(!is_env_assignment("0 4 * * * a=b"));
        assert!(!is_env_assignment("not an assignment"));
        assert!(!is_env_assignment("=value"));
    }

    // ── End-to-end shell tests ───────────────────────────────────────────────
    //
    // These run the real command strings through a real `sh`, against a stub
    // `crontab` on PATH. Everything risky about this module lives in those two
    // strings - quoting, base64, the sentinel, the compare-and-swap - and none
    // of it is exercised by testing the Rust around them.

    /// A `crontab` stand-in: `-l` prints the store, otherwise it installs a file.
    /// Absent store means "no crontab for this user", exit 1, like the real one.
    fn stub_crontab(dir: &std::path::Path) -> std::path::PathBuf {
        let store = dir.join("store");
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = \"-l\" ]; then\n  [ -f '{store}' ] || exit 1\n  cat '{store}'\nelse\n  cat \"$1\" > '{store}'\nfi\n",
            store = store.display()
        );
        let path = bin.join("crontab");
        std::fs::write(&path, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        store
    }

    async fn run(dir: &std::path::Path, cmd: &str) -> crate::exec::ExecOutput {
        let prefixed = format!("PATH=\"{}/bin:$PATH\"; {}", dir.display(), cmd);
        exec(None, &prefixed).await.unwrap()
    }

    /// Everything a crontab can contain that a naive quoting scheme would break.
    const NASTY: &str = "# it's a \"quoted\" comment `with backticks`\n\
         PATH=/usr/bin:/bin\n\
         0 4 * * * /bin/sh -c 'echo $(date) >> /var/log/x.log' # trailing\n\
         */5 * * * * printf '%s\\n' \"a'b\\\"c\" | tee /tmp/ünicode\n";

    #[tokio::test]
    async fn reads_a_crontab_full_of_hostile_characters() {
        let dir = tempfile::tempdir().unwrap();
        let store = stub_crontab(dir.path());
        std::fs::write(&store, NASTY).unwrap();

        let out = run(dir.path(), READ_CMD).await;
        let mut lines = out.stdout.lines();
        let meta: Vec<&str> = lines.next().unwrap().split_whitespace().collect();
        assert_eq!(meta[0], "KINO");
        assert_eq!(meta[1], "0", "crontab -l should have succeeded");

        let decoded = STANDARD.decode(lines.collect::<Vec<_>>().join("")).unwrap();
        let text = String::from_utf8(decoded).unwrap();
        let text = text.strip_prefix(SENTINEL).expect("sentinel must survive");
        // `$(crontab -l)` drops the trailing newline; nothing else may change.
        assert_eq!(text, NASTY.trim_end_matches('\n'));

        let (jobs, env) = parse_table(text, MON_2024, 0);
        assert_eq!(env, vec!["PATH=/usr/bin:/bin"]);
        assert_eq!(jobs.len(), 2);
        assert!(jobs[0].command.contains("echo $(date)"));
    }

    #[tokio::test]
    async fn reports_a_missing_crontab_rather_than_an_empty_one() {
        let dir = tempfile::tempdir().unwrap();
        stub_crontab(dir.path()); // no store file - user has no crontab
        let out = run(dir.path(), READ_CMD).await;
        let meta: Vec<&str> = out
            .stdout
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .collect();
        assert_eq!(meta[1], "1", "a missing crontab must be a non-zero status");
    }

    #[tokio::test]
    async fn save_round_trips_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let store = stub_crontab(dir.path());
        std::fs::write(&store, NASTY).unwrap();

        let token = STANDARD.encode(format!("{}{}", SENTINEL, NASTY.trim_end_matches('\n')));
        let body = format!("{}# appended\n0 6 * * * /bin/true\n", NASTY);
        let out = run(dir.path(), &save_command(&token, &STANDARD.encode(&body))).await;

        assert_eq!(out.code, Some(0), "stderr: {}", out.stderr);
        assert_eq!(std::fs::read_to_string(&store).unwrap(), body);
    }

    #[tokio::test]
    async fn save_refuses_when_the_crontab_changed_underneath() {
        let dir = tempfile::tempdir().unwrap();
        let store = stub_crontab(dir.path());
        std::fs::write(&store, NASTY).unwrap();

        // A token from some earlier state of the file.
        let stale = STANDARD.encode(format!("{}{}", SENTINEL, "0 1 * * * /bin/older"));
        let out = run(
            dir.path(),
            &save_command(&stale, &STANDARD.encode("0 9 * * * /bin/clobber\n")),
        )
        .await;

        assert_eq!(out.code, Some(9), "must exit 9 on a conflict");
        assert!(out.stderr.contains("KINO_CONFLICT"));
        assert_eq!(
            std::fs::read_to_string(&store).unwrap(),
            NASTY,
            "a conflicting save must not touch the crontab"
        );
    }

    #[tokio::test]
    async fn save_can_create_a_crontab_that_does_not_exist_yet() {
        let dir = tempfile::tempdir().unwrap();
        let store = stub_crontab(dir.path());
        // No crontab: `$(crontab -l)` is empty, so the token is the sentinel alone.
        let token = STANDARD.encode(SENTINEL);
        let body = "0 4 * * * /usr/local/bin/backup.sh\n";
        let out = run(dir.path(), &save_command(&token, &STANDARD.encode(body))).await;

        assert_eq!(out.code, Some(0), "stderr: {}", out.stderr);
        assert_eq!(std::fs::read_to_string(&store).unwrap(), body);
    }

    #[test]
    fn parses_utc_offsets() {
        assert_eq!(parse_offset("+0000"), 0);
        assert_eq!(parse_offset("+0530"), 330);
        assert_eq!(parse_offset("-0800"), -480);
        assert_eq!(parse_offset("garbage"), 0);
    }
}
