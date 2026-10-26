# Veylqorix Showcase Website

Official showcase, interactive tour, narrative story, and roadmap website for **[Veylqorix](https://github.com/soumyachk101/Veylqorix)** — Universal AI code security and quality platform.

Built with Next.js 15 (App Router), React 19, and Tailwind CSS using a retro pixel-box terminal aesthetic.

## Features

- **Home Showcase**: Narrative hero, scanner guarantees, performance benchmarks, and core value proposition.
- **Narrative Story**: 5-chapter interactive narrative documenting the origins, design decisions, and evolution of Veylqorix.
- **Interactive Tour**: Visual walk-through of the security scanners (Secrets, Licenses, AST/Quality, Vulnerabilities), MCP server, and GitHub gate.
- **8-Day Roadmap**: Visual timeline from initial audit to production readiness.
- **Changelog**: Comprehensive version-by-version release history.
- **Responsive Navigation**: Desktop bar and mobile menu.

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Language**: TypeScript

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Local Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Production Build

```bash
npm run build
npm start
```

## Repository Structure

```
├── public/                 # Static assets, diagrams, and icons
├── src/
│   ├── app/                # Next.js App Router pages & routes
│   │   ├── changelog/      # Release changelog page
│   │   ├── roadmap/        # 8-day roadmap page
│   │   ├── story/          # 5-chapter story pages
│   │   ├── tour/           # Interactive product tour
│   │   ├── globals.css     # Theme & pixel design tokens
│   │   ├── layout.tsx      # Root layout
│   │   └── page.tsx        # Showcase home page
│   ├── components/         # Reusable UI & layout components
│   └── data/               # Static data for changelog & story
├── next.config.mjs         # Next.js configuration
├── tailwind.config.ts      # Tailwind configuration & retro theme tokens
└── tsconfig.json           # TypeScript configuration
```

## License

MIT © [Soumya Chakraborty](https://github.com/soumyachk101)
