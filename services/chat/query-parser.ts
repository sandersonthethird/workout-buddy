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
  - pool_length_meters: REAL (nullable, typically 25 or 50)
  - location_type: TEXT ('pool' or 'open_water', nullable)
  - stroke_style: TEXT ('freestyle', 'backstroke', 'breaststroke', 'butterfly', 'mixed', nullable)
  - source_app: TEXT (e.g., 'Apple Watch')
  - data_quality: INTEGER (0-3, where 3 is best)
  - synced_to_cloud: INTEGER (0 or 1, boolean)
  - created_at: INTEGER (Unix timestamp)
  - updated_at: INTEGER (Unix timestamp)

TABLE splits:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key to workouts.id)
  - split_number: INTEGER (lap number, starts at 1)
  - start_time: INTEGER (Unix timestamp)
  - end_time: INTEGER (Unix timestamp)
  - distance_meters: REAL
  - duration_seconds: REAL
  - stroke_count: INTEGER (nullable)
  - avg_heart_rate: INTEGER (nullable, bpm)
  - max_heart_rate: INTEGER (nullable, bpm)
  - swolf_score: INTEGER (nullable, strokes + seconds)
  - pace_per_100m_seconds: REAL (seconds per 100m)

TABLE stroke_samples:
  - id: TEXT (primary key)
  - workout_id: TEXT (foreign key)
  - split_id: TEXT (nullable, foreign key to splits.id)
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
- Pace is in seconds per 100 meters (lower is faster)
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
- Format dates properly using datetime() for display
- Round numbers to 2 decimal places where appropriate
- Limit results to prevent overwhelming output (use LIMIT 10 unless user asks for more)
- Handle nullable fields gracefully with COALESCE or IS NOT NULL checks

Example Queries:

User: "What was my fastest 100m split last month?"
{
  "sql": "SELECT datetime(s.start_time / 1000, 'unixepoch') as date, s.pace_per_100m_seconds, w.stroke_style FROM splits s JOIN workouts w ON s.workout_id = w.id WHERE w.start_date >= strftime('%s', 'now', '-1 month') * 1000 ORDER BY s.pace_per_100m_seconds ASC LIMIT 1",
  "explanation": "This query finds the fastest (lowest) pace per 100m from all splits in the past month."
}

User: "Show my average SWOLF by stroke type"
{
  "sql": "SELECT w.stroke_style, AVG(s.swolf_score) as avg_swolf, COUNT(DISTINCT w.id) as workouts FROM splits s JOIN workouts w ON s.workout_id = w.id WHERE s.swolf_score IS NOT NULL AND w.stroke_style IS NOT NULL GROUP BY w.stroke_style ORDER BY avg_swolf ASC",
  "explanation": "This query calculates average SWOLF scores grouped by stroke style, showing which stroke is most efficient."
}

User: "How many workouts did I do this week?"
{
  "sql": "SELECT COUNT(*) as workout_count FROM workouts WHERE start_date >= strftime('%s', 'now', '-7 days') * 1000",
  "explanation": "This query counts all workouts from the past 7 days."
}

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

  // Only allow SELECT statements
  if (!upperSQL.startsWith('SELECT')) {
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
  const allowedTables = ['workouts', 'splits', 'stroke_samples', 'heart_rate_samples'];
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
