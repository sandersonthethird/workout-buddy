# Workout Buddy

An Expo mobile app for iOS that allows natural language querying of historical swim workout data from Apple HealthKit.

## Features

- 🏊 Import all historical swim workouts from HealthKit
- 💬 Chat interface with natural language queries powered by OpenAI
- 📊 View detailed split times, stroke counts, pace, and SWOLF scores
- 📱 Offline-first architecture with local SQLite database
- ☁️ Optional cloud backup via Supabase
- 🔄 Automatic background sync for new workouts

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required:
- `EXPO_PUBLIC_OPENAI_API_KEY`: Your OpenAI API key from https://platform.openai.com/api-keys

Optional (for cloud sync):
- `EXPO_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key

### 3. Set Up Supabase (Optional)

If you want cloud backup functionality:

1. Create a project at https://supabase.com
2. Run the migrations in `supabase/migrations/` to create the database schema
3. Add your Supabase credentials to `.env`

### 4. Run the App

```bash
# For iOS (requires Mac with Xcode)
npm run ios

# For development build
npx expo run:ios
```

## Project Structure

```
workout-buddy/
├── app/                    # Expo Router screens
├── components/             # React components
├── contexts/              # React contexts
├── hooks/                 # Custom React hooks
├── lib/                   # Core libraries (database, API clients)
├── services/              # Business logic services
│   ├── healthkit/        # HealthKit integration
│   ├── database/         # Database operations
│   ├── sync/             # Sync logic
│   └── chat/             # Chat query processing
├── types/                 # TypeScript type definitions
└── utils/                 # Utility functions
```

## Development Progress

### Phase 1: Foundation ✅
- [x] Initialize Expo project
- [x] Install dependencies
- [x] Create folder structure
- [x] Set up database schema and migrations
- [x] Create database context provider
- [x] Configure Supabase and OpenAI clients
- [x] Update root layout with providers

### Phase 2: HealthKit Integration ✅
- [x] Install and configure react-native-health
- [x] Run expo prebuild for native iOS build
- [x] Create HealthKit permissions module
- [x] Build HealthKit query builders (paginated, safe)
- [x] Create data parsers for workout normalization
- [x] Add HealthKit permissions to app.json

### Phase 3: Database & Repository Layer ✅
- [x] Create workout repository with CRUD operations
- [x] Create sync state repository
- [x] Set up Supabase migrations with RLS policies
- [x] Document Supabase setup process

### Phase 4: Chat Interface ✅
- [x] Build chat UI components (ChatMessage, ChatInput)
- [x] Create OpenAI query parser service
- [x] Implement response formatter
- [x] Create useChat hook
- [x] Integrate chat interface into main screen
- [x] Add proper error handling and loading states

### Next Phases
- Phase 5: Bulk Import (Import historical HealthKit data)
- Phase 6: Workout Display (Browse and view workout details)
- Phase 7: Cloud Sync (Automatic Supabase sync)
- Phase 8: Background Sync (Periodic new workout sync)
- Phase 9: Polish (Error handling, empty states, performance)

## Technologies

- **Framework**: Expo SDK 54
- **Database**: SQLite (expo-sqlite)
- **Cloud Sync**: Supabase
- **LLM**: OpenAI (GPT-4o-mini for queries, GPT-4o for analysis)
- **Background Tasks**: expo-background-fetch + expo-task-manager
- **Navigation**: Expo Router

## License

MIT
