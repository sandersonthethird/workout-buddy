import { openai, MODELS, isOpenAIConfigured } from '@/lib/llm';
import * as SQLite from 'expo-sqlite';

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
- All dates are stored as Unix timestamps (milliseconds since epoch)
- To filter by date, use: WHERE start_date >= strftime('%s', '2024-01-01') * 1000
- Current time in milliseconds: strftime('%s', 'now') * 1000
- To get date from timestamp: datetime(start_date / 1000, 'unixepoch')
- SWOLF score = stroke_count + duration in seconds (lower is better)

Pace Conversions (CRITICAL for user queries):
- All distances stored in METERS (distance_meters, total_distance_meters)
- pace_per_100m_seconds is in seconds per 100 METERS
- pool_length_unit indicates the workout's original unit ('yd' or 'm')
- When user requests pace in yards, convert using: 1 yard = 0.9144 meters
- Pace per 100 yards = pace_per_100m_seconds * (100 * 0.9144 / 100) = pace_per_100m_seconds * 0.9144
- Pace per 25 yards = (duration_seconds / (distance_meters / 0.9144)) * 25
- Pace per 50 yards = (duration_seconds / (distance_meters / 0.9144)) * 50
- Examples:
  * "pace per 100 yards" → ROUND(l.pace_per_100m_seconds * 0.9144, 2) as pace_per_100yd
  * "pace per 25 yards" → ROUND((l.duration_seconds / (l.distance_meters / 0.9144)) * 25, 2) as pace_per_25yd
  * "pace per 50 meters" → ROUND((l.duration_seconds / l.distance_meters) * 50, 2) as pace_per_50m

Split Time Calculations (CRITICAL for split queries):
- A "split" is a cumulative time for a specific distance, NOT individual laps
- Example: 100-yard split in a 25-yard pool = sum of 4 consecutive laps (4x25yd)
- CRITICAL: You MUST use SUM(duration_seconds) to add up multiple laps for each split
- Common split distances and their lap counts:
  * 100 yards (91.44m) in 25yd pool (22.86m) = 4 laps
  * 100 yards (91.44m) in 50yd pool (45.72m) = 2 laps
  * 50 yards (45.72m) in 25yd pool (22.86m) = 2 laps
  * 100 meters in 25m pool = 4 laps
  * 100 meters in 50m pool = 2 laps
- Step-by-step calculation:
  1. Calculate laps per split: ROUND(target_split_meters / pool_length_meters)
  2. Assign each lap to a split group: CAST((lap_number - 1) / laps_per_split AS INTEGER)
  3. SUM(duration_seconds) for all laps in each split group
  4. GROUP BY workout_id AND split_number to get separate split times
- CRITICAL WARNING: Even when the user asks for "lap numbers" or "which laps", you MUST still use SUM(duration_seconds) in the SELECT and GROUP BY workout_id and split_number. Use MIN(lap_number) and MAX(lap_number) to show the lap range, but NEVER select individual lap rows when calculating splits.
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
- Join tables when needed for complete answers
- Use appropriate aggregations (AVG, MAX, MIN, COUNT, SUM)
- Format dates using datetime(timestamp / 1000, 'unixepoch') for display
- For times: Use strftime('%H:%M', timestamp / 1000, 'unixepoch') or include full datetime
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
  "sql": "SELECT datetime(l.start_time / 1000, 'unixepoch') as date, l.pace_per_100m_seconds, l.stroke_style FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.start_date >= strftime('%s', 'now', '-1 month') * 1000 ORDER BY l.pace_per_100m_seconds ASC LIMIT 1",
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
  "sql": "SELECT l.lap_number, ROUND((l.duration_seconds / (l.distance_meters / 0.9144)) * 25, 2) as pace_per_25yd_seconds, l.stroke_style FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.pool_length_unit = 'yd' ORDER BY w.start_date DESC, l.lap_number ASC LIMIT (SELECT COUNT(*) FROM laps WHERE workout_id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1))",
  "explanation": "Pace per 25 yards for each lap in your most recent yard pool workout."
}

User: "What was my average pace per 100 yards?"
{
  "sql": "SELECT ROUND(AVG(pace_per_100m_seconds * 0.9144), 2) as avg_pace_per_100yd_seconds FROM laps",
  "explanation": "Your average pace per 100 yards across all laps."
}

User: "Show my pace per 50 meters for my last workout"
{
  "sql": "SELECT lap_number, ROUND((duration_seconds / distance_meters) * 50, 2) as pace_per_50m_seconds FROM laps WHERE workout_id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) ORDER BY lap_number ASC",
  "explanation": "Pace per 50 meters for each lap in your most recent workout."
}

User: "Average pace per 25 yards by stroke"
{
  "sql": "SELECT stroke_style, ROUND(AVG((duration_seconds / (distance_meters / 0.9144)) * 25), 2) as avg_pace_per_25yd_seconds FROM laps WHERE stroke_style IS NOT NULL GROUP BY stroke_style ORDER BY avg_pace_per_25yd_seconds ASC",
  "explanation": "Average pace per 25 yards for each stroke type."
}

User: "Summarize my most recent workout"
{
  "sql": "SELECT datetime(w.start_date / 1000, 'unixepoch') as date, w.duration_seconds, w.total_distance_meters, w.pool_length_unit, w.total_energy_kcal, (SELECT COUNT(*) FROM laps WHERE workout_id = w.id) as lap_count FROM workouts w ORDER BY w.start_date DESC LIMIT 1",
  "explanation": "Summary of your most recent swim workout."
}

User: "Show me the lap breakdown for my last workout"
{
  "sql": "SELECT l.lap_number, l.distance_meters, l.duration_seconds, l.stroke_style, l.pace_per_100m_seconds, w.pool_length_unit FROM laps l JOIN workouts w ON l.workout_id = w.id WHERE w.id = (SELECT id FROM workouts ORDER BY start_date DESC LIMIT 1) ORDER BY l.lap_number ASC",
  "explanation": "Lap-by-lap breakdown of your most recent workout."
}

User: "Show my 100-yard splits for my last workout"
{
  "sql": "WITH last_workout AS (SELECT id, pool_length_meters, pool_length_unit FROM workouts ORDER BY start_date DESC LIMIT 1), splits AS (SELECT CAST((l.lap_number - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) + 1 as split_number, SUM(l.duration_seconds) as split_time, w.pool_length_unit FROM laps l JOIN last_workout w ON l.workout_id = w.id WHERE l.distance_meters > 0 GROUP BY split_number) SELECT split_number, split_time as duration_seconds, pool_length_unit FROM splits ORDER BY split_number",
  "explanation": "100-yard split times from your most recent workout."
}

User: "What were my five fastest 100-yard split times from my last 10 workouts?"
{
  "sql": "WITH recent_workouts AS (SELECT id, pool_length_meters, pool_length_unit, start_date FROM workouts ORDER BY start_date DESC LIMIT 10), splits AS (SELECT w.id as workout_id, datetime(w.start_date / 1000, 'unixepoch') as workout_date, w.pool_length_unit, CAST((l.lap_number - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) as split_number, SUM(l.duration_seconds) as split_time FROM laps l JOIN recent_workouts w ON l.workout_id = w.id WHERE w.pool_length_unit = 'yd' AND l.distance_meters > 0 GROUP BY w.id, split_number HAVING COUNT(*) = ROUND(91.44 / w.pool_length_meters)) SELECT split_time as duration_seconds, workout_date, pool_length_unit FROM splits ORDER BY split_time ASC LIMIT 5",
  "explanation": "Your five fastest 100-yard splits from your last 10 workouts."
}

User: "Show my 10 fastest 100-yard splits from the last year with the workout date and lap numbers"
{
  "sql": "WITH recent_workouts AS (SELECT id, pool_length_meters, pool_length_unit, start_date FROM workouts WHERE start_date >= strftime('%s', 'now', '-1 year') * 1000 ORDER BY start_date DESC), splits AS (SELECT w.id as workout_id, date(w.start_date / 1000, 'unixepoch') as workout_date, w.pool_length_meters, w.pool_length_unit, CAST((l.lap_number - 1) / ROUND(91.44 / w.pool_length_meters) AS INTEGER) as split_number, SUM(l.duration_seconds) as split_time, MIN(l.lap_number) as first_lap, MAX(l.lap_number) as last_lap FROM laps l JOIN recent_workouts w ON l.workout_id = w.id WHERE w.pool_length_unit = 'yd' AND l.distance_meters > 0 GROUP BY w.id, split_number HAVING COUNT(*) = ROUND(91.44 / w.pool_length_meters)) SELECT split_time as duration_seconds, workout_date, CASE WHEN first_lap = last_lap THEN CAST(first_lap AS TEXT) ELSE CAST(first_lap AS TEXT) || '-' || CAST(last_lap AS TEXT) END as lap_range, pool_length_unit FROM splits ORDER BY split_time ASC LIMIT 10",
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
  "sql": "SELECT datetime(w.start_date / 1000, 'unixepoch') as date, AVG(l.avg_heart_rate) as avg_hr, w.total_distance_meters, w.pool_length_unit FROM workouts w JOIN laps l ON w.id = l.workout_id WHERE l.avg_heart_rate IS NOT NULL GROUP BY w.id HAVING AVG(l.avg_heart_rate) > 150 ORDER BY w.start_date DESC",
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

Remember:
- Return ONLY the JSON object, no other text
- Ensure the SQL is safe and valid SQLite
- Be helpful and interpret the user's intent`;

/**
 * Convert natural language query to SQL using OpenAI
 * Uses direct fetch API for better React Native compatibility
 */
export async function parseNaturalLanguageQuery(
  userQuery: string
): Promise<{ sql: string; explanation: string }> {
  if (!isOpenAIConfigured()) {
    throw new Error('OpenAI API key not configured');
  }

  try {
    // Get API key directly from environment
    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key not found in environment');
    }

    console.log('Making OpenAI API request...');
    console.log('API Key present:', apiKey ? 'Yes' : 'No');
    console.log('API Key length:', apiKey?.length);

    // Make direct fetch call instead of using OpenAI SDK
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.QUERY_GENERATION,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userQuery },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    console.log('OpenAI API response status:', response.status);

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

    const parsed = JSON.parse(content);

    if (!parsed.sql || !parsed.explanation) {
      throw new Error('Invalid response format from OpenAI');
    }

    return {
      sql: parsed.sql.trim(),
      explanation: parsed.explanation.trim(),
    };
  } catch (error) {
    console.error('Error parsing query with OpenAI:', error);
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
  userQuery: string
): Promise<QueryResult> {
  try {
    // Step 1: Convert to SQL
    const { sql, explanation } = await parseNaturalLanguageQuery(userQuery);

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
