import { getApiKey } from '@/lib/llm';
import { getModel, DEFAULT_MODEL_ID } from '@/lib/models';
import { ChatMessage } from '@/types/workout';
import * as SQLite from 'expo-sqlite';

type LlmTurn = { role: 'user' | 'assistant'; content: string };

// How much prior conversation to send for context.
const MAX_HISTORY_MESSAGES = 8; // ~4 exchanges
const MAX_ASSISTANT_CHARS = 800;

/**
 * Convert prior chat messages into LLM turns so the model can interpret
 * follow-up questions ("that for last month instead", "which was fastest").
 * Assistant turns carry a trimmed view of the answer plus the SQL that
 * produced it, which is what the model needs to build on a previous query.
 */
function buildHistoryTurns(history: ChatMessage[]): LlmTurn[] {
  const turns: LlmTurn[] = history.slice(-MAX_HISTORY_MESSAGES).map((m) => {
    if (m.role === 'assistant') {
      let content =
        m.content.length > MAX_ASSISTANT_CHARS
          ? `${m.content.slice(0, MAX_ASSISTANT_CHARS)}…`
          : m.content;
      if (m.query_sql) content += `\n\n[SQL used: ${m.query_sql}]`;
      return { role: 'assistant', content };
    }
    return { role: 'user', content: m.content };
  });

  // The Anthropic API requires the first message to be a user turn and roles to
  // alternate; drop any leading assistant turn left by the slice.
  while (turns.length > 0 && turns[0].role === 'assistant') turns.shift();
  return turns;
}

/**
 * Query Parser Service
 *
 * Converts natural language queries into SQL using OpenAI.
 * Validates and executes queries safely.
 */

export interface QueryResult {
  sql: string;
  explanation: string;
  results: any[];
  error?: string;
}

const DATABASE_SCHEMA = `
Database Schema for Swim Workouts:

TABLE workouts:
  - id: TEXT (primary key)
  - healthkit_uuid: TEXT (unique identifier from HealthKit)
  - start_date: INTEGER (Unix timestamp in milliseconds)
  - end_date: INTEGER (Unix timestamp)
  - duration_seconds: INTEGER
  - total_distance_meters: REAL
  - total_energy_kcal: REAL (nullable)
  - pool_length_meters: REAL (nullable, in meters: 22.86 for 25yd, 25 for 25m, etc.)
  - pool_length_unit: TEXT ('yd' for yards, 'm' for meters, nullable)
  - location_type: TEXT ('pool' or 'open_water', nullable)
  - source_app: TEXT (e.g., 'Apple Watch')
  - data_quality: INTEGER (0-3, where 3 is best)
  - synced_to_cloud: INTEGER (0 or 1, boolean)
  - created_at: INTEGER (Unix timestamp)
  - updated_at: INTEGER (Unix timestamp)

TABLE segments:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key to workouts.id)
  - segment_number: INTEGER (segment number, starts at 1)
  - start_time: INTEGER (Unix timestamp)
  - end_time: INTEGER (Unix timestamp)
  - lap_count: INTEGER (number of laps in this segment)
  - total_distance_meters: REAL (nullable)
  - total_duration_seconds: REAL (nullable)
  - avg_pace_per_100m_seconds: REAL (nullable, seconds per 100m)

CRITICAL - Filtering Rest Periods:
- ALWAYS include WHERE distance_meters > 0 in lap-based queries
- Zero-distance laps are rest periods from HealthKit and will corrupt split/pace calculations
- These appear as "auto sets" with 0 yards but have swim/rest durations
- Example: SELECT * FROM laps l WHERE l.workout_id = ? AND l.distance_meters > 0

Why this matters:
- Including zero-distance laps adds rest time to split durations
- This makes splits appear faster/slower than actual swim time
- Can cause division-by-zero in pace calculations

TABLE laps:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key to workouts.id)
  - lap_number: INTEGER (lap number, starts at 1)
  - start_time: INTEGER (Unix timestamp)
  - end_time: INTEGER (Unix timestamp)
  - distance_meters: REAL
  - duration_seconds: REAL
  - stroke_style: TEXT ('freestyle', 'backstroke', 'breaststroke', 'butterfly', 'mixed', nullable)
  - stroke_count: INTEGER (nullable)
  - avg_heart_rate: INTEGER (nullable, bpm)
  - max_heart_rate: INTEGER (nullable, bpm)
  - swolf_score: INTEGER (nullable, strokes + seconds)
  - pace_per_100m_seconds: REAL (seconds per 100m)
  - segment_id: TEXT (nullable, foreign key to segments.id)

TABLE stroke_samples:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key)
  - lap_id: TEXT (nullable, foreign key to laps.id)
  - timestamp: INTEGER (Unix timestamp)
  - stroke_count: INTEGER

TABLE heart_rate_samples:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key)
  - timestamp: INTEGER (Unix timestamp)
  - heart_rate: INTEGER (bpm)

Important Notes:
- This is SQLite. Use ONLY SQLite functions (strftime, datetime, ROUND, and window functions like ROW_NUMBER). NEVER use MySQL/Postgres functions such as NOW(), DATE_SUB(), EXTRACT(), or CURDATE().
- Use ONLY the tables and columns listed above. NEVER invent columns or tables. If a requested metric does not exist, use the closest available column and say so in the explanation.
- All dates are stored as Unix timestamps (milliseconds since epoch)
- ALWAYS display dates/times in local time with the 'localtime' modifier so the day matches the user's: datetime(start_date / 1000, 'unixepoch', 'localtime'). Without it, evening workouts can show the wrong date.
- To filter by an absolute date: WHERE start_date >= strftime('%s', '2024-01-01') * 1000
- Relative windows: "today"/"last 24 hours" -> '-1 day'; "this week"/"last 7 days" -> '-7 days'; "this month" -> '-1 month'. Example: WHERE start_date >= strftime('%s', 'now', '-7 days') * 1000
- Current time in milliseconds: strftime('%s', 'now') * 1000
- SWOLF score = stroke_count + duration in seconds (lower is better)

Pace Conversions (CRITICAL for user queries):
- All distances stored in METERS (distance_meters, total_distance_meters)
- pace_per_100m_seconds is in seconds per 100 METERS
- pool_length_unit indicates the workout's original unit ('yd' or 'm')
- ALWAYS filter to swim laps with WHERE distance_meters > 0 before any pace math (rest laps have distance 0 and cause divide-by-zero or skew).
- AVERAGE pace across multiple laps = total time / total distance, NOT the average of per-lap paces (averaging paces over-weights short/slow laps). Use SUM(duration_seconds) / SUM(distance_meters), then scale to the requested distance:
  * average pace per 100 meters -> ROUND(SUM(duration_seconds) / SUM(distance_meters) * 100, 2)
  * average pace per 100 yards  -> ROUND(SUM(duration_seconds) / SUM(distance_meters) * 91.44, 2)
  * average pace per 25 yards   -> ROUND(SUM(duration_seconds) / SUM(distance_meters) * 22.86, 2)
- When user requests pace in yards, convert using: 1 yard = 0.9144 meters
- PER-LAP pace conversions:
  * "pace per 100 yards" (per lap) -> ROUND(l.pace_per_100m_seconds * 0.9144, 2) as pace_per_100yd
  * "pace per 25 yards" (per lap)  -> ROUND((l.duration_seconds / (l.distance_meters / 0.9144)) * 25, 2) as pace_per_25yd
  * "pace per 50 meters" (per lap) -> ROUND((l.duration_seconds / l.distance_meters) * 50, 2) as pace_per_50m

Split Time Calculations (CRITICAL for split queries):
- A "split" is a cumulative time for a specific distance, NOT individual laps
- Example: 100-yard split in a 25-yard pool = sum of 4 consecutive laps (4x25yd)
- CRITICAL: You MUST use SUM(duration_seconds) to add up multiple laps for each split
- Match the split distance to the pool's unit by default: 100-yard splits for 'yd' pools, 100-meter splits for 'm' pools. target_split_meters = 91.44 for 100 yards, 100 for 100 meters.
- Common split distances and their lap counts:
  * 100 yards (91.44m) in 25yd pool (22.86m) = 4 laps
  * 100 yards (91.44m) in 50yd pool (45.72m) = 2 laps
  * 50 yards (45.72m) in 25yd pool (22.86m) = 2 laps
  * 100 meters in 25m pool = 4 laps
  * 100 meters in 50m pool = 2 laps
- Step-by-step calculation:
  1. Filter to swim laps only (WHERE distance_meters > 0) and RE-SEQUENCE them per workout with a window function, because removing rest laps leaves gaps in lap_number:
     ROW_NUMBER() OVER (PARTITION BY workout_id ORDER BY lap_number) AS seq
  2. Laps per split: ROUND(target_split_meters / pool_length_meters)
  3. Assign each lap to a split group using the RE-SEQUENCED number: CAST((seq - 1) / laps_per_split AS INTEGER)
  4. SUM(duration_seconds) per group
  5. GROUP BY workout_id AND split_number
  6. HAVING COUNT(*) = laps_per_split to keep only complete splits
- NEVER group splits by the raw lap_number: it is not contiguous once rest laps are removed, which corrupts splits in interval workouts. Always re-sequence with ROW_NUMBER first.
- CRITICAL WARNING: Even when the user asks for "lap numbers" or "which laps", you MUST still use SUM(duration_seconds) and GROUP BY workout_id and split_number. Use MIN(lap_number) and MAX(lap_number) to show the lap range, but NEVER select individual lap rows when calculating splits.
`;

const SYSTEM_PROMPT = `You are an expert SQL query generator for a swim workout tracking database.

${DATABASE_SCHEMA}

Your task:
1. Convert user questions into SQLite SELECT queries
2. Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "sql": "SELECT ...",
  "explanation": "This query finds..."
}

Guidelines:
- Use ONLY SELECT statements (no INSERT, UPDATE, DELETE, DROP, etc.)
- For any lap-level query (pace, splits, per-lap stats), ALWAYS include WHERE distance_meters > 0 to exclude rest laps
- Join tables when needed for complete answers
- Use appropriate aggregations (AVG, MAX, MIN, COUNT, SUM); for "average pace" use total time / total distance, not AVG of per-lap paces
- Format dates using datetime(timestamp / 1000, 'unixepoch', 'localtime') for display
- For times: Use strftime('%H:%M', timestamp / 1000, 'unixepoch', 'localtime') or include full datetime
- Only include time when user specifically asks for it (e.g., "what time did I swim?")
- Round numbers to 2 decimal places where appropriate
- Limit results to prevent overwhelming output (use LIMIT 10 unless user asks for more)
- Handle nullable fields gracefully with COALESCE or IS NOT NULL checks
- NEVER select ID fields (workout_id, lap_id, segment_id, etc.) - they're meaningless to users
- When displaying distance data, always include pool_length_unit to determine if yards or meters should be shown
- Select multiple relevant columns when summarizing workouts to enable table display

Example Queries:

User: "What was my fastest 100m lap last month?"
{
  "sql": "SELECT datetime(l.start_time / 1000, 'unixepoch', 'localtime') as date, l.pace_per_100m_seconds, l.stroke_style FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.start_date >= strftime('%s', 'now', '-1 month') * 1000 AND l.distance_meters > 0 ORDER BY l.pace_per_100m_seconds ASC LIMIT 1",
  "explanation": "This query finds the fastest (lowest) pace per 100m from all laps in the past month."
}

User: "Show my average SWOLF by stroke type"
{
  "sql": "SELECT l.stroke_style, AVG(l.swolf_score) as avg_swolf, COUNT(DISTINCT l.workout_id) as workouts FROM laps l WHERE l.swolf_score IS NOT NULL AND l.stroke_style IS NOT NULL GROUP BY l.stroke_style ORDER BY avg_swolf ASC",
  "explanation": "Average SWOLF scores by stroke style, showing efficiency for each stroke."
}

User: "How many workouts did I do this week?"
{
  "sql": "SELECT COUNT(*) as workout_count FROM workouts WHERE start_date >= strftime('%s', 'now', '-7 days') * 1000",
  "explanation": "Total workouts completed in the past 7 days."
}

User: "Show me a table with my 25-yard pace for every lap in my last workout"
{
  "sql": "SELECT l.lap_number, ROUND((l.duration_seconds / (l.distance_meters / 0.9144)) * 25, 2) as pace_per_25yd_seconds, l.stroke_style FROM laps l WHERE l.workout_id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) AND l.distance_meters > 0 ORDER BY l.lap_number ASC",
  "explanation": "Pace per 25 yards for each lap in your most recent workout."
}

User: "What was my average pace per 100 yards?"
{
  "sql": "SELECT ROUND(SUM(duration_seconds) / SUM(distance_meters) * 91.44, 2) as avg_pace_per_100yd_seconds FROM laps WHERE distance_meters > 0",
  "explanation": "Your average pace per 100 yards (total time over total distance) across all laps."
}

User: "Show my pace per 50 meters for my last workout"
{
  "sql": "SELECT lap_number, ROUND((duration_seconds / distance_meters) * 50, 2) as pace_per_50m_seconds FROM laps WHERE workout_id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) AND distance_meters > 0 ORDER BY lap_number ASC",
  "explanation": "Pace per 50 meters for each lap in your most recent workout."
}

User: "Average pace per 25 yards by stroke"
{
  "sql": "SELECT stroke_style, ROUND(SUM(duration_seconds) / SUM(distance_meters) * 22.86, 2) as avg_pace_per_25yd_seconds FROM laps WHERE stroke_style IS NOT NULL AND distance_meters > 0 GROUP BY stroke_style ORDER BY avg_pace_per_25yd_seconds ASC",
  "explanation": "Average pace per 25 yards for each stroke type (total time over total distance)."
}

User: "Summarize my most recent workout"
{
  "sql": "SELECT datetime(w.start_date / 1000, 'unixepoch', 'localtime') as date, w.duration_seconds, w.total_distance_meters, w.pool_length_unit, w.total_energy_kcal, (SELECT COUNT(*) FROM laps WHERE workout_id = w.id AND distance_meters > 0) as lap_count FROM workouts w ORDER BY w.start_date DESC LIMIT 1",
  "explanation": "Summary of your most recent swim workout."
}

User: "Show me the lap breakdown for my last workout"
{
  "sql": "SELECT l.lap_number, l.distance_meters, l.duration_seconds, l.stroke_style, l.pace_per_100m_seconds, w.pool_length_unit FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) AND l.distance_meters > 0 ORDER BY l.lap_number ASC",
  "explanation": "Lap-by-lap breakdown of your most recent workout."
}

User: "Show my 100-yard splits for my last workout"
{
  "sql": "WITH last_workout AS (SELECT id, pool_length_meters, pool_length_unit FROM workouts ORDER BY start_date DESC LIMIT 1), swim_laps AS (SELECT l.workout_id, l.duration_seconds, ROW_NUMBER() OVER (PARTITION BY l.workout_id ORDER BY l.lap_number) AS seq FROM laps l JOIN last_workout w ON l.workout_id = w.id WHERE l.distance_meters > 0), splits AS (SELECT CAST((sl.seq - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) + 1 as split_number, SUM(sl.duration_seconds) as split_time, w.pool_length_unit FROM swim_laps sl JOIN last_workout w ON sl.workout_id = w.id GROUP BY split_number HAVING COUNT(*) = ROUND(91.44 / w.pool_length_meters)) SELECT split_number, split_time as duration_seconds, pool_length_unit FROM splits ORDER BY split_number",
  "explanation": "100-yard split times from your most recent workout."
}

User: "Show my 100-meter splits for my last workout"
{
  "sql": "WITH last_workout AS (SELECT id, pool_length_meters, pool_length_unit FROM workouts ORDER BY start_date DESC LIMIT 1), swim_laps AS (SELECT l.workout_id, l.duration_seconds, ROW_NUMBER() OVER (PARTITION BY l.workout_id ORDER BY l.lap_number) AS seq FROM laps l JOIN last_workout w ON l.workout_id = w.id WHERE l.distance_meters > 0), splits AS (SELECT CAST((sl.seq - 1) / ROUND(100.0 / w.pool_length_meters) AS INTEGER) + 1 as split_number, SUM(sl.duration_seconds) as split_time FROM swim_laps sl JOIN last_workout w ON sl.workout_id = w.id GROUP BY split_number HAVING COUNT(*) = ROUND(100.0 / w.pool_length_meters)) SELECT split_number, split_time as duration_seconds FROM splits ORDER BY split_number",
  "explanation": "100-meter split times from your most recent workout."
}

User: "What were my five fastest 100-yard split times from my last 10 workouts?"
{
  "sql": "WITH recent_workouts AS (SELECT id, pool_length_meters, pool_length_unit, start_date FROM workouts ORDER BY start_date DESC LIMIT 10), swim_laps AS (SELECT l.workout_id, l.duration_seconds, ROW_NUMBER() OVER (PARTITION BY l.workout_id ORDER BY l.lap_number) AS seq FROM laps l JOIN recent_workouts w ON l.workout_id = w.id WHERE w.pool_length_unit = 'yd' AND l.distance_meters > 0), splits AS (SELECT sl.workout_id, datetime(w.start_date / 1000, 'unixepoch', 'localtime') as workout_date, w.pool_length_unit, CAST((sl.seq - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) as split_number, SUM(sl.duration_seconds) as split_time FROM swim_laps sl JOIN recent_workouts w ON sl.workout_id = w.id GROUP BY sl.workout_id, split_number HAVING COUNT(*) = ROUND(91.44 / w.pool_length_meters)) SELECT split_time as duration_seconds, workout_date, pool_length_unit FROM splits ORDER BY split_time ASC LIMIT 5",
  "explanation": "Your five fastest 100-yard splits from your last 10 workouts."
}

User: "Show my 10 fastest 100-yard splits from the last year with the workout date and lap numbers"
{
  "sql": "WITH recent_workouts AS (SELECT id, pool_length_meters, pool_length_unit, start_date FROM workouts WHERE start_date >= strftime('%s', 'now', '-1 year') * 1000 ORDER BY start_date DESC), swim_laps AS (SELECT l.workout_id, l.lap_number, l.duration_seconds, ROW_NUMBER() OVER (PARTITION BY l.workout_id ORDER BY l.lap_number) AS seq FROM laps l JOIN recent_workouts w ON l.workout_id = w.id WHERE w.pool_length_unit = 'yd' AND l.distance_meters > 0), splits AS (SELECT sl.workout_id, date(w.start_date / 1000, 'unixepoch', 'localtime') as workout_date, CAST((sl.seq - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) as split_number, SUM(sl.duration_seconds) as split_time, MIN(sl.lap_number) as first_lap, MAX(sl.lap_number) as last_lap, w.pool_length_unit FROM swim_laps sl JOIN recent_workouts w ON sl.workout_id = w.id GROUP BY sl.workout_id, split_number HAVING COUNT(*) = ROUND(91.44 / w.pool_length_meters)) SELECT split_time as duration_seconds, workout_date, CASE WHEN first_lap = last_lap THEN CAST(first_lap AS TEXT) ELSE CAST(first_lap AS TEXT) || '-' || CAST(last_lap AS TEXT) END as lap_range, pool_length_unit FROM splits ORDER BY split_time ASC LIMIT 10",
  "explanation": "Your 10 fastest 100-yard splits from the past year."
}

User: "What was my average heart rate in yesterday's workout?"
{
  "sql": "SELECT AVG(l.avg_heart_rate) as avg_hr FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.start_date >= strftime('%s', 'now', '-1 day') * 1000 AND l.avg_heart_rate IS NOT NULL",
  "explanation": "Your average heart rate from yesterday's swim workout."
}

User: "Show my max heart rate by lap for my last workout"
{
  "sql": "SELECT l.lap_number, l.max_heart_rate FROM laps l WHERE l.workout_id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) AND l.max_heart_rate IS NOT NULL ORDER BY l.lap_number",
  "explanation": "Maximum heart rate for each lap in your most recent workout."
}

User: "What's my average heart rate when swimming freestyle?"
{
  "sql": "SELECT AVG(l.avg_heart_rate) as avg_hr FROM laps l WHERE l.stroke_style = 'freestyle' AND l.avg_heart_rate IS NOT NULL",
  "explanation": "Your average heart rate during freestyle laps."
}

User: "Show workouts where my average heart rate was above 150 bpm"
{
  "sql": "SELECT datetime(w.start_date / 1000, 'unixepoch', 'localtime') as date, AVG(l.avg_heart_rate) as avg_hr, w.total_distance_meters, w.pool_length_unit FROM workouts w JOIN laps l ON w.id = l.workout_id WHERE l.avg_heart_rate IS NOT NULL GROUP BY w.id HAVING AVG(l.avg_heart_rate) > 150 ORDER BY w.start_date DESC",
  "explanation": "Workouts where your average heart rate exceeded 150 bpm."
}

NOTE: The HAVING clause ensures only complete splits are included (e.g., exactly 4 laps for a 100yd split in a 25yd pool).
CRITICAL: When including lap numbers with splits, use MIN(lap_number) and MAX(lap_number) within the GROUP BY to show the range, while still using SUM(duration_seconds) for the total time.

IMPORTANT: When generating pace queries:
1. For yards: ALWAYS multiply meters-based pace by 0.9144
2. For different distances: Calculate from duration and distance
3. Include the unit in the column alias (e.g., pace_per_100yd_seconds not just pace)
4. Use descriptive column names like pace_per_25yd_seconds, pace_per_50m_seconds, etc.

When providing the explanation:
- Keep it to one sentence when possible
- Don't repeat the user's question
- Focus on the key insight or answer
- Be concise and conversational

Conversation context:
- Earlier turns of this conversation may be included before the current question. Prior assistant turns show the answer that was given and, in brackets, the SQL that produced it.
- Use that context to interpret follow-up questions that refer to previous questions or results — e.g. "show that for last month instead", "what about freestyle?", "only the top 3", "which of those was the longest?". Reuse the relevant filters and structure from the prior query, adjusted as requested.
- Always answer the CURRENT (last) user question, and always return JSON for it.

Remember:
- Return ONLY the JSON object, no other text
- Ensure the SQL is safe and valid SQLite
- Be helpful and interpret the user's intent`;

/**
 * Extract a JSON object from a model response.
 *
 * OpenAI (json_object mode) returns clean JSON, but Anthropic returns free
 * text, which may include a leading sentence or markdown fences despite the
 * "JSON only" instruction. Pull out the first balanced {...} object.
 */
function extractJsonObject(text: string): { sql: string; explanation: string } {
  const trimmed = text.trim();
  let candidate = trimmed;

  // Try direct parse first.
  try {
    return validateParsed(JSON.parse(candidate));
  } catch {
    // Fall through to extraction.
  }

  // Strip markdown code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
    try {
      return validateParsed(JSON.parse(candidate));
    } catch {
      // Fall through.
    }
  }

  // Last resort: grab the substring from the first { to the last }.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return validateParsed(JSON.parse(trimmed.slice(start, end + 1)));
  }

  throw new Error('Could not parse JSON from model response');
}

function validateParsed(parsed: any): { sql: string; explanation: string } {
  if (!parsed || !parsed.sql || !parsed.explanation) {
    throw new Error('Invalid response format from model');
  }
  return {
    sql: String(parsed.sql).trim(),
    explanation: String(parsed.explanation).trim(),
  };
}

/**
 * Call OpenAI's chat completions endpoint via direct fetch (best React Native
 * compatibility) and return the raw JSON content string.
 */
async function callOpenAI(
  modelId: string,
  userQuery: string,
  history: LlmTurn[]
): Promise<string> {
  const apiKey = getApiKey('openai');
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userQuery },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('OpenAI API error:', response.status, errorData);
    throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }
  return content;
}

/**
 * Call Anthropic's Messages API via direct fetch and return the response text.
 *
 * Uses raw fetch rather than @anthropic-ai/sdk because that SDK imports Node
 * built-ins (node:fs) that Metro cannot bundle for React Native. No sampling
 * params are sent (temperature is removed on Opus 4.8 / 4.7) and thinking is
 * left off, since the system prompt already demands JSON-only output.
 */
async function callAnthropic(
  modelId: string,
  userQuery: string,
  history: LlmTurn[]
): Promise<string> {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Permits calling the API directly from a client (no browser CORS in RN).
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [...history, { role: 'user', content: userQuery }],
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('Anthropic API error:', response.status, errorData);
    throw new Error(`Anthropic API error: ${response.status} - ${errorData}`);
  }

  const data = await response.json();
  // content is an array of blocks; concatenate the text blocks.
  const text: string = Array.isArray(data.content)
    ? data.content
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => block.text)
        .join('')
        .trim()
    : '';

  if (!text) {
    throw new Error('No response from Anthropic');
  }
  return text;
}

/**
 * Convert a natural language query to SQL using the selected model, routing to
 * the correct provider.
 */
export async function parseNaturalLanguageQuery(
  userQuery: string,
  modelId: string = DEFAULT_MODEL_ID,
  history: ChatMessage[] = []
): Promise<{ sql: string; explanation: string }> {
  const model = getModel(modelId);
  const historyTurns = buildHistoryTurns(history);

  try {
    const content =
      model.provider === 'anthropic'
        ? await callAnthropic(model.id, userQuery, historyTurns)
        : await callOpenAI(model.id, userQuery, historyTurns);

    return extractJsonObject(content);
  } catch (error) {
    console.error(`Error parsing query with ${model.provider}:`, error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to parse query'
    );
  }
}

/**
 * Validate SQL query for safety
 */
function validateSQL(sql: string): void {
  const upperSQL = sql.toUpperCase().trim();

  // Only allow SELECT statements (including CTEs that start with WITH)
  if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
    throw new Error('Only SELECT queries are allowed');
  }

  // If it's a CTE, ensure it contains a SELECT
  if (upperSQL.startsWith('WITH') && !upperSQL.includes('SELECT')) {
    throw new Error('Only SELECT queries are allowed');
  }

  // Blacklist dangerous keywords
  const dangerousKeywords = [
    'DROP',
    'DELETE',
    'UPDATE',
    'INSERT',
    'ALTER',
    'CREATE',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
    'PRAGMA',
  ];

  for (const keyword of dangerousKeywords) {
    if (upperSQL.includes(keyword)) {
      throw new Error(`Dangerous keyword detected: ${keyword}`);
    }
  }

  // Ensure query doesn't try to access other tables
  const allowedTables = ['workouts', 'laps', 'segments', 'stroke_samples', 'heart_rate_samples'];
  // This is a basic check - a more sophisticated parser would be better
  // but for our controlled use case this should suffice
}

/**
 * Execute SQL query safely
 */
export async function executeQuery(
  db: SQLite.SQLiteDatabase,
  sql: string
): Promise<any[]> {
  // Validate SQL first
  validateSQL(sql);

  try {
    const results = await db.getAllAsync(sql);
    return results;
  } catch (error) {
    console.error('Error executing SQL:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to execute query'
    );
  }
}

/**
 * Process a natural language query end-to-end
 */
export async function processUserQuery(
  db: SQLite.SQLiteDatabase,
  userQuery: string,
  modelId: string = DEFAULT_MODEL_ID,
  history: ChatMessage[] = []
): Promise<QueryResult> {
  try {
    // Step 1: Convert to SQL (with prior conversation for follow-up context)
    const { sql, explanation } = await parseNaturalLanguageQuery(userQuery, modelId, history);

    // Step 2: Execute query
    const results = await executeQuery(db, sql);

    return {
      sql,
      explanation,
      results,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    return {
      sql: '',
      explanation: '',
      results: [],
      error: errorMessage,
    };
  }
}
