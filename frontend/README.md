# AWS-Architect Frontend

Frontend for ArcForge / AWS-Architect.

This application is a React + Vite chat interface where a user types a project
idea, views assistant responses, and sees Mermaid diagrams rendered directly in
the UI.

## Folder structure

```text
frontend/
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── public/
└── src/
		├── main.jsx
		├── App.jsx
		├── MermaidChart.jsx
		├── assets/
		├── components/
		├── pages/
		└── styles/
				├── App.css
				├── index.css
				└── specific-components/
```

## What this frontend does

- Provides a chat-style interface for AWS architecture generation.
- Lets the user type a project idea into the input box.
- Shows assistant replies in Markdown using `react-markdown`.
- Renders Mermaid code blocks using a dedicated `MermaidChart` component.
- Includes suggestion chips to quickly seed common AWS prompts.
- Supports auto-scrolling, typing indicators, and a scroll-to-bottom control.

## Current behavior

At the moment, the frontend simulates an assistant response locally so the UI
can be developed before the full backend integration is wired up. The response
includes Mermaid flowchart code that is rendered in the chat area.

The current app flow is:

1. User types a prompt into the chat input.
2. The message is added to the chat history.
3. The app shows a temporary loading/typing state.
4. A sample assistant response is added.
5. Any Mermaid code block in the response is rendered as an SVG diagram.

## Main components

- `src/App.jsx`
	- Main chat experience and message state management.
	- Handles prompt entry, sample assistant responses, scrolling, and Markdown
		rendering.
- `src/MermaidChart.jsx`
	- Uses the Mermaid library to convert diagram text into SVG.
	- Initializes Mermaid once and re-renders when the chart text changes.
- `src/styles/App.css`
	- Chat layout, message bubbles, typing indicator, chips, scroll button, and
		Mermaid diagram styling.
- `src/styles/index.css`
	- Base document styling and root layout.
- `src/main.jsx`
	- Application entry point that mounts the React tree.

## Tech stack

- React 19
- Vite
- Mermaid
- react-markdown
- ESLint

## Scripts

From the `frontend/` folder:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Setup

```bash
cd frontend
npm install
npm run dev
```

If dependencies become inconsistent after pulling changes from another branch,
run a clean reinstall:

```bash
rm -rf node_modules
npm ci
```

## Dependencies

- `react` / `react-dom` — UI framework
- `react-markdown` — Renders assistant responses written in Markdown
- `mermaid` — Renders architecture diagrams from Mermaid text

## Notes

- The frontend currently uses a mocked assistant response while backend API
	wiring is still being completed.
- The Mermaid renderer expects fenced code blocks labeled as `mermaid`.
- Keep the UI fast and stable by avoiding unnecessary re-renders in the chat and
	diagram components.
