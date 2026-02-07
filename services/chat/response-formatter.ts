import { format } from 'date-fns';

/**
 * Response Formatter
 *
 * Formats SQL query results into human-readable text.
 */

/**
 * Mapping of database column names to user-friendly labels
 */
const COLUMN_NAME_MAP: Record<string, string> = {
  distance_meters: 'Distance',
  total_distance_meters: 'Distance',
  duration_seconds: 'Duration',
  total_duration_seconds: 'Duration',
  swim_duration_seconds: 'Swim Duration',
  rest_duration_seconds: 'Rest Duration',
  pace_per_100m_seconds: 'Pace (per 100m)',
  avg_pace_per_100m_seconds: 'Avg Pace (per 100m)',
  start_date: 'Date',
  end_date: 'End Date',
  avg_heart_rate: 'Avg Heart Rate',
  max_heart_rate: 'Max Heart Rate',
  heart_rate: 'Heart Rate',
  stroke_count: 'Stroke Count',
  stroke_style: 'Stroke',
  lap_count: 'Laps',
  segment_number: 'Segment',
  lap_number: 'Lap',
  lap_range: 'Laps',
  swolf_score: 'SWOLF',
  total_energy_kcal: 'Calories',
  pool_length_meters: 'Pool Length',
  workout_id: 'Workout',
};

/**
 * Format a number to specified decimal places
 */
function formatNumber(value: any, decimals: number = 2): string {
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toFixed(decimals);
}

/**
 * Format a timestamp to readable date (without time)
 */
function formatDate(timestamp: any): string {
  const num = Number(timestamp);
  if (isNaN(num)) return String(timestamp);

  const date = new Date(num);
  return format(date, 'MMM d, yyyy');
}

/**
 * Format pace time (seconds) to mm:ss format
 */
function formatPaceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format pace based on column name and value
 */
function formatPaceValue(key: string, seconds: any): string {
  const num = Number(seconds);
  if (isNaN(num)) return String(seconds);

  const lowerKey = key.toLowerCase();

  // Detect pace unit from column name
  if (lowerKey.includes('per_25yd') || lowerKey.includes('pace_25yd')) {
    return `${formatPaceTime(num)}/25yd`;
  } else if (lowerKey.includes('per_50yd') || lowerKey.includes('pace_50yd')) {
    return `${formatPaceTime(num)}/50yd`;
  } else if (lowerKey.includes('per_100yd') || lowerKey.includes('pace_100yd')) {
    return `${formatPaceTime(num)}/100yd`;
  } else if (lowerKey.includes('per_25m') || lowerKey.includes('pace_25m')) {
    return `${formatPaceTime(num)}/25m`;
  } else if (lowerKey.includes('per_50m') || lowerKey.includes('pace_50m')) {
    return `${formatPaceTime(num)}/50m`;
  } else if (lowerKey.includes('per_100m') || lowerKey.includes('pace_100m') || lowerKey.includes('pace')) {
    return `${formatPaceTime(num)}/100m`;
  }

  return `${formatPaceTime(num)}/100m`; // default
}

/**
 * Format duration in seconds to readable format
 */
function formatDuration(seconds: any): string {
  const num = Number(seconds);
  if (isNaN(num)) return String(seconds);

  const hours = Math.floor(num / 3600);
  const minutes = Math.floor((num % 3600) / 60);
  const secs = Math.round(num % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Detect column type and format appropriately
 */
function formatValue(key: string, value: any, row?: any): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  const lowerKey = key.toLowerCase();

  // Dates and times
  if (lowerKey.includes('date') || lowerKey.includes('time')) {
    // Check if it looks like a Unix timestamp
    const num = Number(value);
    if (!isNaN(num) && num > 1000000000000) {
      // Looks like milliseconds timestamp
      return formatDate(value);
    }
    // If it's a time string (HH:MM format), return as-is
    if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) {
      return value;
    }
  }

  // Pace
  if (lowerKey.includes('pace')) {
    return formatPaceValue(key, value);
  }

  // Distance - convert to yards if pool_length_unit is 'yd'
  if (lowerKey.includes('distance') && lowerKey.includes('meter')) {
    const meters = Number(value);
    if (isNaN(meters)) return String(value);

    // Check if we should display in yards
    const poolUnit = row?.pool_length_unit;
    if (poolUnit === 'yd') {
      const yards = meters / 0.9144;
      return `${Math.round(yards)} yd`;
    }

    // Default to meters (no km conversion)
    return `${Math.round(meters)} m`;
  }

  // Duration
  if (lowerKey.includes('duration') && lowerKey.includes('second')) {
    return formatDuration(value);
  }

  // Heart rate
  if (lowerKey.includes('heart_rate') || lowerKey.includes('hr')) {
    return `${Math.round(Number(value))} bpm`;
  }

  // Counts
  if (lowerKey.includes('count')) {
    return Math.round(Number(value)).toString();
  }

  // Numbers with reasonable decimal places
  if (typeof value === 'number' || !isNaN(Number(value))) {
    return formatNumber(value, 2);
  }

  return String(value);
}

/**
 * Get user-friendly column name
 */
function getFriendlyColumnName(key: string): string {
  // Check if we have a mapping
  if (COLUMN_NAME_MAP[key]) {
    return COLUMN_NAME_MAP[key];
  }

  // Otherwise, format the column name
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/ Meters?$/i, '') // Remove "Meters" suffix
    .replace(/ Seconds?$/i, ''); // Remove "Seconds" suffix
}

/**
 * Check if a column should be hidden from display
 */
function shouldHideColumn(key: string): boolean {
  const lowerKey = key.toLowerCase();
  // Hide ID fields and pool_length_unit (used internally for conversion)
  return lowerKey.includes('_id') || lowerKey === 'pool_length_unit';
}

/**
 * Filter out hidden columns from a row
 */
function filterVisibleColumns(row: any): any {
  const filtered: any = {};
  for (const [key, value] of Object.entries(row)) {
    if (!shouldHideColumn(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Format results as a table
 */
function formatAsTable(results: any[]): string {
  if (results.length === 0) return '';

  // Filter visible columns from first row to get headers
  const firstRow = filterVisibleColumns(results[0]);
  const keys = Object.keys(firstRow);

  if (keys.length === 0) return '';

  let table = '';

  // Header row
  const headers = keys.map(key => getFriendlyColumnName(key));
  table += headers.join(' | ') + '\n';

  // Separator row
  table += headers.map(() => '---').join(' | ') + '\n';

  // Data rows
  results.forEach(row => {
    const visibleRow = filterVisibleColumns(row);
    const values = keys.map(key => formatValue(key, visibleRow[key], row));
    table += values.join(' | ') + '\n';
  });

  return table;
}

/**
 * Format query results into a human-readable response
 */
export function formatQueryResults(
  results: any[],
  explanation: string
): string {
  if (results.length === 0) {
    return `${explanation}\n\nNo results found.`;
  }

  let response = explanation + '\n\n';

  // Filter visible columns from first row
  const firstRowVisible = filterVisibleColumns(results[0]);
  const visibleKeys = Object.keys(firstRowVisible);

  if (visibleKeys.length === 0) {
    return `${explanation}\n\nNo displayable results.`;
  }

  if (results.length === 1 && visibleKeys.length === 1) {
    // Single value result - keep bold for emphasis
    const key = visibleKeys[0];
    const value = results[0][key];
    response += `**${formatValue(key, value, results[0])}**`;
  } else if (results.length === 1) {
    // Single row result - clean list format
    const row = results[0];
    for (const key of visibleKeys) {
      const friendlyName = getFriendlyColumnName(key);
      response += `- ${friendlyName}: ${formatValue(key, row[key], row)}\n`;
    }
  } else if (results.length >= 3 && visibleKeys.length >= 2) {
    // Multiple rows with multiple columns - use table format
    response += formatAsTable(results);
  } else {
    // Multiple rows - use list format
    response += `Found ${results.length} result${results.length > 1 ? 's' : ''}:\n\n`;

    results.forEach((row, index) => {
      const visibleRow = filterVisibleColumns(row);
      const keys = Object.keys(visibleRow);

      if (keys.length === 1) {
        // Single column - just show value
        response += `${index + 1}. ${formatValue(keys[0], visibleRow[keys[0]], row)}\n`;
      } else if (keys.length === 2) {
        // Two columns - show as key - value (cleaner separator)
        const [key1, key2] = keys;
        response += `${index + 1}. ${formatValue(key1, visibleRow[key1], row)} - ${formatValue(key2, visibleRow[key2], row)}\n`;
      } else {
        // Multiple columns - show all with friendly names
        response += `${index + 1}.\n`;
        for (const key of keys) {
          const friendlyName = getFriendlyColumnName(key);
          response += `   - ${friendlyName}: ${formatValue(key, visibleRow[key], row)}\n`;
        }
      }
    });
  }

  return response.trim();
}
