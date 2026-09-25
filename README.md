# Trityanetra — Phase 3 Implementation

A secure coding-exam platform with Judge0 code execution, anti-cheat monitoring, and AST-based plagiarism detection.

## Architecture

```
trityanetra/
├── frontend/          # React + Vite + TypeScript
├── backend/           # Node/Express + TypeScript
├── ast-engine/        # Python/FastAPI plagiarism engine
├── docker-compose.yml # Redis + AST engine
└── docs/              # Documentation
```

## Stack

- **Frontend**: React 18, Vite, TypeScript, CodeMirror 6, Vitest
- **Backend**: Node.js, Express, TypeScript, Firebase Admin SDK, BullMQ, Jest
- **Database**: Firebase Firestore
- **Cache/Queue**: Redis + BullMQ
- **Code Execution**: Judge0
- **Plagiarism Detection**: Python FastAPI AST engine

## Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- Redis
- Firebase project with Admin SDK credentials
- Judge0 instance (optional, for code execution)

### 1. Start Redis and AST Engine

```bash
docker-compose up -d
```

### 2. Backend Setup

```bash
cd backend
cp .env.example .env  # Configure your environment
npm install
npm run dev
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### 4. AST Engine (standalone)

```bash
cd ast-engine
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python app.py
```

## Testing

### Backend Tests

```bash
cd backend
npm test
```

### AST Engine Tests

```bash
cd ast-engine
python -m pytest -v
```

### Frontend Tests

```bash
cd frontend
npm test
```

### End-to-End Tests

Requires Redis, Judge0, and AST engine running:

```bash
docker-compose up -d
cd backend && npm test -- --testPathPattern=e2e
```

## Phase 3 Features

### Judge0 Code Execution
- `backend/src/modules/judge0/client.ts` — API client with payload validation
- `backend/src/modules/judge0/rateLimiter.ts` — Sliding window rate limiter
- `backend/src/modules/judge0/circuitBreaker.ts` — Circuit breaker pattern
- `backend/src/modules/judge0/service.ts` — Execution orchestration
- `backend/src/modules/judge0/callback.controller.ts` — Webhook handler

### Anti-Cheat Monitoring
- `backend/src/modules/monitor/monitor.service.ts` — Advisory-only flag creation
- `backend/src/modules/monitor/monitor.routes.ts` — Append-only routes (no PUT/PATCH/DELETE)
- `backend/src/modules/monitor/rateLimiter.ts` — Independent rate limiter

### AST Plagiarism Detection
- `ast-engine/app.py` — FastAPI HTTP layer
- `ast-engine/comparator/batch_runner.py` — Batch comparison engine
- `ast-engine/comparator/ast_parser.py` — Code structure extraction
- `ast-engine/comparator/comparator.py` — Similarity scoring

### Plagiarism Pipeline
- `backend/src/modules/plagiarism/queue.ts` — BullMQ job queue
- `backend/src/modules/plagiarism/worker.ts` — Async job processing
- `backend/src/modules/plagiarism/service.ts` — Orchestration layer
- `backend/src/modules/plagiarism/plagiarism.routes.ts` — API routes

### Frontend Exam Features
- `frontend/src/features/exam/useTabFocusMonitor.ts` — Tab switch detection
- `frontend/src/features/exam/useDevToolsDetector.ts` — DevTools detection
- `frontend/src/features/exam/usePasteBlock.ts` — Paste monitoring
- `frontend/src/features/exam/FullscreenGuard.tsx` — Fullscreen monitoring
- `frontend/src/features/exam/ExamOverlay.tsx` — Composed monitoring wrapper
- `frontend/src/features/exam/CodeEditor.tsx` — CodeMirror editor
- `frontend/src/features/exam/SubmitBar.tsx` — Submission UI

## Ground Rules (Phase 3)

1. **Advisory-only monitoring**: Flags never auto-fail/terminate submissions
2. **Append-only flags**: No PUT/PATCH/DELETE routes for monitor flags
3. **Validate all external payloads**: Judge0 and AST engine responses validated before DB writes
4. **No ambiguous states**: Every async path has defined terminal failure states
5. **Independent rate limiters**: Judge0 and monitor use separate Redis namespaces
