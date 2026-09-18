# The Goated Farm

Integrated agro ERP, farm accounting, and livestock tracking system built in Google AI Studio.

## Overview

**The Goated Farm** is an offline-first farm management and accounting application engineered specifically for livestock (goats, sheep, cows), fisheries, crop cycles, and feed inventory. It couples double-entry accounting with granular field operations.

### Key Capabilities

- **Livestock & Farm Operations**: Tag-based individual animal records, compressed photo tracking, weight history, breeding lineage, health status, and quarantine management.
- **Fisheries & Crop Cycles**: Pond and plot tracking, feed/fertilizer conversion logs, and batch production metrics.
- **Double-Entry Financial Ledger**: Automatic journal entries for sales, feed purchases, veterinary expenses, capital investments, and automated asset depreciation.
- **Offline-First Resilience**: Local client storage via Dexie / IndexedDB with background bi-directional synchronization to Google Cloud Firestore when online.
- **Security & Multi-Partner Auth**: Bcrypt-hashed owner PIN authentication with single-tenant owner email authorization and granular Firestore security rules.

## Setup & Configuration

### Prerequisites

- Node.js 20+
- npm or yarn

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Authorized owner emails (comma-separated)
APPROVED_OWNER_EMAILS=owner1@example.com,owner2@example.com

# Initial farm master PIN for owner login (hashed with bcrypt cost 12 on setup)
INITIAL_PIN=123456

# Firebase Web App Config (Web API key is safe to be public; Firestore security rules protect data)
FIREBASE_API_KEY=AIzaSy...
FIREBASE_SERVICE_ACCOUNT_KEY=

# Optional Gemini & Session configuration
GEMINI_API_KEY=
SESSION_SECRET=
```

### Installation & Running

```bash
# Install dependencies
npm install

# Run the dev server (Vite + Express server on port 3000)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```
