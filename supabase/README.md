# Supabase Setup for Workout Buddy

This directory contains database migrations for cloud sync functionality.

## Setup Instructions

### 1. Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create an account
3. Click "New Project"
4. Choose an organization and provide:
   - Project name: "workout-buddy" (or your choice)
   - Database password: (save this securely)
   - Region: Choose closest to you
5. Wait for project to provision (~2 minutes)

### 2. Run the Migration

There are two ways to run the migration:

#### Option A: Using Supabase Dashboard (Easiest)

1. Go to your project dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Click "New query"
4. Copy the contents of `migrations/20260106_initial_schema.sql`
5. Paste into the SQL editor
6. Click "Run" to execute

#### Option B: Using Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
cd ~/Apps/workout-buddy
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

### 3. Get Your API Credentials

1. Go to **Project Settings** (gear icon in sidebar)
2. Navigate to **API** section
3. Copy your credentials:
   - **Project URL**: `https://your-project.supabase.co`
   - **anon/public key**: The `anon` `public` key

### 4. Configure Your App

Add these to your `.env` file:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 5. Enable Authentication (Optional)

If you want user authentication:

1. Go to **Authentication** > **Providers**
2. Enable your preferred providers (Email, Apple, Google, etc.)
3. Configure redirect URLs for your app

For now, the app uses anonymous access. You can implement proper auth later.

## Database Schema

The migration creates the following tables:

- **workouts**: Main workout data
- **splits**: Lap/split data for each workout
- **stroke_samples**: High-resolution stroke count samples
- **heart_rate_samples**: Heart rate measurements during workouts
- **chat_messages**: Chat history for natural language queries

All tables include:
- Row Level Security (RLS) enabled
- User-specific data isolation
- Automatic timestamps
- Proper indexes for performance

## Testing the Connection

After setup, test your connection:

```typescript
import { supabase } from './lib/supabase';

// Test query
const { data, error } = await supabase
  .from('workouts')
  .select('count');

console.log('Connection test:', { data, error });
```

## Troubleshooting

### Connection Issues
- Verify your `.env` file has correct credentials
- Check that Supabase project is active (not paused)
- Ensure you're using the `anon` key, not the `service_role` key

### Permission Errors
- RLS policies require authenticated users
- For testing, you can temporarily disable RLS:
  ```sql
  ALTER TABLE workouts DISABLE ROW LEVEL SECURITY;
  ```
- Remember to re-enable it for production!

### Migration Errors
- If migration fails, check the SQL Editor for detailed error messages
- Ensure UUID extension is enabled
- Check that you have necessary permissions

## Next Steps

Once Supabase is set up:
1. The app will automatically sync workout data to the cloud
2. Data will be backed up and accessible from any device
3. You can query your data using Supabase dashboard
4. Consider setting up automatic backups in Supabase project settings
