# Claritas 🌍

Claritas is a unified data platform that brings clarity to global complexity by aggregating, enriching, and visualizing international datasets. This monorepo houses all components of the Claritas ecosystem, including the web frontend, mobile app, APIs, and infrastructure.

---

## 🧱 Monorepo Structure

```
claritas/
│
├── apps/
│   ├── web/                # React frontend (Vite-based)
│   ├── mobile/             # Kotlin/Swift app (React Native optional)
│   └── api/                # Node.js backend (Express, GraphQL, REST)
│
├── packages/
│   ├── ui/                 # Shared UI components (web + mobile)
│   ├── utils/              # Utility functions and helpers
│   └── types/              # Shared TypeScript interfaces and types
│
├── infra/
│   ├── gcp/                # Terraform / Deployment Manager for GCP infra
│   ├── docker/             # Container setup for local development
│   └── devcontainer/       # Codespaces and VS Code setup
│
├── docs/
│   ├── architecture/       # C1/C2 diagrams and capability maps
│   └── ADRs/               # Architectural decision records
│
├── .github/                # GitHub workflows (CI/CD)
├── .devcontainer/          # Devcontainer definition (Codespaces)
└── README.md               # You are here
```

---

## 🏗️ Architecture Overview

Claritas runs on Google Cloud Platform with a microservice backend architecture and component-based frontend. Here’s a brief outline:

### 🔹 Frontend
- **Web**: React + Vite, deployed via Firebase Hosting
- **Mobile**: Native (Kotlin/Swift) or React Native, targeting Android/iOS

### 🔹 Backend
- Node.js (Express or GraphQL)
- Hosted on GKE (Google Kubernetes Engine)
- Auth via Firebase Authentication

### 🔹 Data & Insights
- Document DB: Firestore
- Analytics & ML: Vertex AI + Cloud Functions
- Event-driven via Google Pub/Sub

### 🔹 APIs
- Public/Private APIs via Cloud Endpoints
- Internal service communication via REST/GraphQL

---

## 🚀 Getting Started

### 1. Codespaces
Spin up an environment in-browser with GitHub Codespaces (preconfigured in `.devcontainer`).

### 2. Manual Dev Setup
Clone and use the workspace:
```bash
git clone https://github.com/your-org/claritas.git
cd claritas
npm install
npm run dev
```

---

## 📚 Documentation

- **Architecture Diagrams**: [`docs/architecture`](./docs/architecture)
- **ADR Records**: [`docs/ADRs`](./docs/ADRs)
- **GCP Setup Guide**: [`infra/gcp`](./infra/gcp)

---

## 🛡️ License

MIT
